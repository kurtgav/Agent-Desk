// ADR-0014: AgentDeck's command hooks in Codex CLI's hooks.json, through the planner and writer of Claude Code's
// settings.json (ADR-0005). Codex trusts a hook by its command's hash, so a command never holds the port or the token and
// never changes: curl reads both from a curlrc that AgentDeck rewrites as they change. No electron import: unit-testable.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CodexHooks, HooksPreview, HooksResult } from '@shared/bridge'
import { shQuote } from './actions'
import { hooksState, install, previewInstall, previewUninstall, uninstall, type HookPaths } from './hooks'
import { isObj, type HookSpec, type Json } from './hooks-install'
import { writeAtomic } from './roles-fs'

/** No matcher anywhere: every tool. */
export const CODEX_EVENTS: readonly string[] = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'SessionEnd',
  'Interrupt'
]

/** What our commands point at: the curlrc, and the shell Codex runs them in (PowerShell 5.1 on Windows, sh elsewhere). */
export interface CodexTarget {
  curlrc: string
  platform: NodeJS.Platform
}

export interface CodexPaths extends HookPaths {
  /** CODEX_HOME, else <home>/.codex. Detected = this folder exists. */
  home: string
  /** <userData>/hooks/codex.curlrc */
  curlrc: string
}

export const codexHome = (env: NodeJS.ProcessEnv, home: string): string => env.CODEX_HOME || join(home, '.codex')

export function codexPaths(env: NodeJS.ProcessEnv, home: string, userData: string): CodexPaths {
  const dir = codexHome(env, home)
  return { home: dir, settings: join(dir, 'hooks.json'), backups: join(userData, 'backups'), curlrc: join(userData, 'hooks', 'codex.curlrc') }
}

export const codexTarget = (paths: CodexPaths, platform: NodeJS.Platform = process.platform): CodexTarget => ({ curlrc: paths.curlrc, platform })

// 0.3 s: a closed localhost port costs ~2.1 s of SYN retries on Windows without it, ~0.4 s with it.
const CURL_ARGS = '-sf --connect-timeout 0.3 -m 3'
/** PowerShell single quotes: a `'` inside doubles. */
const psQuote = (s: string): string => `'${s.replaceAll("'", "''")}'`

/**
 * Single quotes only, so Codex's CreateProcess quoting can't break them; `; exit 0` so AgentDeck being down is never a
 * failed hook. SessionStart adds Codex's pid (PowerShell's parent, sh's `$PPID`) for liveness.
 */
export function codexCommand(event: string, t: CodexTarget): string {
  const pid = event === 'SessionStart'
  if (t.platform === 'win32') {
    // Forward slashes are fine for curl and keep `\` out of the command.
    const curl = `& (Join-Path $env:SystemRoot 'System32\\curl.exe') ${CURL_ARGS} -K ${psQuote(t.curlrc.replaceAll('\\', '/'))}`
    return pid
      ? `$p = (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $PID)).ParentProcessId; ${curl} -H ('X-AgentDeck-Pid: ' + $p) --data-binary '@-'; exit 0`
      : `${curl} --data-binary '@-'; exit 0`
  }
  const curl = `${t.platform === 'darwin' ? '/usr/bin/curl' : 'curl'} ${CURL_ARGS} -K ${shQuote(t.curlrc)}`
  return `${curl}${pid ? ' -H "X-AgentDeck-Pid: $PPID"' : ''} --data-binary @-; exit 0`
}

/** Codex clamps these two to 1-3 s. */
const CLAMPED = ['SessionEnd', 'Interrupt']

function codexGroup(event: string, t: CodexTarget): Json {
  // PermissionRequest stays sync (a later slice holds it for approvals); Codex runs SessionEnd sync whatever it says.
  const sync = event === 'PermissionRequest' || event === 'SessionEnd'
  return { hooks: [{ type: 'command', command: codexCommand(event, t), timeout: CLAMPED.includes(event) ? 3 : 5, ...(sync ? {} : { async: true }) }] }
}

