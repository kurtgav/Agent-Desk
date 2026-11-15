import type { ChildProcess } from 'node:child_process'
import { existsSync, lstatSync } from 'node:fs'
import { basename, join } from 'node:path'
import spawn from 'cross-spawn'

const VERSION_RE = /^\d+\.\d+\.\d+ \(Claude Code\)/
const VERSION_TIMEOUT_MS = 5_000
const MAX_OUTPUT = 8 * 1024 * 1024
/**
 * A program that fails to start does so at once; one still running after this counts as started. Only the program
 * spawned is watched: wt.exe and PowerShell's Start-Process exit 0 once they hand off, so a `claude attach` that then
 * fails in its own window (an unknown id) is not seen here (D-095).
 */
const EARLY_EXIT_MS = 2_000

export interface RunResult {
  code: number | null
  stdout: string
  /** Where the CLI prints its errors, e.g. `Workspace not trusted` (S6). Capped like stdout. */
  stderr: string
}

const FAILED: RunResult = { code: null, stdout: '', stderr: '' }

/**
 * D-025: a spawned `claude` must not think it is a child of another session (F8), so every CLAUDE* variable goes,
 * except CLAUDE_CONFIG_DIR, which says where the user's settings and sessions live (D-047).
 */
export function cleanEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(env)) {
    const key = k.toUpperCase()
    if (v !== undefined && (!key.startsWith('CLAUDE') || key === 'CLAUDE_CONFIG_DIR')) out[k] = v
  }
  return out
}

/** Windows tools by absolute path: a bare name is looked up in the current directory first. */
export function system32(...parts: string[]): string {
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', ...parts)
}

/**
 * Argument array, no shell, hidden window, hard timeout (ADR-0008).
 * A timeout settles at once: killing a `.cmd` shim ends cmd.exe, but its child can keep the pipe (and `close`) open.
 */
export function run(
  file: string,
  args: readonly string[],
  timeoutMs: number,
  env: NodeJS.ProcessEnv = cleanEnv(),
  cwd?: string
): Promise<RunResult> {
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(file, [...args], { env, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      // Node throws instead of emitting 'error' for some failures, e.g. ENAMETOOLONG for a command line over 32,767.
      return resolve({ ...FAILED, stderr: (e as Error).message })
    }
    const out: Buffer[] = []
    const err: Buffer[] = []
    let size = 0
    let settled = false
    const settle = (r: RunResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }
    const abort = (): void => {
      child.kill()
      settle(FAILED)
    }
    const timer = setTimeout(abort, timeoutMs)
    const collect = (into: Buffer[]) => (c: Buffer) => {
      size += c.length
      if (size <= MAX_OUTPUT) into.push(c)
      else abort()
    }
    child.stdout?.on('data', collect(out))
    child.stderr?.on('data', collect(err))
    child.on('error', (e) => settle({ ...FAILED, stderr: e.message }))
    child.on('close', (code) => settle({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }))
  })
}

/**
 * Starts a program that outlives AgentDeck (Windows Terminal, VS Code, Claude Desktop), argument array, no shell
 * (ADR-0008). Resolves with null once it started and did not fail within `watchMs`, or with the reason it failed.
 * Not `detached`: on Windows that is DETACHED_PROCESS, and a console program without a console does nothing (D-095).
 * A Windows child outlives its parent anyway.
 */
export function launch(
  file: string,
  args: readonly string[],
  opts: { cwd?: string; hide: boolean; env?: NodeJS.ProcessEnv; watchMs?: number }
): Promise<string | null> {
  // cross-spawn runs a path it can't resolve through cmd.exe, which starts fine and fails later.
  // lstat, not exists: Windows Terminal's wt.exe is an app execution alias, a reparse point stat may not follow.
  if (!lstatSync(file, { throwIfNoEntry: false })) return Promise.resolve(`${file} was not found`)
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(file, [...args], { cwd: opts.cwd, env: opts.env ?? cleanEnv(), stdio: 'ignore', windowsHide: opts.hide })
    } catch (e) {
      return resolve((e as Error).message)
    }
    let timer: NodeJS.Timeout | undefined
    let settled = false
    const settle = (r: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.unref()
      resolve(r)
    }
    child.once('spawn', () => {
      timer = setTimeout(() => settle(null), opts.watchMs ?? EARLY_EXIT_MS)
    })
    child.once('exit', (code) => settle(code === 0 ? null : `${basename(file)} exited with ${code ?? 'a signal'}.`))
    child.on('error', (e) => settle(e.message))
  })
}

