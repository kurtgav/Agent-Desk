import { existsSync } from 'node:fs'
import { join } from 'node:path'
import spawn from 'cross-spawn'

const VERSION_RE = /^\d+\.\d+\.\d+ \(Claude Code\)/
const VERSION_TIMEOUT_MS = 5_000
const MAX_OUTPUT = 8 * 1024 * 1024

export interface RunResult {
  code: number | null
  stdout: string
}

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
export function run(file: string, args: readonly string[], timeoutMs: number, env: NodeJS.ProcessEnv = cleanEnv()): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(file, [...args], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    const chunks: Buffer[] = []
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
      settle({ code: null, stdout: '' })
    }
    const timer = setTimeout(abort, timeoutMs)
    child.stdout?.on('data', (c: Buffer) => {
      size += c.length
      if (size <= MAX_OUTPUT) chunks.push(c)
      else abort()
    })
    child.on('error', () => settle({ code: null, stdout: '' }))
    child.on('close', (code) => settle({ code, stdout: Buffer.concat(chunks).toString('utf8') }))
  })
}

/** The Desktop app's own exe is also named claude.exe, and Desktop bundles a second CLI (F1). */
export function isDesktopPath(p: string): boolean {
  return /\\WindowsApps\\Claude_|\\Claude-Data\\/i.test(p)
}

export async function isClaudeCli(file: string): Promise<boolean> {
  const { code, stdout } = await run(file, ['--version'], VERSION_TIMEOUT_MS)
  return code === 0 && VERSION_RE.test(stdout.trim())
}

/** D-024: Settings override → ~/.local/bin/claude.exe → `where claude` (minus Desktop paths) → npm global shim. */
export async function resolveClaude(override: string | undefined, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const home = env.USERPROFILE ?? ''
  const where = await run(system32('where.exe'), ['claude'], VERSION_TIMEOUT_MS)
  const found = where.code === 0 ? where.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : []
  const candidates = [
    override,
    home && join(home, '.local', 'bin', 'claude.exe'),
    ...found.filter((p) => !isDesktopPath(p)),
    env.APPDATA && join(env.APPDATA, 'npm', 'claude.cmd')
  ].filter((p): p is string => Boolean(p))
  for (const c of [...new Set(candidates)]) if (existsSync(c) && (await isClaudeCli(c))) return c
  return null
}