/** `-K '<…>/hooks/codex.curlrc'` followed by a space, the path quoted the PowerShell (`''`) or the sh (`'\''`) way. */
const OUR_CURLRC = / -K '(?:[^']|''|'\\'')*\/hooks\/codex\.curlrc' /

/** Ours = type "command" whose command passes curl our curlrc. A command that doesn't read that file is never ours. */
export const isOurCodex = (entry: unknown): boolean =>
  isObj(entry) && entry.type === 'command' && typeof entry.command === 'string' && OUR_CURLRC.test(entry.command)

/** The masked diff shows our type and our commands (they hold no secret: that is the curlrc's job); every other value is hidden. */
function shown(literal: string): boolean {
  if (literal === '"command"') return true
  try {
    return isOurCodex({ type: 'command', command: JSON.parse(literal) as unknown })
  } catch {
    return false
  }
}

export const CODEX: HookSpec<CodexTarget> = {
  file: 'hooks.json',
  backup: 'codex-hooks',
  events: CODEX_EVENTS,
  isOurs: isOurCodex,
  group: codexGroup,
  shown
}

/** curl's config file (`-K`): where to post and the token. Never in the hook command (see the top of this file). */
export const curlrcText = (port: number, token: string): string =>
  `url = "http://127.0.0.1:${port}/hooks/codex"\nheader = "X-AgentDeck-Token: ${token}"\nheader = "Content-Type: application/json"\n`

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** User-only (0600; on Windows the user profile's ACL), atomic. */
export async function writeCurlrc(file: string, port: number, token: string): Promise<void> {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  await writeAtomic(file, curlrcText(port, token))
}

/**
 * On quit: no token, and a port nothing listens on, so a Codex turn while AgentDeck is closed posts nowhere in ~80 ms and says
 * nothing. Deleting the file instead makes curl print an error on every hook. Sync: it runs inside will-quit.
 */
export const PARKED = 'url = "http://127.0.0.1:0/hooks/codex"\n'

export function parkCurlrc(file: string): void {
  try {
    if (existsSync(file)) writeFileSync(file, PARKED, { mode: 0o600 })
  } catch (e) {
    console.error(`[codex] park curlrc: ${message(e)}`) // quit goes on regardless
  }
}

/** Without the curlrc our commands post nothing (curl says on stderr that it can't read `-K`; the hook still exits 0). */
export function removeCurlrc(file: string): HooksResult {
  try {
    rmSync(file, { force: true })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `Could not delete ${file}: ${message(e)}` }
  }
}

const absent = (paths: CodexPaths): string => `AgentDeck found no Codex CLI folder at ${paths.home}.`

export function codexState(paths: CodexPaths, target: CodexTarget): CodexHooks {
  if (!existsSync(paths.home)) return { state: 'absent', error: null, home: paths.home }
  const s = hooksState(paths, target, CODEX)
  return { state: s.hooks, error: s.hooksError, home: paths.home }
}

export function previewCodex(paths: CodexPaths, on: boolean, target: CodexTarget): HooksPreview {
  if (on && !existsSync(paths.home)) return { ok: false, path: paths.settings, error: absent(paths) }
  return on ? previewInstall(paths, target, CODEX) : previewUninstall(paths, CODEX)
}

/** The curlrc first: hooks.json is written only once its commands have something to read. */
export async function installCodex(paths: CodexPaths, target: CodexTarget, endpoint: { port: number; token: string }): Promise<HooksResult> {
  if (!existsSync(paths.home)) return { ok: false, error: absent(paths) }
  try {
    await writeCurlrc(paths.curlrc, endpoint.port, endpoint.token)
  } catch (e) {
    return { ok: false, error: `Could not write ${paths.curlrc}: ${message(e)}` }
  }
  return install(paths, target, CODEX)
}

/** Also the uninstaller's step (D-156): only our entries leave hooks.json, and the curlrc goes even when hooks.json can't be edited. */
export function uninstallCodex(paths: CodexPaths): HooksResult {
  const r = uninstall(paths, CODEX)
  const c = removeCurlrc(paths.curlrc)
  return r.ok ? c : r
}
