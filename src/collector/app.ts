import { readdirSync } from 'node:fs'
import type { Server } from 'node:http'
import type { Snapshot } from '@shared/snapshot'
import { DEFAULT_STALL, type StallConfig } from './attention'
import type { AgentEvent } from './events'
import { resolveClaude, run } from './cli'
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

export interface Collector {
  port: number
  snapshot(): Snapshot
  setVisible(visible: boolean): void
  setFocused(focused: boolean, at: number): void
  dismiss(id: string): void
  close(): Promise<void>
}

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
  /** Every change may open or close a P1 item, which starts or ends the 1 s poll. */
  const changed = (): void => {
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
    queue = []
    ingest(batch.flatMap(normalize))
    poller?.nudge()
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
        onHook: (raw, at) => {
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
    dismiss: (id) => guarded(() => store.dismiss(id, Date.now(), stallCfg)),
    close: async () => {
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