/**
 * The Desktop app's own exe is also named claude.exe, and Desktop bundles a second CLI (F1). On macOS the app is Claude.app and
 * its data (where a bundled CLI would live) is under ~/Library/Application Support/Claude (unverified on a Mac).
 */
export function isDesktopPath(p: string): boolean {
  return /\\WindowsApps\\Claude_|\\Claude-Data\\|\/Claude\.app\/|\/Application Support\/Claude\//i.test(p)
}

export async function isClaudeCli(file: string): Promise<boolean> {
  const { code, stdout } = await run(file, ['--version'], VERSION_TIMEOUT_MS)
  return code === 0 && VERSION_RE.test(stdout.trim())
}

/** Every match of `<name>` on PATH, in order (`where.exe` on Windows, `which -a` elsewhere); none when it isn't there. */
export async function which(name: string, platform: NodeJS.Platform = process.platform, exec: typeof run = run): Promise<string[]> {
  const r = platform === 'win32' ? await exec(system32('where.exe'), [name], VERSION_TIMEOUT_MS) : await exec('/usr/bin/which', ['-a', name], VERSION_TIMEOUT_MS)
  return r.code === 0 ? r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : []
}

/**
 * D-024, in order: the Settings override, the native installer's path, PATH (minus Desktop's copies), then where npm puts a
 * global install. Windows: ~/.local/bin/claude.exe, `where claude`, %APPDATA%\npm\claude.cmd. macOS: ~/.local/bin/claude,
 * `which -a claude` (on the login shell's PATH, see loginShellPath), then Homebrew's and the Node installer's npm prefixes.
 */
export async function resolveClaude(
  override: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  deps: { which: typeof which; exists: (p: string) => boolean; isCli: (p: string) => Promise<boolean> } = { which, exists: existsSync, isCli: isClaudeCli }
): Promise<string | null> {
  const win = platform === 'win32'
  const home = (win ? env.USERPROFILE : env.HOME) ?? ''
  const found = await deps.which('claude', platform)
  const candidates = [
    override,
    home && join(home, '.local', 'bin', win ? 'claude.exe' : 'claude'),
    ...found.filter((p) => !isDesktopPath(p)),
    ...(win ? [env.APPDATA && join(env.APPDATA, 'npm', 'claude.cmd')] : ['/opt/homebrew/bin/claude', '/usr/local/bin/claude'])
  ].filter((p): p is string => Boolean(p))
  for (const c of [...new Set(candidates)]) if (deps.exists(c) && (await deps.isCli(c))) return c
  return null
}

const PATH_MARK = '__AGENTDECK_PATH__'
const SHELL_TIMEOUT_MS = 3_000

/**
 * macOS gives an app started from Finder or the Dock a bare PATH (no Homebrew, nvm or npm prefix), so `claude` and what it
 * starts would not be found. This asks the user's login shell once, as Terminal would set it up, and reads PATH between
 * markers (rc files may print). Null when the shell fails, is slow or prints nothing usable: the caller keeps its PATH.
 */
export async function loginShellPath(env: NodeJS.ProcessEnv = process.env, exec: typeof run = run): Promise<string | null> {
  const shell = env.SHELL?.startsWith('/') ? env.SHELL : '/bin/zsh'
  // oh-my-zsh would otherwise stop at its update prompt until the timeout.
  const r = await exec(shell, ['-ilc', `printf '${PATH_MARK}%s${PATH_MARK}' "$PATH"`], SHELL_TIMEOUT_MS, { ...cleanEnv(env), DISABLE_AUTO_UPDATE: 'true' })
  const path = new RegExp(`${PATH_MARK}(.*?)${PATH_MARK}`, 's').exec(r.stdout)?.[1]?.trim()
  return path && path.includes('/') ? path : null
}
