import { z } from 'zod'
import type { Surface } from '@shared/snapshot'
import { ulid, type AgentEvent } from './events'
import { run, system32, type RunResult } from './cli'
import { cap, maskSecrets } from './redact'

/** D-005 cadence. The 1 s "P1 open" rate arrives with the attention engine (M3). */
export const VISIBLE_MS = 3_000
export const HIDDEN_MS = 15_000
export const BACKOFF_MS = 60_000
export const NUDGE_MS = 300
/** While a P1 item is open (ARCHITECTURE § 3): the poll's status flip is the earliest sign it was answered (R5). */
export const FAST_MS = 1_000
export const MIN_GAP_MS = 1_000
const PS_TIMEOUT_MS = 10_000

/** agent-view § List sessions as JSON; F2 and the live run on 2026-11-05 (startedAt is epoch ms). */
const Row = z.looseObject({
  sessionId: z.string().optional(),
  id: z.string().optional(),
  pid: z.number().int().optional(),
  cwd: z.string().optional(),
  kind: z.string().optional(),
  startedAt: z.number().optional(),
  name: z.string().optional(),
  status: z.string().optional(),
  state: z.string().optional(),
  waitingFor: z.string().optional()
})
export type Row = z.infer<typeof Row>

const FIELDS = ['pid', 'cwd', 'kind', 'name', 'status', 'state', 'waitingFor', 'id'] as const
const PATH_MAX = 1024
const TEXT_MAX = 200

export const rowKey = (r: Row): string | null => r.sessionId ?? (r.id ? `bg:${r.id}` : null)

/** Only the documented fields reach the store, masked and capped like hook text (the row schema is loose). */
function payloadOf(row: Row, surface: Surface): Record<string, unknown> {
  const p: Record<string, unknown> = { surface }
  for (const k of [...FIELDS, 'sessionId', 'startedAt'] as const) {
    const v = row[k]
    if (v !== undefined) p[k] = typeof v === 'string' ? cap(maskSecrets(v), k === 'cwd' ? PATH_MAX : TEXT_MAX) : v
  }
  return p
}

/** Rows that fail validation are skipped one by one; a non-array output is a failed poll. */
export function parseRows(stdout: string): Row[] | null {
  let json: unknown
  try {
    json = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!Array.isArray(json)) return null
  return json.flatMap((x) => {
    const r = Row.safeParse(x)
    return r.success && rowKey(r.data) ? [r.data] : []
  })
}

/** D-021, from the exe path of the session's pid. */
export function surfaceFromExe(exe: string | null, kind: string | undefined): Surface {
  if (kind === 'background') return 'background'
  if (!exe) return 'cli'
  if (/\\Claude-Data\\|\\WindowsApps\\Claude_/i.test(exe)) return 'desktop'
  if (/\\\.vscode[^\\]*\\extensions\\|\\\.cursor\\/i.test(exe)) return 'vscode'
  return 'cli'
}

/** Rows added or changed become `session.state`; rows that vanished become `session.gone` (EVENT_SCHEMA). */
export function diffRows(prev: ReadonlyMap<string, Row>, rows: readonly Row[], surfaces: ReadonlyMap<number, Surface>, ts: number) {
  const next = new Map<string, Row>()
  const events: AgentEvent[] = []
  const event = (key: string, kind: 'session.state' | 'session.gone', row: Row): AgentEvent => {
    const surface = row.pid === undefined ? surfaceFromExe(null, row.kind) : (surfaces.get(row.pid) ?? surfaceFromExe(null, row.kind))
    const payload = payloadOf(row, surface)
    const status = (payload.state ?? payload.status ?? 'unknown') as string
    return {
      id: ulid(ts), ts, source: 'poll', sessionId: key, agentId: null, parentAgentId: null, agentType: null, kind,
      toolName: null, toolUseId: null, summary: kind === 'session.gone' ? 'Session ended' : `Status: ${status}`,
      payload, cwd: (payload.cwd as string | undefined) ?? null, dedupeKey: null
    }
  }
  for (const row of rows) {
    const key = rowKey(row)!
    next.set(key, row)
    const old = prev.get(key)
    if (!old || FIELDS.some((f) => old[f] !== row[f])) events.push(event(key, 'session.state', row))
  }
  for (const [key, row] of prev) if (!next.has(key)) events.push(event(key, 'session.gone', row))
  return { next, events }
}

/**
 * Exe paths for pids, one PowerShell call per batch of new pids (D-045); null when the call itself failed.
 * Pids are integers, so nothing is interpolated.
 */
