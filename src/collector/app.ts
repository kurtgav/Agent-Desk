import { createHash } from 'node:crypto'
import { readdirSync } from 'node:fs'
import type { Server } from 'node:http'
import type { ActionResult, Verdict } from '@shared/bridge'
import type { SessionDetail } from '@shared/detail'
import type { Snapshot } from '@shared/snapshot'
import { DEFAULT_STALL, type AttentionRecord, type StallConfig } from './attention'
import type { AgentEvent } from './events'
import { resolveClaude, run } from './cli'
import { Holds, type AuditRow } from './holds'
import { normalizeHook } from './normalize'
import { Poller, exePaths } from './poll'
import { listen } from './server'
import { Store } from './store'

const PRUNE_EVERY_MS = 6 * 3_600_000
const AGENT_COUNT_TTL_MS = 60_000
const POLL_TIMEOUT_MS = 10_000
/** P3 stall checks; the thresholds are minutes, so a few seconds of lag is invisible. */
const STALL_TICK_MS = 5_000

export interface CollectorOptions {
  dbPath: string
  token: string
  ports: readonly number[]
  /** `<config dir>/agents`, counted for the sidebar; null skips it. */
  agentsDir: string | null
  /** Settings override for the CLI path (D-024); false turns the poller off (tests). */
  claude: string | undefined | false
  stall?: StallConfig
  /** Something the UI shows changed. */
  onChange(): void
  onError(err: unknown): void
}

/** Remote approvals (ADR-0006); main turns them on only while the matching hook entries are installed. */
export interface ApprovalConfig {
  enabled: boolean
  waitMs: number
}

export interface Collector {
  port: number
  snapshot(): Snapshot
  setVisible(visible: boolean): void
  setFocused(focused: boolean, at: number): void
  setApprovals(cfg: ApprovalConfig): void
  dismiss(id: string): void
  /** Approve-once or reject one held request. */
  decide(itemId: string, verdict: Verdict): ActionResult
  detail(sessionId: string): SessionDetail | null
  auditLog(limit: number): AuditRow[]
  close(): Promise<void>
}

const TOO_LATE = 'This request no longer waits in AgentDeck: its time ran out, or it was answered. If its terminal still asks, answer it there.'
const heldHint = (waitMs: number): string => `Waits here up to ${Math.round(waitMs / 1000)} s, then its terminal asks.`
const inputHash = (ev: AgentEvent): string => createHash('sha256').update(JSON.stringify(ev.payload.tool_input ?? null)).digest('hex')

/** Number of subagent definition files; read-only, documented location (sub-agents § scope). */
function countAgents(dir: string | null): number {
  if (!dir) return 0
  try {
    return readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md')).length
  } catch {
    return 0
  }
}

