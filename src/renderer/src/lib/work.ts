import type { AttentionItem, AttentionKind, Session, Status } from '@shared/snapshot'
import { pathKey } from '@shared/paths'
import { byPriority } from './selectors'
import type { EodDay, EodProject, EodReport, EodSettings, WorkTask } from '@shared/work'
import { duration } from './format'

/**
 * Pure helpers behind the Tasks and Daily report pages: which lane each task or agent session sits in, how days
 * are ordered, how a report reads. No React, no bridge, so the rules are unit-tested.
 */

// ---- Days --------------------------------------------------------------------------------------------------------

const pad = (n: number): string => String(n).padStart(2, '0')

export function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** A local calendar day as `YYYY-MM-DD`, the key the report contract uses. */
export function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Local midnight of a day key. */
export function dayStart(key: string): number {
  const [y = 1970, m = 1, d = 1] = key.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

/** The day `n` calendar days from `key` (negative = earlier), safe across daylight-saving changes. */
export function shiftDay(key: string, n: number): string {
  const [y = 1970, m = 1, d = 1] = key.split('-').map(Number)
  return dayKey(new Date(y, m - 1, d + n).getTime())
}

const hhmmFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** "14:02", 24-hour, for times inside a report. */
export function hhmm(ts: number): string {
  return hhmmFormat.format(ts)
}

/** "Today", "Yesterday", then "Mon, Nov 9". */
export function dayLabel(key: string, today: string): string {
  if (key === today) return 'Today'
  if (key === shiftDay(today, -1)) return 'Yesterday'
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(dayStart(key))
}

/** "Thursday, November 12": the report's own title. */
export function dayHeading(key: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(dayStart(key))
}

/** Today pinned first (even with no data yet), then the rest newest first. A day listed twice shows once. */
export function rankDays(days: readonly EodDay[] | null, today: string): EodDay[] {
  const seen = new Set<string>()
  const rest = [...(days ?? [])]
    .filter((d) => d.day !== today && !seen.has(d.day) && !!seen.add(d.day))
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
  const own = days?.find((d) => d.day === today) ?? { day: today, agentTimeMs: 0, sessions: 0, tasksDone: 0, hasFile: false }
  return [own, ...rest]
}

// ---- Task lanes --------------------------------------------------------------------------------------------------

export interface TaskItem {
  kind: 'task'
  task: WorkTask
  /** The background session this task was sent to, when the snapshot still lists it. */
  session: Session | null
  /** Waiting on you lane only: the session's most urgent open item, or null when it waits with no item yet. */
  reason?: AttentionKind | null
}
export interface AgentItem {
  kind: 'agent'
  session: Session
  reason?: AttentionKind | null
}
export type LaneItem = TaskItem | AgentItem

export interface Lanes {
  todo: TaskItem[]
  doing: LaneItem[]
  /** Waits on you: an approval, a question, a failure or a stuck run (open P1 to P3 items). */
  needs: LaneItem[]
  done: LaneItem[]
}

export function itemKey(item: LaneItem): string {
  return item.kind === 'task' ? `t:${item.task.id}` : `a:${item.session.id}`
}

/** A task's session by name; when names repeat across days the most recently active one wins. */
export function sessionForTask(task: WorkTask, sessions: readonly Session[]): Session | null {
  if (!task.sessionName) return null
  return sessions.filter((s) => s.name === task.sessionName).sort((a, b) => b.lastEventAt - a.lastEventAt)[0] ?? null
}

const isLive = (s: Session): boolean => s.status === 'working' || s.status === 'needs_you'
const isFinished = (s: Session): boolean => s.status === 'done' || s.status === 'failed'

/** The status a lane row shows: the session's, or null for a task nobody is working on. */
export function liveStatus(item: LaneItem): Status | null {
  return item.session?.status ?? null
}

/** Review (P4) is not waiting on you in this sense: the agent's work is finished, so it stays in Done today. */
const WAITING_MAX_PRIORITY = 3

const activityAt = (i: LaneItem): number => (i.kind === 'agent' ? i.session.lastEventAt : (i.session?.lastEventAt ?? i.task.createdAt))
const finishedAt = (i: LaneItem): number => (i.kind === 'agent' ? i.session.lastEventAt : (i.task.doneAt ?? i.task.createdAt))

/**
 * To do: open tasks, newest first. In progress: tasks you started plus live sessions no open task owns. Waiting on you: the
 * same, when the session waits on you (needs_you, or an open approval, question, failure or stuck item from the attention
 * engine), most urgent then longest waiting first; dismissing the item moves it on. Done today: tasks done today plus
 * sessions that finished today, no task owns and nothing waits on.
 */
export function buildLanes(tasks: readonly WorkTask[], sessions: readonly Session[], now: number, attention: readonly AttentionItem[]): Lanes {
  const today = startOfDay(now)
  const top = new Map<string, AttentionItem>()
  for (const i of byPriority(attention)) if (i.priority <= WAITING_MAX_PRIORITY && !top.has(i.sessionId)) top.set(i.sessionId, i)
  const waits = (s: Session | null): s is Session => !!s && (s.status === 'needs_you' || top.has(s.id))

  const items: TaskItem[] = tasks.map((task) => ({ kind: 'task', task, session: sessionForTask(task, sessions) }))
  const ownedOpen = new Set(items.flatMap((i) => (i.task.status !== 'done' && i.session ? [i.session.id] : [])))
  const ownedAny = new Set(items.flatMap((i) => (i.session ? [i.session.id] : [])))
  const agents = (list: Session[]): AgentItem[] => list.map((session) => ({ kind: 'agent', session }))

  const todo = items.filter((i) => i.task.status === 'todo').sort((a, b) => b.task.createdAt - a.task.createdAt)
  const started = items.filter((i) => i.task.status === 'doing')
  const unowned = sessions.filter((s) => !ownedOpen.has(s.id))

  // A session waiting with no item yet counts as P1 (D-054), waiting since it said so.
  const urgency = (s: Session): [number, number] => {
    const t = top.get(s.id)
    return t ? [t.priority, t.openedAt] : [1, s.waitingSince ?? s.lastEventAt]
  }
  const needs: LaneItem[] = [...started.filter((i) => waits(i.session)), ...agents(unowned.filter(waits))]
    .map((i) => ({ ...i, reason: top.get(i.session!.id)?.kind ?? null }))
    .sort((a, b) => {
      const [pa, ta] = urgency(a.session!)
      const [pb, tb] = urgency(b.session!)
      return pa - pb || ta - tb
    })
  const doing: LaneItem[] = [...started.filter((i) => !waits(i.session)), ...agents(unowned.filter((s) => isLive(s) && !waits(s)))].sort((a, b) => activityAt(b) - activityAt(a))
  const done: LaneItem[] = [
    ...items.filter((i) => i.task.status === 'done' && (i.task.doneAt ?? i.task.createdAt) >= today),
    ...agents(sessions.filter((s) => isFinished(s) && s.lastEventAt >= today && !ownedAny.has(s.id) && !waits(s)))
  ].sort((a, b) => finishedAt(b) - finishedAt(a))
  return { todo, doing, needs, done }
}

/** A card in Waiting on you that asks for you now. A stuck run (P3) waits quietly, as it does in the sidebar, so it never turns the count amber. */
export const asksNow = (i: LaneItem): boolean => i.reason !== 'stuck'

export interface LaneSummary {
  todo: number
  doing: number
  needs: number
  /** Of `needs`, the cards that ask for you now (`asksNow`). */
  asking: number
  done: number
  /** Agent sessions running right now (In progress, status working). */
  running: number
}

export function summarize(lanes: Lanes): LaneSummary {
  return {
    todo: lanes.todo.length,
    doing: lanes.doing.length,
    needs: lanes.needs.length,
    asking: lanes.needs.filter(asksNow).length,
    done: lanes.done.length,
    running: lanes.doing.filter((i) => liveStatus(i) === 'working').length
  }
}

// ---- Report ------------------------------------------------------------------------------------------------------

export interface ProjectBar {
  project: EodProject
  /** Length against the busiest project, 0-1: a ranking, so the longest bar is the busiest. */
  share: number
  /** Share of the day's agent time, 0-100, whole numbers. */
  percent: number
}

export function projectBars(projects: readonly EodProject[]): ProjectBar[] {
  const sorted = [...projects].sort((a, b) => b.agentTimeMs - a.agentTimeMs || a.name.localeCompare(b.name))
  const max = sorted[0]?.agentTimeMs ?? 0
  const total = sorted.reduce((sum, p) => sum + p.agentTimeMs, 0)
  return sorted.map((project) => ({
    project,
    share: max > 0 ? project.agentTimeMs / max : 0,
    percent: total > 0 ? Math.round((project.agentTimeMs / total) * 100) : 0
  }))
}

/** The sessions that ran in one project, longest first. */
export function sessionsOf(report: EodReport, cwd: string): EodReport['sessions'] {
  return report.sessions.filter((s) => pathKey(s.project) === pathKey(cwd)).sort((a, b) => b.agentTimeMs - a.agentTimeMs)
}

/** The line under the report's title: the day in one honest sentence. */
export function reportFinding(report: EodReport): string {
  const { totals } = report
  const blockers = report.blockers.length
  const failed = report.sessions.filter((s) => s.status === 'failed').length
  const waiting =
    (failed ? ` ${failed === 1 ? '1 session' : `${failed} sessions`} failed.` : '') +
    (blockers ? ` ${blockers === 1 ? '1 thing' : `${blockers} things`} still ${blockers === 1 ? 'waits' : 'wait'} on you.` : '')
  if (totals.agentTimeMs === 0 && totals.tasksDone === 0) return `A quiet day: no agent ran.${waiting}`
  const top = projectBars(report.projects)[0]
  const where = top && report.projects.length > 1 ? `, ${top.percent}% of it in ${top.project.name}` : top ? ` in ${top.project.name}` : ''
  return `Agents worked ${duration(totals.agentTimeMs)}${where}.${waiting}`
}

/**
 * The report's status line from Settings, or null when the daily report is off. Today's report is live until midnight;
 * the file is first written at `eod.time` and kept up to date after that.
 */
export function eodStatusLine(eod: EodSettings, now: number): string | null {
  if (!eod.enabled) return null
  const [h = 0, m = 0] = eod.time.split(':').map(Number)
  const published = now >= new Date(now).setHours(h, m, 0, 0)
  const when = published ? `Published at ${eod.time}, kept up to date until midnight` : `Will be published at ${eod.time}`
  return `${when} · folder ${eod.folder ?? 'AgentDeck data › eod'}`
}

// ---- Following the collector ----------------------------------------------------------------------------------------

/** What is on screen is read again at most this often, however fast `work-changed` arrives. */
export const WORK_REFETCH_MS = 1_000

/**
 * Runs `run` when the collector says tasks or the report changed: at once for the first change, then at most once a
 * second (a burst after it runs once more when the second is up). Returns the unsubscribe, which also drops a run that
 * is still waiting.
 */
export function followWork(subscribe: (listener: () => void) => () => void, run: () => void, gapMs = WORK_REFETCH_MS): () => void {
  let last = Number.NEGATIVE_INFINITY
  let timer: ReturnType<typeof setTimeout> | undefined
  const fire = (): void => {
    timer = undefined
    last = Date.now()
    run()
  }
  const off = subscribe(() => {
    if (timer !== undefined) return
    const wait = last + gapMs - Date.now()
    if (wait <= 0) fire()
    else timer = setTimeout(fire, wait)
  })
  return () => {
    off()
    clearTimeout(timer)
    timer = undefined
  }
}

const hhmmssFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })

/** "14:02:07": the report says when it was last read, to the second, so a live page shows that it is moving. */
export function hhmmss(ts: number): string {
  return hhmmssFormat.format(ts)
}

/** A hand tick after the finish is later than the session's last event by more than this; the agent's own is at the finish. */
const AGENT_DONE_AFTER_MS = 2_000
/** A session's last event can trail its finish (SessionEnd, a poll row) by seconds. */
const AGENT_DONE_BEFORE_MS = 60_000

/**
 * A done task its agent finished, derived from what the card already knows: it was sent to a session that is not working
 * now, and it was completed at that session's finish (a tick by hand lands when the user clicks). A label only; the user
 * can always undo it.
 */
export function doneByAgent(task: WorkTask, session: Session | null): boolean {
  if (task.status !== 'done' || task.doneAt === null || !task.sessionName || !session || isLive(session)) return false
  return task.doneAt <= session.lastEventAt + AGENT_DONE_AFTER_MS && task.doneAt >= session.lastEventAt - AGENT_DONE_BEFORE_MS
}

/** Tasks that were open in `before` and are done in `after`: the ones an agent completed while the page was open. */
export function newlyDone(before: readonly WorkTask[], after: readonly WorkTask[]): WorkTask[] {
  const was = new Map(before.map((t) => [t.id, t.status]))
  return after.filter((t) => t.status === 'done' && !!t.sessionName && was.has(t.id) && was.get(t.id) !== 'done')
}
