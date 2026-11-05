import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import type { ActionResult, LogsResult, SessionAction } from '@shared/bridge'
import type { Session } from '@shared/snapshot'
import { cleanEnv, launch, run, system32, which } from '../collector/cli'

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
const done = (err: string | null): ActionResult => (err === null ? { ok: true } : fail(err))
export const NO_CLI = 'AgentDeck could not find the Claude Code CLI (claude.exe), so it can not run this.'
const NOT_BG = 'Only background sessions (claude --bg) can be attached, stopped or read with claude logs.'

/** CSI, OSC, charset (`ESC ( B`) and two-byte escapes: `claude logs` prints the raw TUI screen (S7). */
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-Za-z]|\x1b[@-Z\\-_]/g

export function stripAnsi(s: string): string {
  return s.replace(ANSI, '').replace(/\r\n?/g, '\n')
}

/** First line of what the CLI said, for an inline error. */
export function said(r: { stdout: string; stderr: string }): string {
  return (stripAnsi(r.stderr).trim() || stripAnsi(r.stdout).trim()).split('\n')[0]!.slice(0, 300)
}

/**
 * Local drive paths only: a UNC path (`\\host\share`) would make Windows contact that host, and a stat on it can
 * block for the whole SMB timeout.
 */
export const LOCAL_PATH = /^[A-Za-z]:[\\/]/

async function isDir(p: string): Promise<boolean> {
  if (!LOCAL_PATH.test(p)) return false
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}

const folder = async (cwd: string): Promise<string | undefined> => ((await isDir(cwd)) ? cwd : undefined)

/** `where code` also lists the extensionless shell script next to code.cmd, which Windows can't start. */
export const runnable = (paths: readonly string[]): string | undefined => paths.find((p) => /\.(cmd|exe)$/i.test(p))

/** `code` is VS Code's PATH shim (code.cmd), which cross-spawn runs without a shell string (ADR-0008). */
export async function openInCode(args: string[]): Promise<ActionResult> {
  const code = runnable(await which('code'))
  if (!code) return fail("VS Code's `code` command is not on PATH. In VS Code, run Shell Command: Install 'code' command in PATH.")
  return done(await launch(code, args, { hide: true }))
}

export async function openFile(path: string): Promise<ActionResult> {
  if (!LOCAL_PATH.test(path)) return fail('AgentDeck opens only files on a local drive.')
  try {
    if (!(await stat(path)).isFile()) return fail('That is not a file.')
  } catch {
    return fail('The file is no longer there.')
  }
  return openInCode(['-g', path])
}

/** Fixed command text; the values arrive in env vars, so nothing is ever parsed as PowerShell (D-095). */
const START_PROCESS = 'Start-Process -FilePath $env:AGENTDECK_FILE -WorkingDirectory $env:AGENTDECK_CWD'

/**
 * A console program in a window of its own, without Windows Terminal (the brief's PowerShell fallback). Start-Process
 * gives it a real console; spawned directly, a GUI app's child gets NUL handles and a TUI can't read keys (D-095).
 */
function inConsole(file: string, args: readonly string[], cwd: string): Promise<string | null> {
  const env = { ...cleanEnv(), AGENTDECK_FILE: file, AGENTDECK_CWD: cwd, AGENTDECK_ARGS: args.join(' ') }
  const command = args.length ? `${START_PROCESS} -ArgumentList $env:AGENTDECK_ARGS` : START_PROCESS
  return launch(system32('WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', command], { hide: true, env })
}

/**
 * Windows Terminal when present, otherwise a console window (ADR-0008, F13). `args` are plain words, never user text.
 * wt splits its command line at `;` (Windows Terminal § Command line syntax) and documents no escape for one inside a
 * value, so a path with a `;` takes the console window, whose values travel in env vars (D-111).
 */
async function inTerminal(claude: string, args: readonly string[], cwd: string): Promise<string | null> {
  const [wt] = await which('wt.exe')
  return wt && !`${cwd}${claude}`.includes(';') ? launch(wt, ['-d', cwd, claude, ...args], { hide: false }) : inConsole(claude, args, cwd)
}

/** The fix for `Workspace not trusted` (S6): run `claude` there once and accept the trust prompt. */
export async function runClaudeIn(cwd: string, deps: ActionDeps): Promise<ActionResult> {
  if (!(await isDir(cwd))) return fail('That folder is not there (or not on a local drive).')
  const claude = await deps.claude()
  return claude ? done(await inTerminal(claude, [], cwd)) : fail(NO_CLI)
}

/** Background ids are short and plain (S7); anything else is not passed on to a command line. */
const BG_ID = /^\w[\w.-]{0,63}$/

/** UI_MAP § Session drawer. Background-only actions refuse other sessions instead of guessing. */
export async function act(action: SessionAction, s: Session, deps: ActionDeps): Promise<ActionResult> {
  if (action === 'copy-resume') {
    deps.copy(`claude --resume ${s.id}`)
    return { ok: true }
  }
  const cwd = await folder(s.cwd)
  if (action === 'open-folder') return cwd ? openInCode([cwd]) : fail('The session folder is no longer there.')
  const claude = await deps.claude()
  if (!claude) return fail(NO_CLI)
  // `--desktop` with `--resume <id>` opens the session in Claude Desktop (`claude --help`).
  if (action === 'open-desktop') return done(await launch(claude, ['--desktop', '--resume', s.id], { cwd, hide: true }))
  if (!s.bgId || !BG_ID.test(s.bgId)) return fail(NOT_BG)
  if (action === 'attach') return done(await inTerminal(claude, ['attach', s.bgId], cwd ?? homedir()))
  const r = await run(claude, ['stop', s.bgId], STOP_TIMEOUT_MS)
  return r.code === 0 ? { ok: true } : fail(r.code === null ? 'claude stop did not answer in time.' : said(r) || `claude stop exited with ${r.code}.`)
}

export async function logs(s: Session, deps: ActionDeps): Promise<LogsResult> {
  if (!s.bgId || !BG_ID.test(s.bgId)) return { ok: false, error: NOT_BG }
  const claude = await deps.claude()
  if (!claude) return { ok: false, error: NO_CLI }
  const r = await run(claude, ['logs', s.bgId], LOGS_TIMEOUT_MS)
  if (r.code !== 0) return { ok: false, error: r.code === null ? 'claude logs did not answer in time.' : said(r) || `claude logs exited with ${r.code}.` }
  return { ok: true, text: stripAnsi(r.stdout).slice(-LOGS_MAX) }
}
