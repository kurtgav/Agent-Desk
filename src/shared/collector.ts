import type { ActionResult, Verdict } from './bridge'
import type { History, SessionDetail } from './detail'
import type { Snapshot } from './snapshot'
import type { EodDay, EodReport, TaskInput, TaskPatch, TaskResult, WorkTask } from './work'

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
  /** The Usage card's bar in dollars a week (Settings › Claude Code); the collector's default when absent. */
  weeklyBudgetUsd?: number
  /** `usage.readLogs` (ADR-0009 amendment): read token counts from Claude Code's local logs. Off unless the user switched it on. */
  readLogs?: boolean
}

/** A row of the report history as the collector knows it: `hasFile` is main's to fill in, `closed` is main's to read. */
export type EodDayRow = EodDay & { closed: boolean }

/** Tasks and the Daily report: one request type, so the supervisor and the entry point carry one case, not eight. */
export type WorkReq =
  | { kind: 'tasks.list' }
  /** `roleName`: the name of the task's role as main read it from the catalog (the collector has no catalog). */
  | { kind: 'tasks.add'; input: TaskInput; roleName?: string | null }
  | { kind: 'tasks.update'; id: string; patch: TaskPatch; roleName?: string | null }
  | { kind: 'tasks.remove'; id: string }
  /** Today is built from live data; a closed past day comes back as stored; any other past day is rebuilt from events. */
  | { kind: 'eod.get'; day: string }
  | { kind: 'eod.days' }
  | { kind: 'eod.notes'; day: string; notes: string }
  /** Builds the day's report and keeps it (open); `changed` says whether anything differs from the copy kept before. */
  | { kind: 'eod.refresh'; day: string }
  /** Closes a day that is over, once; asking again returns the closed one (`fresh: false`). A day still going is not closed. */
  | { kind: 'eod.finalize'; day: string }

export type WorkRes =
  | { kind: 'tasks'; tasks: WorkTask[] }
  | { kind: 'task'; result: TaskResult }
  | { kind: 'ok'; result: ActionResult }
  | { kind: 'eod'; report: EodReport }
  | { kind: 'days'; days: EodDayRow[] }
  | { kind: 'refreshed'; report: EodReport; changed: boolean }
  | { kind: 'finalized'; report: EodReport; fresh: boolean }

export type ToCollector =
  | CollectorInit
  | { type: 'visible'; visible: boolean }
  | { type: 'focus'; focused: boolean; at: number }
  /** The user dismissed a P2–P4 item in the window. */
  | { type: 'dismiss'; id: string }
  /** Remote approvals (ADR-0006): hold PermissionRequests for up to `waitMs`. State: replayed to a restarted collector. */
  | { type: 'approvals'; enabled: boolean; waitMs: number }
  /** The Usage card's weekly budget changed. State: replayed to a restarted collector. */
  | { type: 'usageBudget'; weeklyBudgetUsd: number }
  /** `usage.readLogs` changed. State: replayed to a restarted collector. */
  | { type: 'usageLogs'; on: boolean }
  /** A request: the reply carries the same `reqId`. Requests are never replayed to a restarted collector. */
  | { type: 'detail'; reqId: number; sessionId: string }
  | { type: 'decide'; reqId: number; itemId: string; verdict: Verdict }
  | { type: 'history'; reqId: number }
  /** When Claude Code's usage figures last arrived, and the port it listens on (ADR-0007): Settings › Claude Code says whether they come in. */
  | { type: 'usageStatus'; reqId: number }
  | { type: 'work'; reqId: number; req: WorkReq }
  /** Quit: answer what waits with an empty reply, write its audit rows, then exit (ADR-0006). */
  | { type: 'close' }

export type FromCollector =
  | { type: 'ready'; port: number }
  | { type: 'detail'; reqId: number; detail: SessionDetail | null }
  | { type: 'decided'; reqId: number; result: ActionResult }
  | { type: 'history'; reqId: number; history: History | null }
  | { type: 'usageStatus'; reqId: number; lastAt: number | null; port: number | null }
  /** `res` is null when the collector could not answer (it reports why through `error`). */
  | { type: 'work'; reqId: number; res: WorkRes | null }
  | { type: 'snapshot'; snapshot: Snapshot }
  /**
   * Something the tasks or the Daily report show changed: a task, a session's status, a finished turn, a changed file, an
   * item that waits on the user. It carries no data (the window asks for what it shows) and a burst is one message.
   */
  | { type: 'work-changed' }
  | { type: 'error'; message: string }
