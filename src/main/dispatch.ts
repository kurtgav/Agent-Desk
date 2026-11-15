import { randomBytes } from 'node:crypto'
import { stat } from 'node:fs/promises'
import type { AgentDef, DispatchRequest, DispatchResult } from '@shared/bridge'
import { MODEL_PATTERN, type RoleRef } from '@shared/console'
import { pathKey } from '@shared/paths'
import { bgKey, nameKey } from '@shared/session-meta'
import { cleanEnv, run, type RunResult } from '../collector/cli'
import { LOCAL_PATH, NO_CLI, said, stripAnsi, type ActionDeps } from './actions'
import { SHIM_SAFE, definition } from './console-roles'
import type { RolesService } from './roles'

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
 * `claude --bg --name <n> [--agent <a>] [--model <m>] --effort <e> "<prompt>"` as an argument array (brief § Composer, `claude --help`;
 * `--model` with `--bg` is documented in agent-view). The model matches MODEL_PATTERN (refusal below), so it can not read as an option.
 * A prompt that starts with `-` gets a leading space, so the CLI can't read it as an option.
 * shortcut: through a `.cmd` shim, cmd.exe ends the command at a newline, so newlines become spaces there; claude.exe keeps them.
 */
export function dispatchArgs(req: DispatchRequest, name: string, viaCmd: boolean, roleArgs: readonly string[] = []): string[] {
  let prompt = req.prompt.trim()
  if (viaCmd) prompt = prompt.replace(/\s*[\r\n]+\s*/g, ' ')
  if (prompt.startsWith('-')) prompt = ` ${prompt}`
  // A role brings its own `--agent` (and `--agents` for one Claude Code does not have); `refusal` keeps it from meeting a subagent choice.
  const agent = roleArgs.length ? roleArgs : req.agent ? ['--agent', req.agent] : []
  return ['--bg', '--name', name, ...agent, ...(req.model ? ['--model', req.model] : []), '--effort', req.effort, prompt]
}

/**
 * Inline `--agents` JSON for a role Claude Code does not have. Checked on 2.1.323 for `claude -p`: a 20 KB definition with quotes, `&`,
 * `%` and emoji arrives intact through cross-spawn to claude.exe; Windows allows 32,767 characters in all, so the cap is well under.
 * shortcut: `--bg` with `--agents` is documented but not run here (a run starts a billed session); the file form is documented for `--print` only.
 */
export const INLINE_AGENTS_MAX = 20_000

export type RoleDispatch = { ok: true; role: RoleRef; args: string[] } | { ok: false; error: string }

/** `--agent <name>` for a role Claude Code has installed, else an inline definition under the role's id. Never a guessed name. */
export async function dispatchRole(roleId: string, deps: { roles: RolesService | null; viaCmd: boolean }): Promise<RoleDispatch> {
  if (!deps.roles) return { ok: false, error: 'AgentDeck is still reading its roles. Try again in a moment.' }
  const r = await deps.roles.roleForSpawn(roleId)
  if (!r) return { ok: false, error: `AgentDeck does not have the role “${roleId}” any more. Reload the roles and pick it again.` }
  const ref: RoleRef = { id: r.id, name: r.name, emoji: r.emoji }
  // The exact name of an installed agent (read from its file) is all Claude Code needs; through an npm `.cmd` shim a name with `&` is not safe.
  if (r.agentName !== null && (!deps.viaCmd || SHIM_SAFE.test(r.agentName))) return { ok: true, role: ref, args: ['--agent', r.agentName] }
  if (deps.viaCmd) return { ok: false, error: `“${r.name}” is not installed in Claude Code, and the npm claude.cmd shim can not carry a role on its command line. Start a conversation in the Console instead, or install the native Claude Code.` }
  const json = JSON.stringify({ [r.id]: definition(r) })
  if (json.length > INLINE_AGENTS_MAX) return { ok: false, error: `“${r.name}” is too long to start as a background task (over 20 KB of role text). Install it in Claude Code, or start a conversation in the Console.` }
  return { ok: true, role: ref, args: ['--agents', json, '--agent', r.id] }
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
  if (req.role && req.agent) return 'Pick a role or a subagent, not both.'
  if (req.model != null && !MODEL_PATTERN.test(req.model)) return 'That model name is not valid.'
  if (req.agent && !(await agentsIn(req.cwd)).some((a) => a.name === req.agent)) return `There is no subagent named ${req.agent} for this project.`
  return null
}

/** The request is checked by `refusal` first; this only runs it. `roleArgs` come from `dispatchRole`. */
export async function dispatch(req: DispatchRequest, deps: ActionDeps, roleArgs: readonly string[] = []): Promise<DispatchResult> {
  const claude = await deps.claude()
  if (!claude) return { ok: false, error: NO_CLI, untrusted: false }
  const name = sessionName(req.prompt)
  const r = await run(claude, dispatchArgs(req, name, /\.cmd$/i.test(claude), roleArgs), DISPATCH_TIMEOUT_MS, cleanEnv(), req.cwd)
  return dispatchResult(r, name)
}

export interface TaskDeps {
  known(): Iterable<string>
  agentsIn(cwd: string): Promise<AgentDef[]>
  actions: ActionDeps
  roles(): RolesService | null
  /** The background session started as a role: note the role under its name and its `claude --bg` id. */
  remember(keys: string[], roleId: string): void
}

/**
 * The Composer's and Tasks' "Send to an agent": the checks, the role (if any), the run, and the note of which role the new session
 * runs as, kept under the name AgentDeck gave it (the poll has not met its session id yet) and under the id `claude --bg` printed.
 */
export async function startDispatch(req: DispatchRequest, d: TaskDeps): Promise<DispatchResult> {
  const why = await refusal(req, d.known(), d.agentsIn)
  if (why) return { ok: false, error: why, untrusted: false }
  let roleArgs: string[] = []
  let role: RoleRef | null = null
  if (req.role) {
    const claude = await d.actions.claude()
    const planned = await dispatchRole(req.role, { roles: d.roles(), viaCmd: claude !== null && /\.cmd$/i.test(claude) })
    if (!planned.ok) return { ok: false, error: planned.error, untrusted: false }
    roleArgs = planned.args
    role = planned.role
  }
  const result = await dispatch(req, d.actions, roleArgs)
  if (result.ok && role) {
    try {
      d.remember([nameKey(result.name), ...(result.bgId ? [bgKey(result.bgId)] : [])], role.id)
    } catch {
      // The badge is a convenience: a started session is never reported as failed because config.json could not be written.
    }
  }
  return result
}
