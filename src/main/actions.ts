import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ActionResult, LogsResult, OpenTargets, SessionAction } from '@shared/bridge'
import { NOT_DELETABLE } from '@shared/session-meta'
import { RESUME_PATTERN } from '@shared/console'
import { PROVIDER_NAME, providerOf, type Session } from '@shared/snapshot'
import { cleanEnv, launch, run, system32, which } from '../collector/cli'
import { focusWindowOf, type FocusResult } from './focus-window'

/** ADR-0008 timeouts. */
const STOP_TIMEOUT_MS = 15_000
const LOGS_TIMEOUT_MS = 10_000
const RM_TIMEOUT_MS = 30_000
/** Whether Cursor is installed is asked at most this often: it runs `where.exe`. */
const TARGETS_TTL_MS = 60_000
/** The drawer shows the tail; `claude logs` prints the recent screen, so this is never hit in practice. */
const LOGS_MAX = 64 * 1024

export interface ActionDeps {
  /** The resolved Claude Code CLI (ADR-0008), or null when none was found. */
  claude(): Promise<string | null>
  copy(text: string): void
  /** Brings a process's window to the front (focus-window.ts); a test passes its own. */
  focus?(pid: number): Promise<FocusResult>
  /** Opens a folder in the file manager (Electron's shell.openPath): '' when it worked, otherwise why not. */
  openFolder?(path: string): Promise<string>
  /** Which launchers to use; a test passes the other platform's. Folder checks always follow the real one. */
  platform?: NodeJS.Platform
}

const fail = (error: string): ActionResult => ({ ok: false, error })
const done = (err: string | null): ActionResult => (err === null ? { ok: true } : fail(err))
export const NO_CLI = 'AgentDeck could not find the Claude Code CLI (claude), so it can not run this.'
const NOT_BG = 'Only background sessions (claude --bg) can be attached, stopped or read with claude logs.'
const NO_RESUME = 'This session id is not one AgentDeck can put in a command.'
const FOLDER_ACTIONS = new Set<SessionAction>(['open-folder', 'open-cursor', 'open-terminal', 'open-explorer'])
const NO_FOLDER = 'The session folder is no longer there.'

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
 * Local paths only. Windows: a drive path; a UNC path (`\\host\share`) would make Windows contact that host, and a stat on
 * it can block for the whole SMB timeout. Elsewhere: an absolute path that does not start `//` (a network path on some systems).
 */
export const localPathRe = (platform: NodeJS.Platform): RegExp => (platform === 'win32' ? /^[A-Za-z]:[\\/]/ : /^\/(?!\/)/)
export const LOCAL_PATH = localPathRe(process.platform)

async function isDir(p: string): Promise<boolean> {
  if (!LOCAL_PATH.test(p)) return false
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}

const folder = async (cwd: string): Promise<string | undefined> => ((await isDir(cwd)) ? cwd : undefined)

/** `where code` also lists the extensionless shell script next to code.cmd, which Windows can't start; elsewhere that script is the one. */
export const runnable = (paths: readonly string[], platform: NodeJS.Platform = process.platform): string | undefined =>
  platform === 'win32' ? paths.find((p) => /\.(cmd|exe)$/i.test(p)) : paths[0]

/** On macOS an editor's command line tool sits inside its app bundle, even when it was never put on PATH. */
const inBundle = (app: string, tool: string, env: NodeJS.ProcessEnv): string[] =>
  ['/Applications', env.HOME && join(env.HOME, 'Applications')]
    .filter((d): d is string => Boolean(d))
    .map((d) => join(d, `${app}.app`, 'Contents', 'Resources', 'app', 'bin', tool))

/** VS Code's `code` where it is not on PATH. */
export const codeCandidates = (env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] =>
  platform === 'darwin' ? inBundle('Visual Studio Code', 'code', env) : []

/** `code` is VS Code's PATH shim (code.cmd), which cross-spawn runs without a shell string (ADR-0008). */
export async function openInCode(args: string[], platform: NodeJS.Platform = process.platform): Promise<ActionResult> {
  const code = runnable(await which('code', platform), platform) ?? codeCandidates(process.env, platform).find((p) => existsSync(p))
  if (!code) return fail("VS Code's `code` command is not on PATH. In VS Code, run Shell Command: Install 'code' command in PATH.")
  return done(await launch(code, args, { hide: true }))
}