export async function exePaths(pids: readonly number[], exec: typeof run = run): Promise<Map<number, string | null> | null> {
  const out = new Map<number, string | null>(pids.map((p) => [p, null]))
  const safe = pids.filter((p) => Number.isSafeInteger(p) && p > 0)
  if (!safe.length) return out
  const script = `Get-Process -Id ${safe.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id)\`t$($_.Path)" }`
  const { code, stdout } = await exec(system32('WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script], PS_TIMEOUT_MS)
  if (code !== 0) return null
  for (const line of stdout.split(/\r?\n/)) {
    const [pid, path] = line.split('\t')
    if (pid && path) out.set(Number(pid), path.trim())
  }
  return out
}

export interface PollerDeps {
  /** Runs `claude agents --json --all`; null when no CLI was found. */
  list(): Promise<RunResult | null>
  exePaths(pids: readonly number[]): Promise<Map<number, string | null> | null>
  /** After every successful poll, with the rows that changed (often none). */
  emit(events: AgentEvent[]): void
  now?(): number
}

/** ADR-0004: one poll at a time, ≥ 1 s apart; 3 s visible, 15 s hidden; backs off to 60 s on bad output. */
export class Poller {
  private rows: Map<string, Row>
  private readonly surfaces = new Map<number, Surface>()
  private timer: NodeJS.Timeout | null = null
  private dueAt = Infinity
  private running = false
  private lastStart = 0
  private visible = true
  private failing = false
  private stopped = false
  private fastUntil = 0
  /** A failed exe lookup is retried after the backoff, not on every poll (each try can take 10 s). */
  private exeRetryAt = 0

  /** `known`: sessions the store still thinks are live, so the first poll ends the ones that vanished meanwhile (D-057). */
  constructor(
    private readonly deps: PollerDeps,
    known: Iterable<string> = []
  ) {
    this.rows = new Map([...known].map((k) => [k, { sessionId: k }]))
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  start(): void {
    this.schedule(0)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    if (visible) this.schedule(0)
  }

  /** Poll every second until `at` (a P1 item is open); 0 ends it. */
  setFastUntil(at: number): void {
    this.fastUntil = at
    if (at > this.now() && !this.failing) this.schedule(FAST_MS)
  }

  /** A hook event just arrived: confirm with the poll soon (D-005 300 ms debounce). */
  nudge(): void {
    if (!this.failing) this.schedule(NUDGE_MS)
  }

  /** Moves the next poll earlier, never later; respects the 1 s minimum gap. */
  private schedule(delay: number): void {
    if (this.stopped) return
    const at = Math.max(this.now() + delay, this.lastStart + MIN_GAP_MS)
    if (at >= this.dueAt) return
    if (this.timer) clearTimeout(this.timer)
    this.dueAt = at
    this.timer = setTimeout(() => void this.tick(), at - this.now())
  }

  private async tick(): Promise<void> {
    this.timer = null
    this.dueAt = Infinity
    if (this.running || this.stopped) return
    this.running = true
    this.lastStart = this.now()
    let ok: boolean
    try {
      ok = await this.pollOnce()
    } catch {
      ok = false
    } finally {
      this.running = false
    }
    this.failing = !ok
    const idle = this.now() < this.fastUntil ? FAST_MS : this.visible ? VISIBLE_MS : HIDDEN_MS
    this.schedule(ok ? idle : BACKOFF_MS)
  }

  private async pollOnce(): Promise<boolean> {
    const result = await this.deps.list()
    if (!result || result.code !== 0) return false
    const rows = parseRows(result.stdout)
    if (!rows) return false
    const fresh = [...new Set(rows.map((r) => r.pid).filter((p): p is number => p !== undefined && !this.surfaces.has(p)))]
    if (fresh.length && this.now() >= this.exeRetryAt) {
      const paths = await this.deps.exePaths(fresh)
      if (!paths) this.exeRetryAt = this.now() + BACKOFF_MS // nothing cached: rows read as CLI until a lookup works
      else
        for (const pid of fresh) {
          const row = rows.find((r) => r.pid === pid)
          this.surfaces.set(pid, surfaceFromExe(paths.get(pid) ?? null, row?.kind))
          if (row) this.rows.delete(rowKey(row)!) // re-emit: a retried lookup may correct the surface
        }
    }
    if (this.stopped) return true // stopped mid-poll: the store may be closed
    const { next, events } = diffRows(this.rows, rows, this.surfaces, this.now())
    this.rows = next
    for (const pid of this.surfaces.keys()) if (!rows.some((r) => r.pid === pid)) this.surfaces.delete(pid)
    this.deps.emit(events)
    return true
  }
}