export async function startCollector(o: CollectorOptions): Promise<Collector> {
  const store = new Store(o.dbPath)
  const prune = (): void => {
    try {
      store.prune(Date.now())
    } catch (err) {
      o.onError(err) // retried at the next interval; a failed prune loses nothing
    }
  }
  prune()
  let away: { since: number | null; until: number | null } = { since: null, until: null }
  let agents = { count: countAgents(o.agentsDir), at: Date.now() }

  const stallCfg = o.stall ?? DEFAULT_STALL
  let poller: Poller | null = null
  let approvals: ApprovalConfig = { enabled: false, waitMs: 0 }
  /** Every change may open or close a P1 item, which starts or ends the 1 s poll, or closes a held one. */
  const changed = (): void => {
    holds.releaseClosed((id) => store.isOpen(id))
    poller?.setFastUntil(store.fastPollUntil())
    o.onChange()
  }
  const guarded = (fn: () => boolean): void => {
    try {
      if (fn()) changed()
    } catch (err) {
      o.onError(err)
    }
  }
  // Every hold ends in the audit log (ADR-0006). An answer closes its item; anything else leaves it to the terminal.
  const holds = new Holds((row) =>
    guarded(() => {
      store.audit(row)
      if (row.outcome === 'approved' || row.outcome === 'rejected') return store.answer(row.itemId, row.ts)
      return store.setHeld(row.itemId, false, null)
    })
  )
  const ingest = (events: AgentEvent[]): void => guarded(() => store.ingest(events))
  if (o.claude !== false) {
    let cli: string | null = null
    const override = o.claude
    poller = new Poller(
      {
        list: async () => {
          cli ??= await resolveClaude(override)
          if (!cli) return null
          const result = await run(cli, ['agents', '--json', '--all'], POLL_TIMEOUT_MS)
          if (result.code === null) cli = null // spawn failed or timed out: resolve again next time
          return result
        },
        exePaths: (pids) => exePaths(pids),
        emit: (events) => {
          ingest(events)
          ingest(store.duePolls(Date.now())) // after the fresh rows, which may already have settled them (D-058)
        }
      },
      store.liveIds()
    )
  }

  /** One bad body must not take the rest of its batch down, or reach the uncaught-error path (security review LOW-5). */
  const normalize = (x: { raw: string; at: number }): AgentEvent[] => {
    try {
      return [normalizeHook(x.raw, x.at)].filter((e): e is AgentEvent => e !== null)
    } catch (err) {
      o.onError(err)
      return []
    }
  }

  // Bodies queue up and drain on the next turn of the loop, after their 200s went out (ARCHITECTURE § ingest).
  let queue: { raw: string; at: number }[] = []
  const drain = (): void => {
    const batch = queue
    if (!batch.length) return // a hold drained it already
    queue = []
    ingest(batch.flatMap(normalize))
    poller?.nudge()
  }

  /**
   * ADR-0006: a PermissionRequest is ingested at once, so its item exists while the reply waits. Null: not one to hold,
   * so it takes the queue. Once ingested, it always gets a promise, or the queue would see it a second time.
   */
  const hold = (raw: string, at: number, gone: AbortSignal): Promise<unknown> | null => {
    if (!raw.includes('PermissionRequest')) return null
    let ev: AgentEvent | null
    try {
      ev = normalizeHook(raw, at)
    } catch {
      return null // the queue reports it
    }
    if (ev?.kind !== 'permission.requested') return null
    drain() // earlier bodies first: events keep their arrival order
    let item: AttentionRecord | null = null
    try {
      item = store.holdFor(ev)
    } catch (err) {
      o.onError(err)
    }
    poller?.nudge()
    if (!item) {
      changed()
      return Promise.resolve(undefined)
    }
    const waiting = holds.add(
      { itemId: item.id, sessionId: item.sessionId, agentId: item.agentId, toolName: item.toolName, title: item.title, riskFlags: item.riskFlags, inputHash: inputHash(ev), requestedAt: at },
      approvals.waitMs,
      gone
    )
    // After add: add lets go of a repeated delivery's older hold, which unholds the item.
    try {
      if (holds.has(item.id)) store.setHeld(item.id, true, heldHint(approvals.waitMs))
    } catch (err) {
      o.onError(err)
    }
    changed()
    return waiting
  }

  const snapshot = (): Snapshot => {
    const now = Date.now()
    if (now - agents.at > AGENT_COUNT_TTL_MS) agents = { count: countAgents(o.agentsDir), at: now }
    return store.snapshot(now, { awaySince: away.since, awayUntil: away.until, agentDefinitionCount: agents.count })
  }

  let server: Server
  let port: number
  try {
    ;({ server, port } = await listen(
      {
        token: o.token,
        onHook: (raw, at, gone) => {
          const held = approvals.enabled ? hold(raw, at, gone) : null
          if (held) return held
          queue.push({ raw, at })
          if (queue.length === 1) setImmediate(drain)
        },
        snapshot
      },
      o.ports
    ))
  } catch (err) {
    store.close()
    throw err
  }
  poller?.start()
  poller?.setFastUntil(store.fastPollUntil()) // items reloaded from the database
  const pruner = setInterval(prune, PRUNE_EVERY_MS)
  const stallTimer = setInterval(() => guarded(() => store.tick(Date.now(), stallCfg)), STALL_TICK_MS)

  return {
    port,
    snapshot,
    setVisible: (v) => poller?.setVisible(v),
    setFocused: (focused, at) => {
      // D-007: "while you were away" is the stretch from losing focus to getting it back (D-060).
      away = focused ? { since: away.since, until: away.since === null ? null : (away.until ?? at) } : { since: at, until: null }
      o.onChange()
    },
    setApprovals: (cfg) => {
      approvals = cfg
      if (!cfg.enabled) holds.releaseAll() // turned off: what waits goes back to its terminal now
    },
    dismiss: (id) => guarded(() => store.dismiss(id, Date.now(), stallCfg)),
    decide: (itemId, verdict) => (holds.decide(itemId, verdict) ? { ok: true } : { ok: false, error: TOO_LATE }),
    detail: (sessionId) => store.detail(sessionId),
    auditLog: (limit) => store.auditLog(limit),
    close: async () => {
      holds.releaseAll() // empty replies: the terminals ask instead
      clearInterval(pruner)
      clearInterval(stallTimer)
      poller?.stop()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections() // keep-alive sockets would otherwise hold close() open
      })
      store.close()
    }
  }
}
