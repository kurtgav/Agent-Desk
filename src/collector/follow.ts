import type { Status } from '@shared/snapshot'
import type { WorkTask } from '@shared/work'
import { askedQuestion } from './attention'
import type { AgentEvent, EventKind } from './events'
import { EDIT_TOOLS, type SessionState } from './reduce'
import type { WorkStore } from './work-store'

/**
 * Tasks follow the sessions they were sent to; the window is told when tasks or the report changed.
 * Nothing here runs on the hook reply path: app.ts calls it from the drain, after the 200 went out.
 */

/** A burst of changes is one message to main, this long after the first. */
export const WORK_COALESCE_MS = 400

/** Events that start a turn: a session seen starting one was working, even when its end is in the same batch. */
const TURN_STARTS = new Set<EventKind>(['session.prompt', 'session.notified'])
/** Events that change what the report shows without always changing a status (counts, names, folders, files). */
const REPORT_KINDS = new Set<EventKind>(['turn.stopped', 'turn.failed', 'session.state', 'session.gone', 'session.ended', 'cwd.changed'])

/** Whether one event can change tasks or the report by itself: a finished turn, a changed file, a poll row. */
export const touchesReport = (ev: AgentEvent): boolean =>
  REPORT_KINDS.has(ev.kind) || (ev.kind === 'tool.finished' && ev.toolName !== null && EDIT_TOOLS.has(ev.toolName))

/** Statuses of the sessions `events` mention as they are now, read before the batch is ingested. */
export function statusesOf(sessions: ReadonlyMap<string, SessionState>, events: readonly AgentEvent[]): Map<string, Status> {
  const out = new Map<string, Status>()
  for (const e of events) {
    const s = sessions.get(e.sessionId)
    if (s) out.set(e.sessionId, s.status)
  }
  return out
}

/** Calls `fire` once, `ms` after the first `poke`, however many pokes came in between. */
export function trailing(ms: number, fire: () => void): { poke(): void; cancel(): void } {
  let timer: NodeJS.Timeout | null = null
  return {
    poke: () => {
      timer ??= setTimeout(() => {
        timer = null
        fire()
      }, ms)
    },
    cancel: () => {
      if (timer) clearTimeout(timer)
      timer = null
    }
  }
}

/** The session a name stands for: when several share it, the most recently active one (the Tasks page uses the same rule). */
function sessionNamed(sessions: ReadonlyMap<string, SessionState>, name: string): SessionState | null {
  let best: SessionState | null = null
  for (const s of sessions.values()) if (s.name === name && (!best || s.lastEventAt > best.lastEventAt)) best = s
  return best
}

/** Whether the session's latest final message asked the user something: the test behind the ready-for-review item's `asked`. */
function lastStopAsked(work: WorkStore, sessionId: string): boolean {
  const row = work.db
    .prepare("SELECT payload FROM events WHERE session_id = ? AND agent_id IS NULL AND kind = 'turn.stopped' ORDER BY ts DESC, seq DESC LIMIT 1")
    .get(sessionId)
  if (!row) return false
  try {
    const message = (JSON.parse(String(row.payload)) as Record<string, unknown>).last_assistant_message
    return typeof message === 'string' && askedQuestion(message)
  } catch {
    return false
  }
}

/**
 * Moves the tasks that were sent to an agent as its session moves. Only tasks with a `sessionName` that are not done are
 * ever touched, and only by this: a session working makes a To do task In progress; a session whose turn ends without a
 * question or a failure completes the task, at the time it finished. Waiting on you and failing leave the task alone.
 *
 * "Armed" is how a task earns its completion: the follower has seen that very session work in this run. A stale session
 * of the same name, the poll listing a finished session again after its SessionEnd, or a restarted collector therefore
 * never complete a task by surprise. The user moving a done task back "releases" it: it is never completed by an agent again.
 * Both sets live in memory only (no schema change): after a collector restart a released task whose session goes on
 * working can be completed once more. Tasks are few, so the open linked ones are cached until a task changes.
 */
export class TaskFollower {
  private open: WorkTask[] | null = null
  /** task id → the session it saw working, which is the only one whose finish completes it. */
  private readonly armed = new Map<string, string>()
  private readonly released = new Set<string>()

  constructor(
    private readonly work: WorkStore,
    private readonly sessions: () => ReadonlyMap<string, SessionState>
  ) {}

  /** A task was added, edited, moved or deleted by someone else: read the linked ones again next time. */
  invalidate(): void {
    this.open = null
  }

  /** The user moved a done task back: no agent completes it again. */
  release(id: string): void {
    this.released.add(id)
    this.armed.delete(id)
    this.invalidate()
  }

  forget(id: string): void {
    this.released.delete(id)
    this.armed.delete(id)
    this.invalidate()
  }

  /** After a batch of events was ingested; `before` is `statusesOf` taken before it. True when a task changed. */
  follow(events: readonly AgentEvent[], before: ReadonlyMap<string, Status>): boolean {
    this.open ??= this.work.linkedOpen()
    if (!this.open.length) return false
    const sessions = this.sessions()
    const touched = new Set(events.map((e) => e.sessionId))
    let moved = false
    for (const task of this.open) {
      const s = task.sessionName === null ? null : sessionNamed(sessions, task.sessionName)
      if (!s || !touched.has(s.id)) continue
      moved = this.move(task, s, events, before.get(s.id)) || moved
    }
    if (moved) this.invalidate()
    return moved
  }

  private move(task: WorkTask, s: SessionState, events: readonly AgentEvent[], was: Status | undefined): boolean {
    const mine = events.filter((e) => e.sessionId === s.id)
    if (!this.released.has(task.id) && (was === 'working' || s.status === 'working' || mine.some((e) => TURN_STARTS.has(e.kind)))) this.armed.set(task.id, s.id)
    if (s.status === 'working') {
      if (task.status !== 'todo') return false
      this.work.updateTask(task.id, { status: 'doing' }, s.lastEventAt)
      return true
    }
    // A turn finished in this batch, or the poll turned the session to done. A session that went on working, failed or is
    // waiting on the user is not finished.
    const stops = mine.filter((e) => e.kind === 'turn.stopped' && e.agentId === null && e.payload.stop_hook_active !== true)
    const finishedAt = stops.length ? stops[stops.length - 1]!.ts : s.status === 'done' && was !== 'done' ? s.lastEventAt : null
    if (finishedAt === null || (s.status !== 'done' && s.status !== 'idle')) return false
    if (this.armed.get(task.id) !== s.id || lastStopAsked(this.work, s.id)) return false
    this.armed.delete(task.id)
    return this.work.updateTask(task.id, { status: 'done' }, finishedAt).ok
  }
}
