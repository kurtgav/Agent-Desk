import type { ActionResult, Verdict } from './bridge'
import type { SessionDetail } from './detail'
import type { Snapshot } from './snapshot'

/** Main ↔ collector over the utility process's parentPort (ARCHITECTURE § 2). */
export interface CollectorInit {
  type: 'init'
  dbPath: string
  token: string
  ports: number[]
  agentsDir: string | null
  /** CLI path override; false turns the poller off. */
  claude: string | undefined | false
  /** P3 thresholds N and M in ms (STATE_MACHINE § 3); defaults 5 and 10 min. */
  stall?: { idleMs: number; toolMs: number }
}

export type ToCollector =
  | CollectorInit
  | { type: 'visible'; visible: boolean }
  | { type: 'focus'; focused: boolean; at: number }
  /** The user dismissed a P2–P4 item in the window. */
  | { type: 'dismiss'; id: string }
  /** Remote approvals (ADR-0006): hold PermissionRequests for up to `waitMs`. State: replayed to a restarted collector. */
  | { type: 'approvals'; enabled: boolean; waitMs: number }
  /** A request: the reply carries the same `reqId`. Requests are never replayed to a restarted collector. */
  | { type: 'detail'; reqId: number; sessionId: string }
  | { type: 'decide'; reqId: number; itemId: string; verdict: Verdict }

export type FromCollector =
  | { type: 'ready'; port: number }
  | { type: 'detail'; reqId: number; detail: SessionDetail | null }
  | { type: 'decided'; reqId: number; result: ActionResult }
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'error'; message: string }
