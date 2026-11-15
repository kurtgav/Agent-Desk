// Diagnostics (ADR-0008, UI_MAP § Settings › Diagnostics): what AgentDeck can find out about itself. No electron import.
import { randomBytes } from 'node:crypto'
import { rm, stat, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { arch, homedir, release, version as osVersion } from 'node:os'
import { dirname, join } from 'node:path'
import type { HooksState } from '@shared/bridge'
import type { DiagnosticCheck, Diagnostics } from '@shared/work'
import { resolveClaude, run, type RunResult } from '../collector/cli'
import { readConfig, remoteApprovals } from './config'
import { hookOptions, hooksState } from './hooks'
import { settingsPath, type HookTarget } from './hooks-install'
import { eodSettings } from './settings-model'

/** Each CLI call is capped (ADR-0008); Diagnostics must open in seconds even when `claude` hangs. */
const CLI_TIMEOUT_MS = 3_000
const PROBE_TIMEOUT_MS = 1_000
/** The folder probe and the CLI search each give up after this, so an offline share or a hung `where` can't hold the page. */
const SLOW_MS = 4_000
const CLAUDE_SEARCH_MS = 12_000

export type AgentView = { state: 'ok'; sessions: number } | { state: 'disabled' } | { state: 'no-answer' } | { state: 'unavailable' } | { state: 'skipped' }

/** `claude agents --json --all` is the registry the poller reads (ADR-0004); a JSON array means agent view is on. */
export function agentViewFrom(env: NodeJS.ProcessEnv, r: RunResult | null): AgentView {
  if (/^(1|true)$/i.test(env.CLAUDE_CODE_DISABLE_AGENT_VIEW ?? '')) return { state: 'disabled' }
  if (!r) return { state: 'skipped' }
  if (r.code === null) return { state: 'no-answer' }
  try {
    const rows: unknown = JSON.parse(r.stdout)
    return r.code === 0 && Array.isArray(rows) ? { state: 'ok', sessions: rows.length } : { state: 'unavailable' }
  } catch {
    return { state: 'unavailable' }
  }
}

export interface CheckInput {
  demo: boolean
  collectorRunning: boolean
  port: number | null
  portBound: boolean
  hooks: HooksState
  hooksError: string | null
  conflicts: string[]
  claudePath: string | null
  claudeVersion: string | null
  agentView: AgentView
  reportFolder: { path: string; writable: boolean; reason: string | null }
}

const check = (id: string, label: string, ok: boolean, detail: string): DiagnosticCheck => ({ id, label, ok, detail })

function hooksCheck(i: CheckInput): DiagnosticCheck {
  const label = 'Hooks installed, no settings conflicts'
  if (i.hooks === 'error') return check('hooks', label, false, i.hooksError ?? 'AgentDeck could not read your Claude Code settings.json.')
  if (i.conflicts.length) return check('hooks', label, false, i.conflicts[0]!)
  if (i.hooks === 'missing') return check('hooks', label, false, 'Not installed, so sessions do not report to AgentDeck. Use Manage hooks under Integration.')
  return check('hooks', label, true, "AgentDeck's entries are in your Claude Code settings.json.")
}

function agentViewCheck(i: CheckInput): DiagnosticCheck {
  const label = 'Agent view available'
  const v = i.agentView
  switch (v.state) {
    case 'ok':
      return check('agent-view', label, true, `Claude Code lists ${v.sessions} ${v.sessions === 1 ? 'session' : 'sessions'}.`)
    case 'disabled':
      return check('agent-view', label, false, 'Agent view is switched off (CLAUDE_CODE_DISABLE_AGENT_VIEW). AgentDeck relies on hooks alone.')
    case 'no-answer':
      return check('agent-view', label, false, 'claude agents did not answer within 3 seconds.')
    case 'unavailable':
      return check('agent-view', label, false, 'claude agents did not return a session list. Agent view may be disabled in your Claude Code settings.')
    case 'skipped':
      return check('agent-view', label, false, 'Not checked: Claude Code was not found.')
  }
}

/** The checks, in the order the page lists them. Plain words: what was found, or what to do. */
export function buildChecks(i: CheckInput): DiagnosticCheck[] {
  const claude = i.claudePath
    ? i.claudeVersion
      ? check('claude', 'Claude Code found', true, `Version ${i.claudeVersion}.`)
      : check('claude', 'Claude Code found', false, `Found at ${i.claudePath}, but it did not report a version within 3 seconds.`)
    : check('claude', 'Claude Code found', false, 'Claude Code (claude) was not found, so AgentDeck can not start or stop sessions. Install it, or set claudePath in config.json.')
  const folder = check(
    'report-folder',
    'Daily report folder writable',
    i.reportFolder.writable,
    i.reportFolder.writable ? i.reportFolder.path : `${i.reportFolder.path}: ${i.reportFolder.reason ?? 'AgentDeck can not write there.'}`
  )
  if (i.demo) {
    return [
      check('mode', 'Data source', true, 'Demo data is on, so live sessions are not read. Turn it off under Third Code to go live.'),
      claude,
      folder
    ]
  }
  return [
    i.collectorRunning && i.port !== null
      ? check('collector', 'Collector running', true, 'AgentDeck is receiving session events.')
      : check('collector', 'Collector running', false, 'It is not running. AgentDeck restarts it by itself; if this stays, quit from the tray and open AgentDeck again.'),
    i.portBound
      ? check('port', 'Local port open', true, `Listening on 127.0.0.1:${i.port}.`)
      : check('port', 'Local port open', false, i.port === null ? 'The collector has not started listening yet.' : `Nothing answers on 127.0.0.1:${i.port}.`),
    hooksCheck(i),
    claude,
    agentViewCheck(i),
    folder
  ]
}

// ---- Gathering ---------------------------------------------------------------------------------------------------

/** True when something accepts a connection on the loopback port; never throws. */
export function portBound(port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    const done = (ok: boolean): void => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false)
}

