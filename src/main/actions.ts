import { existsSync, statSync } from 'node:fs'
import { win32 } from 'node:path'
import type { ActionResult, LogsResult, SessionAction } from '@shared/bridge'
import type { Session } from '@shared/snapshot'
import { launch, run, which } from '../collector/cli'

/** ADR-0008 timeouts. */
const STOP_TIMEOUT_MS = 15_000
const LOGS_TIMEOUT_MS = 10_000
/** The drawer shows the tail; `claude logs` prints the recent screen, so this is never hit in practice. */
const LOGS_MAX = 64 * 1024

export interface ActionDeps {
  /** The resolved Claude Code CLI (ADR-0008), or null when none was found. */
  claude(): Promise<string | null>
  copy(text: string): void
}

const fail = (error: string): ActionResult => ({ ok: false, error })
const NO_CLI = 'AgentDeck could not find the Claude Code CLI (claude.exe), so it can not run this.'
const NOT_BG = 'Only background sessions (claude --bg) can be attached, stopped or read with claude logs.'

/** CSI, OSC and two-byte escapes: `claude logs` prints the raw TUI screen (S7). */
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g

export function stripAnsi(s: string): string {
  return s.replace(ANSI, '').replace(/\r\n?/g, '\n')
}

/** First line of what the CLI said, for an inline error. */
function said(r: { stdout: string; stderr: string }): string {
  return (r.stderr.trim() || r.stdout.trim()).split('\n')[0]!.slice(0, 300)
}

const folder = (cwd: string): string | undefined => (cwd && existsSync(cwd) ? cwd : undefined)

/**
 * `code` is VS Code's PATH shim (code.cmd), which cross-spawn runs without a shell string (ADR-0008).
 * `where` also lists the extensionless shell script next to it, which Windows can't start.
 */
export async function openInCode(args: string[]): Promise<ActionResult> {
  const code = (await which('code')).find((p) => /\.(cmd|exe)$/i.test(p))
  if (!code) return fail("VS Code's `code` command is not on PATH. In VS Code, run Shell Command: Install 'code' command in PATH.")
  const err = await launch(code, args, { hide: true })
  return err === null ? { ok: true } : fail(err)
}

export function openFile(path: string): Promise<ActionResult> {
  if (!win32.isAbsolute(path) || path.startsWith('-')) return Promise.resolve(fail('AgentDeck opens only absolute file paths.'))
  try {
    if (!statSync(path).isFile()) return Promise.resolve(fail('That is not a file.'))
  } catch {
    return Promise.resolve(fail('The file is no longer there.'))
  }
  return openInCode(['-g', path])
}

/** UI_MAP § Session drawer. Background-only actions refuse other sessions instead of guessing. */
export async function act(action: SessionAction, s: Session, deps: ActionDeps): Promise<ActionResult> {
  if (action === 'copy-resume') {
    deps.copy(`claude --resume ${s.id}`)
    return { ok: true }
  }
  if (action === 'open-folder') {
    const cwd = folder(s.cwd)
    return cwd ? openInCode([cwd]) : fail('The session folder is no longer there.')
  }
  const claude = await deps.claude()
  if (!claude) return fail(NO_CLI)
  if (action === 'open-desktop') {
    // `--desktop` with `--resume <id>` opens the session in Claude Desktop (`claude --help`).
    const err = await launch(claude, ['--desktop', '--resume', s.id], { cwd: folder(s.cwd), hide: true })
    return err === null ? { ok: true } : fail(err)
  }
  if (!s.bgId) return fail(NOT_BG)
  if (action === 'attach') {
    // Windows Terminal when present, otherwise a console window of its own (ADR-0008, F13).
    const [wt] = await which('wt.exe')
    const cwd = folder(s.cwd)
    const err = wt
      ? await launch(wt, [...(cwd ? ['-d', cwd] : []), claude, 'attach', s.bgId], { hide: false })
      : await launch(claude, ['attach', s.bgId], { cwd, hide: false })
    return err === null ? { ok: true } : fail(err)
  }
  const r = await run(claude, ['stop', s.bgId], STOP_TIMEOUT_MS)
  return r.code === 0 ? { ok: true } : fail(r.code === null ? 'claude stop did not answer in time.' : said(r) || `claude stop exited with ${r.code}.`)
}

export async function logs(s: Session, deps: ActionDeps): Promise<LogsResult> {
  if (!s.bgId) return { ok: false, error: NOT_BG }
  const claude = await deps.claude()
  if (!claude) return { ok: false, error: NO_CLI }
  const r = await run(claude, ['logs', s.bgId], LOGS_TIMEOUT_MS)
  if (r.code !== 0) return { ok: false, error: r.code === null ? 'claude logs did not answer in time.' : said(r) || `claude logs exited with ${r.code}.` }
  return { ok: true, text: stripAnsi(r.stdout).slice(-LOGS_MAX) }
}