/** Cursor's `cursor` shim: on PATH, or where its installer puts it (per user on Windows, in the app bundle on macOS). */
export function cursorCandidates(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'darwin') return inBundle('Cursor', 'cursor', env)
  return env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, 'Programs', 'cursor', 'resources', 'app', 'bin', 'cursor.cmd')] : []
}

export async function findCursor(platform: NodeJS.Platform = process.platform): Promise<string | undefined> {
  return runnable(await which('cursor', platform), platform) ?? cursorCandidates(process.env, platform).find((p) => existsSync(p))
}

/** The session menu offers Cursor only when it is there, so the item is never a dead one. */
let targets: { at: number; value: Promise<OpenTargets> } | null = null
export function openTargets(now = Date.now()): Promise<OpenTargets> {
  if (!targets || now - targets.at > TARGETS_TTL_MS) targets = { at: now, value: findCursor().then((cursor) => ({ cursor: cursor !== undefined })) }
  return targets.value
}

export async function openInCursor(args: string[], platform: NodeJS.Platform = process.platform): Promise<ActionResult> {
  const cursor = await findCursor(platform)
  if (!cursor) return fail('Cursor was not found. Its `cursor` command is not on PATH.')
  return done(await launch(cursor, args, { hide: true }))
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

/** One POSIX shell word: in single quotes, with a quote inside closed, escaped and reopened. */
export const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

/**
 * macOS: AppleScript that opens a new window of the terminal app (iTerm when it is installed, otherwise Terminal) and runs
 * `argv[1]` in its shell. The command reaches osascript as an argument, never inside the script text, so the shell quoting
 * above is the only quoting (the same idea as D-095's env vars). macOS asks once before AgentDeck may control that app.
 */
const MAC_TERMINALS = {
  Terminal: ['tell application "Terminal"', 'activate', 'do script (item 1 of argv)', 'end tell'],
  iTerm: ['tell application "iTerm"', 'activate', 'set w to (create window with default profile)', 'tell current session of w to write text (item 1 of argv)', 'end tell']
}

export function macTerminalArgs(command: string, app: keyof typeof MAC_TERMINALS): string[] {
  return [...['on run argv', ...MAC_TERMINALS[app], 'end run'].flatMap((line) => ['-e', line]), command]
}

async function inMacTerminal(command: string): Promise<string | null> {
  const err = await launch('/usr/bin/osascript', macTerminalArgs(command, existsSync('/Applications/iTerm.app') ? 'iTerm' : 'Terminal'), { hide: false })
  return err && `${err} If macOS asked, allow AgentDeck to control your terminal in System Settings > Privacy & Security > Automation.`
}

/**
 * Windows Terminal when present, otherwise a console window (ADR-0008, F13). `args` are plain words, never user text.
 * wt splits its command line at `;` (Windows Terminal § Command line syntax) and documents no escape for one inside a
 * value, so a path with a `;` takes the console window, whose values travel in env vars (D-111). macOS: a new terminal window.
 */
async function inTerminal(claude: string, args: readonly string[], cwd: string, platform: NodeJS.Platform): Promise<string | null> {
  if (platform === 'darwin') return inMacTerminal(`cd ${shQuote(cwd)} && ${[claude, ...args].map(shQuote).join(' ')}`)
  const [wt] = await which('wt.exe', platform)
  return wt && !`${cwd}${claude}`.includes(';') ? launch(wt, ['-d', cwd, claude, ...args], { hide: false }) : inConsole(claude, args, cwd)
}

/** A terminal in the folder: Windows Terminal when present, otherwise a PowerShell console window (D-111 for `;`). */
export async function terminalHere(cwd: string, platform: NodeJS.Platform = process.platform): Promise<ActionResult> {
  if (platform === 'darwin') return done(await inMacTerminal(`cd ${shQuote(cwd)}`))
  const [wt] = await which('wt.exe', platform)
  if (wt && !cwd.includes(';')) return done(await launch(wt, ['-d', cwd], { hide: false }))
  return done(await inConsole(system32('WindowsPowerShell', 'v1.0', 'powershell.exe'), [], cwd))
}

/** The fix for `Workspace not trusted` (S6): run `claude` there once and accept the trust prompt. */
export async function runClaudeIn(cwd: string, deps: ActionDeps): Promise<ActionResult> {
  if (!(await isDir(cwd))) return fail('That folder is not there (or not on a local drive).')
  const claude = await deps.claude()
  return claude ? done(await inTerminal(claude, [], cwd, deps.platform ?? process.platform)) : fail(NO_CLI)
}

/** Background ids are short and plain (S7); anything else is not passed on to a command line. */
const BG_ID = /^\w[\w.-]{0,63}$/

/**
 * "Answer in terminal": takes the user to the window the session runs in. When it cannot (no process id yet, or no window
 * above it), it says where the session is waiting instead, so the click is never a dead end.
 */
export async function focusTerminal(s: Session, focus: (pid: number) => Promise<FocusResult>): Promise<ActionResult> {
  const where = s.cwd ? ` It is waiting in a terminal at ${s.cwd}.` : ''
  if (!s.pid) return fail(`AgentDeck does not know which window ${s.name} runs in yet.${where}`)
  const r = await focus(s.pid)
  if (r.ok) return { ok: true }
  return fail(r.reason === 'no-window' ? `AgentDeck could not find the window ${s.name} runs in.${where}` : `AgentDeck could not bring the window forward.${where}`)
}

/**
 * `claude rm <id>`: removes a background session from Claude Code's list (and its worktree, when it has a clean one); the
 * conversation is kept (`claude --help`, 2.1.323). Only background sessions, and only an id that is plain. A session that
 * may still be running is stopped first, because rm refuses one ("If it's safe"); a stop that fails is not fatal, since rm
 * says what is wrong. `--discard-unpushed` and `--force-remove-worktree` are never passed.
 */
export async function deleteBackground(s: Session, deps: ActionDeps): Promise<ActionResult> {
  if (!s.bgId || !BG_ID.test(s.bgId)) return fail(NOT_DELETABLE)
  const claude = await deps.claude()
  if (!claude) return fail(NO_CLI)
  if (s.status !== 'done' && s.status !== 'failed') await run(claude, ['stop', s.bgId], STOP_TIMEOUT_MS)
  const r = await run(claude, ['rm', s.bgId], RM_TIMEOUT_MS)
  return r.code === 0 ? { ok: true } : fail(r.code === null ? 'claude rm did not answer in time.' : said(r) || `claude rm exited with ${r.code}.`)
}

/** UI_MAP § Session drawer. Background-only actions refuse other sessions instead of guessing. */
export async function act(action: SessionAction, s: Session, deps: ActionDeps): Promise<ActionResult> {
  const provider = providerOf(s.id)
  if (action === 'copy-resume') {
    if (provider === 'claude') deps.copy(`claude --resume ${s.id}`)
    else {
      // The id came in a hook body and ends up pasted into a terminal: only a plain one is copied (`codex resume --help`).
      const id = s.id.slice(provider.length + 1)
      if (!RESUME_PATTERN.test(id)) return fail(NO_RESUME)
      deps.copy(`${provider} resume ${id}`)
    }
    return { ok: true }
  }
  if (action === 'focus-terminal') return focusTerminal(s, deps.focus ?? ((pid) => focusWindowOf(pid)))
  // Folders and the terminal work for any CLI; the rest drive the claude CLI (ADR-0014).
  if (provider !== 'claude' && !FOLDER_ACTIONS.has(action)) return fail(`Only Claude Code sessions can do that. This one runs in ${PROVIDER_NAME[provider]}.`)
  if (action === 'delete-background') return deleteBackground(s, deps)
  const platform = deps.platform ?? process.platform
  const cwd = await folder(s.cwd)
  if (action === 'open-folder') return cwd ? openInCode([cwd], platform) : fail(NO_FOLDER)
  if (action === 'open-cursor') return cwd ? openInCursor([cwd], platform) : fail(NO_FOLDER)
  if (action === 'open-terminal') return cwd ? terminalHere(cwd, platform) : fail(NO_FOLDER)
  if (action === 'open-explorer') {
    if (!cwd) return fail(NO_FOLDER)
    return deps.openFolder ? done((await deps.openFolder(cwd)) || null) : fail('AgentDeck could not open the folder.')
  }
  const claude = await deps.claude()
  if (!claude) return fail(NO_CLI)
  // `--desktop` with `--resume <id>` opens the session in Claude Desktop (`claude --help`).
  if (action === 'open-desktop') return done(await launch(claude, ['--desktop', '--resume', s.id], { cwd, hide: true }))
  if (!s.bgId || !BG_ID.test(s.bgId)) return fail(NOT_BG)
  if (action === 'attach') return done(await inTerminal(claude, ['attach', s.bgId], cwd ?? homedir(), platform))
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
