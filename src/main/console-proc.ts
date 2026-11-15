import type { ChildProcess } from 'node:child_process'
import spawn from 'cross-spawn'
import type { ConsoleOptions, PermissionMode } from '@shared/console'
import type { Effort } from '@shared/bridge'
import { cap } from '../collector/redact'
import { run, system32 } from '../collector/cli'
import { LineSplitter } from './console-text'

/** The resolved CLI, plus any arguments that come before ours (empty for the real one; a test points `file` at node). */
export interface ClaudeCommand {
  file: string
  args: string[]
}

export interface ProcOptions {
  model: string | null
  effort: Effort
  permissionMode: PermissionMode
  resume: string | null
  /** `--fork-session`, only together with `resume`. */
  fork?: boolean
  /** `--agents <file>` and `--agent <name>`, from console-roles.ts. Never with `resume`. */
  roleArgs?: readonly string[]
  options: ConsoleOptions
}

/** Line breaks as spaces, for the one free-text argument when cmd.exe is in the way. */
const oneLine = (s: string): string => s.split(/\r?\n|\r/).map((l) => l.trim()).filter(Boolean).join(' ')

/** An npm install gives `claude.cmd`, which cmd.exe runs. */
export const isShim = (file: string): boolean => /\.(cmd|bat)$/i.test(file)

/**
 * `claude -p` with stream-json both ways (headless § Stream responses; 2.1.323 `--help`). The prompt never rides on the
 * command line: it goes through stdin as JSON. Every value here is an enum or matches a pattern that starts with a letter or digit,
 * so none can read as an option. `--permission-mode` is always given, so a `permissions.defaultMode` in the user's settings
 * never applies to a conversation started here: bypassPermissions is used only when the user picked it for this conversation.
 * The Advanced options are validated by console.ts (patterns in shared/console.ts) and are plain values here: a rule list has no comma
 * inside a rule, so one comma-joined argument is exactly the documented form; the appended instructions are the only free text on the
 * command line (capped at 2,000 characters), and cmd.exe behind an npm shim ends a command at a line break, so there they become spaces.
 */
export function consoleArgs(o: ProcOptions, viaCmd = false): string[] {
  const x = o.options
  return [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--effort', o.effort,
    '--permission-mode', o.permissionMode,
    ...(o.model ? ['--model', o.model] : []),
    ...(o.resume ? ['--resume', o.resume, ...(o.fork ? ['--fork-session'] : [])] : []),
    ...(o.roleArgs ?? []),
    ...(x.allowedTools.length ? ['--allowedTools', x.allowedTools.join(',')] : []),
    ...(x.disallowedTools.length ? ['--disallowedTools', x.disallowedTools.join(',')] : []),
    ...(x.addDirs.length ? ['--add-dir', ...x.addDirs] : []),
    ...(x.fallbackModel ? ['--fallback-model', x.fallbackModel] : []),
    ...(x.maxBudgetUsd !== null ? ['--max-budget-usd', String(x.maxBudgetUsd)] : []),
    ...(x.appendSystemPrompt ? ['--append-system-prompt', viaCmd ? oneLine(x.appendSystemPrompt) : x.appendSystemPrompt] : [])
  ]
}

export interface ExitInfo {
  code: number | null
  signal: string | null
  /** The last of stderr, for the reason. */
  stderr: string
  /** The program never started. */
  spawnFailed: boolean
}

export interface ProcHooks {
  onLine(line: string): void
  onExit(info: ExitInfo): void
}

const STDERR_TAIL = 4_096
const KILL_TIMEOUT_MS = 5_000

/** One running `claude -p`. Writes are JSON lines; closing stdin lets it finish and exit. */
export interface ConsoleChild {
  write(message: unknown): boolean
  endInput(): void
  /** The process and everything it started (Bash tool shells): on Windows `claude.exe` does not take its children with it. */
  killTree(): void
  readonly exited: boolean
}

/**
 * The process and what it started. Windows: taskkill /T (claude.exe does not take its children with it). Elsewhere the child
 * is spawned as the leader of its own process group (spawnConsole), so SIGTERM to the group reaches the shells it started
 * too, unless one started a group of its own. Nothing guarantees that claude ends its children on SIGTERM, so the group is
 * the safe choice; the plain kill after it covers a child that has no group (it was never spawned detached).
 */
export function killProcessTree(child: ChildProcess, platform: NodeJS.Platform = process.platform, kill: typeof process.kill = process.kill): void {
  const pid = child.pid
  if (platform === 'win32' && pid) void run(system32('taskkill.exe'), ['/PID', String(pid), '/T', '/F'], KILL_TIMEOUT_MS)
  if (platform !== 'win32' && pid) {
    try {
      kill(-pid, 'SIGTERM')
    } catch {
      // the group is gone already
    }
  }
  child.kill()
}

export function spawnConsole(cmd: ClaudeCommand, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, hooks: ProcHooks): ConsoleChild {
  const lines = new LineSplitter()
  let stderr = ''
  let exited = false
  let inputOpen = true
  let child: ChildProcess
  const finish = (info: Omit<ExitInfo, 'stderr'>): void => {
    if (exited) return
    exited = true
    for (const line of lines.flush()) hooks.onLine(line)
    hooks.onExit({ ...info, stderr: stderr.trim() })
  }
  try {
    // POSIX: its own process group, so killTree can end the shells it starts. Never on Windows, where detached means no console.
    child = spawn(cmd.file, [...cmd.args, ...args], { cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (e) {
    // Node throws instead of emitting 'error' for some failures, e.g. a command line over 32,767 characters.
    queueMicrotask(() => {
      stderr = (e as Error).message
      finish({ code: null, signal: null, spawnFailed: true })
    })
    return { write: () => false, endInput: () => undefined, killTree: () => undefined, get exited() { return exited } }
  }
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    for (const line of lines.push(chunk)) hooks.onLine(line)
  })
  child.stderr?.on('data', (chunk: string) => {
    stderr = cap(`${stderr}${chunk}`.slice(-STDERR_TAIL), STDERR_TAIL)
  })
  // A write to a closed pipe (the child already left) reports EPIPE here; the exit event says why.
  child.stdin?.on('error', () => {
    inputOpen = false
  })
  child.on('error', (e) => {
    stderr = e.message
    finish({ code: null, signal: null, spawnFailed: true })
  })
  child.on('close', (code, signal) => finish({ code, signal, spawnFailed: false }))

  return {
    write(message) {
      if (!inputOpen || exited || !child.stdin?.writable) return false
      child.stdin.write(`${JSON.stringify(message)}\n`)
      return true
    },
    endInput() {
      if (!inputOpen) return
      inputOpen = false
      child.stdin?.end()
    },
    killTree() {
      if (!exited) killProcessTree(child)
    },
    get exited() {
      return exited
    }
  }
}