/**
 * Writes and removes a small file: Windows' access() reports only the read-only flag, so an ACL that forbids writing would
 * pass it. A folder that does not exist yet is judged by its nearest folder that does, since the report writer creates it.
 */
export async function folderWritable(path: string): Promise<{ writable: boolean; reason: string | null }> {
  let dir = path
  while (!(await exists(dir)) && dirname(dir) !== dir) dir = dirname(dir)
  const probe = join(dir, `.agentdeck-write-test-${randomBytes(4).toString('hex')}`)
  try {
    if (!(await stat(dir)).isDirectory()) return { writable: false, reason: 'It is a file, not a folder.' }
    await writeFile(probe, '')
    return { writable: true, reason: null }
  } catch {
    return { writable: false, reason: 'The system does not let AgentDeck write there. Pick another folder under Daily report.' }
  } finally {
    await rm(probe, { force: true }).catch(() => undefined)
  }
}

/** `p`, or `fallback` once `ms` have passed. */
function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms)
  })
  return Promise.race([p, late]).finally(() => clearTimeout(timer))
}

async function fileBytes(path: string): Promise<number> {
  return stat(path).then((s) => s.size, () => 0)
}

export interface CollectFacts {
  demo: boolean
  /** The collector's supervisor exists (it may be between restarts). */
  collectorRunning: boolean
  userData: string
  configFile: string
  appVersion: string
}

export async function collectDiagnostics(f: CollectFacts): Promise<Diagnostics> {
  const config = readConfig(f.configFile)
  const dbPath = join(f.userData, 'agentdeck.db')
  const port = f.collectorRunning && typeof config.collectorPort === 'number' ? config.collectorPort : null
  const token = typeof config.token === 'string' ? config.token : null
  const target: HookTarget | null = port !== null && token ? { port, token, ...hookOptions(remoteApprovals(config)) } : null
  const hooks = hooksState({ settings: settingsPath(process.env, homedir()), backups: join(f.userData, 'backups') }, target)
  const folder = eodSettings(config).folder ?? join(f.userData, 'eod')
  // The `claudePath` override of config.json is the first candidate resolveClaude tries (ADR-0008).
  const override = typeof config.claudePath === 'string' ? config.claudePath : undefined

  const [claudePath, bound, writable, dbBytes] = await Promise.all([
    within(resolveClaude(override).catch(() => null), CLAUDE_SEARCH_MS, null),
    port !== null ? portBound(port) : Promise.resolve(false),
    within(folderWritable(folder), SLOW_MS, { writable: false, reason: 'It did not answer in time. Is the drive or share offline?' }),
    exists(dbPath).then(async (has) => (has ? (await fileBytes(dbPath)) + (await fileBytes(`${dbPath}-wal`)) : null))
  ])
  const [versionRun, agentsRun] = claudePath
    ? await Promise.all([run(claudePath, ['--version'], CLI_TIMEOUT_MS), f.demo ? Promise.resolve(null) : run(claudePath, ['agents', '--json', '--all'], CLI_TIMEOUT_MS)])
    : [null, null]
  const firstLine = versionRun?.code === 0 ? versionRun.stdout.trim().split(/\r?\n/)[0] : undefined
  const claudeVersion = firstLine?.replace(/ \(Claude Code\)$/, '') || null

  const collector = f.demo ? 'demo' : f.collectorRunning && bound ? 'up' : 'down'
  const checks = buildChecks({
    demo: f.demo,
    collectorRunning: f.collectorRunning,
    port,
    portBound: bound,
    hooks: hooks.hooks,
    hooksError: hooks.hooksError,
    conflicts: hooks.conflicts,
    claudePath,
    claudeVersion,
    agentView: f.demo ? { state: 'skipped' } : agentViewFrom(process.env, agentsRun),
    reportFolder: { path: folder, ...writable }
  })
  return {
    version: f.appVersion,
    electron: process.versions.electron ?? 'n/a',
    node: process.versions.node,
    os: `${osVersion()} (${release()}, ${arch()})`,
    userData: f.userData,
    dbPath,
    dbBytes,
    collector,
    port,
    hooks: hooks.hooks,
    claudePath,
    claudeVersion,
    startedAt: Date.now() - Math.round(process.uptime() * 1000),
    checks
  }
}
