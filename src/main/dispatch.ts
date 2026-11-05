import { randomBytes } from 'node:crypto'
import { stat } from 'node:fs/promises'
import type { AgentDef, DispatchRequest, DispatchResult } from '@shared/bridge'
import { pathKey } from '@shared/paths'
import { cleanEnv, run, type RunResult } from '../collector/cli'
import { LOCAL_PATH, NO_CLI, said, stripAnsi, type ActionDeps } from './actions'

/** `claude --bg` returns as soon as the session is started (agent-view § Dispatch). */
const DISPATCH_TIMEOUT_MS = 30_000
const NAME_WORDS = 4
const NAME_SLUG_MAX = 32

/** `--name`: the prompt's first words plus 4 hex digits, so two tasks that start alike never share a name. */
export function sessionName(prompt: string, suffix = randomBytes(2).toString('hex')): string {
  const words = prompt.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
  const slug = words.slice(0, NAME_WORDS).join('-').slice(0, NAME_SLUG_MAX).replace(/-+$/, '')
  return `${slug || 'task'}-${suffix}`
}

/**
 * `claude --bg --name <n> [--agent <a>] --effort <e> "<prompt>"` as an argument array (brief § Composer, `claude --help`).
 * A prompt that starts with `-` gets a leading space, so the CLI can't read it as an option.
 * shortcut: through a `.cmd` shim, cmd.exe ends the command at a newline, so newlines become spaces there; claude.exe keeps them.
 */
export function dispatchArgs(req: DispatchRequest, name: string, viaCmd: boolean): string[] {
  let prompt = req.prompt.trim()
  if (viaCmd) prompt = prompt.replace(/\s*[\r\n]+\s*/g, ' ')
  if (prompt.startsWith('-')) prompt = ` ${prompt}`
  return ['--bg', '--name', name, ...(req.agent ? ['--agent', req.agent] : []), '--effort', req.effort, prompt]
}

/** S6: "Workspace not trusted. Run `claude` in <path> once and accept the trust prompt, then retry." (exit 1) */
const UNTRUSTED = /Workspace not trusted/i
/** S6/S7: success prints `backgrounded · <id>`. */
const BACKGROUNDED = /backgrounded\s*·\s*([\w.-]+)/

export function dispatchResult(r: RunResult, name: string): DispatchResult {
  const text = stripAnsi(`${r.stdout}\n${r.stderr}`)
  if (r.code === 0) return { ok: true, name, bgId: BACKGROUNDED.exec(text)?.[1] ?? null }
  // No code: a timeout (nothing said) or a spawn that failed (its reason in stderr).
  if (r.code === null) return { ok: false, error: said(r) || 'claude --bg did not answer in time.', untrusted: false }
  return { ok: false, error: said(r) || `claude --bg exited with ${r.code}.`, untrusted: UNTRUSTED.test(text) }
}

/** A folder AgentDeck saw a session in, or one the user picked with Browse…, on a local drive, still there. */
export async function knownFolder(cwd: string, known: Iterable<string>): Promise<boolean> {
  if (!LOCAL_PATH.test(cwd)) return false
  const key = pathKey(cwd)
  if (![...known].some((k) => pathKey(k) === key)) return false
  try {
    return (await stat(cwd)).isDirectory()
  } catch {
    return false
  }
}

export const NOT_LOCAL = 'AgentDeck runs tasks only in folders on a local drive.'
export const NOT_KNOWN = 'AgentDeck runs tasks only in a project it has seen a session in, or a folder you picked with Browse….'

/** Why main won't run this request, or null: the folder and the subagent are checked here, not trusted from the page (ADR-0010). */
export async function refusal(
  req: DispatchRequest,
  known: Iterable<string>,
  agentsIn: (cwd: string) => Promise<AgentDef[]>
): Promise<string | null> {
  if (!LOCAL_PATH.test(req.cwd)) return NOT_LOCAL
  if (!(await knownFolder(req.cwd, known))) return NOT_KNOWN
  if (req.agent && !(await agentsIn(req.cwd)).some((a) => a.name === req.agent)) return `There is no subagent named ${req.agent} for this project.`
  return null
}

/** The request is checked by `refusal` first; this only runs it. */
export async function dispatch(req: DispatchRequest, deps: ActionDeps): Promise<DispatchResult> {
  const claude = await deps.claude()
  if (!claude) return { ok: false, error: NO_CLI, untrusted: false }
  const name = sessionName(req.prompt)
  const r = await run(claude, dispatchArgs(req, name, /\.cmd$/i.test(claude)), DISPATCH_TIMEOUT_MS, cleanEnv(), req.cwd)
  return dispatchResult(r, name)
}
