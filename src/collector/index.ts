// Utility-process entry (ADR-0002). Talks to main over parentPort only; everything else lives in app.ts.
import type {} from 'electron' // types process.parentPort
import type { FromCollector, ToCollector } from '@shared/collector'
import { startCollector, type Collector } from './app'

const SNAPSHOT_THROTTLE_MS = 100
/** Agent time and ages move with the clock even when no event arrives. */
const HEARTBEAT_MS = 30_000

const parent = process.parentPort
const post = (m: FromCollector): void => parent.postMessage(m)

let collector: Collector | null = null
let timer: NodeJS.Timeout | null = null
// Window state can arrive while the collector is still binding its port; apply it once it exists.
let visible = true
let away: { focused: boolean; at: number } | null = null
let approvals = { enabled: false, waitMs: 0 }

function push(): void {
  timer = null
  if (collector) post({ type: 'snapshot', snapshot: collector.snapshot() })
}

/** At most one snapshot per 100 ms, so a burst of hook events costs one render. */
function changed(): void {
  timer ??= setTimeout(push, SNAPSHOT_THROTTLE_MS)
}

const report = (err: unknown): void => post({ type: 'error', message: err instanceof Error ? err.message : String(err) })

parent.on('message', (e: { data: ToCollector }) => {
  const m = e.data
  if (m.type === 'init') {
    if (collector) return
    startCollector({ ...m, onChange: changed, onError: report })
      .then((c) => {
        collector = c
        c.setVisible(visible)
        c.setApprovals(approvals)
        if (away) c.setFocused(away.focused, away.at)
        post({ type: 'ready', port: c.port })
        push()
        setInterval(push, HEARTBEAT_MS)
      })
      .catch((err: unknown) => {
        report(err)
        process.exit(1) // main restarts us with backoff
      })
  } else if (m.type === 'visible') {
    visible = m.visible
    collector?.setVisible(m.visible)
  } else if (m.type === 'focus') {
    away = m
    collector?.setFocused(m.focused, m.at)
  } else if (m.type === 'approvals') {
    approvals = { enabled: m.enabled, waitMs: m.waitMs }
    collector?.setApprovals(approvals)
  } else if (m.type === 'dismiss') {
    collector?.dismiss(m.id)
  } else if (m.type === 'decide') {
    const result = collector?.decide(m.itemId, m.verdict) ?? { ok: false as const, error: 'AgentDeck is still starting its collector.' }
    post({ type: 'decided', reqId: m.reqId, result })
  } else if (m.type === 'detail') {
    let detail = null
    try {
      detail = collector?.detail(m.sessionId) ?? null
    } catch (err) {
      report(err) // the drawer shows "could not load"; main never waits forever
    }
    post({ type: 'detail', reqId: m.reqId, detail })
  }
})
