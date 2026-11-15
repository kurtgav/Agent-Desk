import type { EodDayRow } from '@shared/collector'
import { addDays, dayBounds, dayKey } from '@shared/day'
import { hasContent } from '@shared/eod-markdown'
import { projectName } from '@shared/paths'
import type { Status } from '@shared/snapshot'
import type { EodBlocker, EodProject, EodReport, EodSession } from '@shared/work'
import type { AttentionRecord } from './attention'
import { toSession, type SessionState } from './reduce'
import type { WorkStore } from './work-store'

/**
 * The Daily report, built from rows AgentDeck already holds: work spans, finished turns, changed files, approvals, events
 * and tasks. No transcript is read (ADR-0009) and nothing here calls a model.
 */

export interface EodLive {
  sessions: ReadonlyMap<string, SessionState>
  attention: readonly AttentionRecord[]
}

export const SUMMARY_MAX = 160
/** The poll's own bookkeeping: a session that only has these did not do anything that day. */
const POLL_ONLY = "'session.state', 'session.gone'"
/** Every UTC offset is a multiple of 15 min, so a 15 min bucket never straddles local midnight. */
const BUCKET_MS = 900_000
const DAYS_MAX = 400
/** The history list rebuilds this many days from events; older days are listed from their closed reports only. */
export const REBUILD_DAYS = 30

/** Length of [a, b] that falls inside [from, to]. */
const overlap = (a: number, b: number, from: number, to: number): number => Math.max(0, Math.min(b, to) - Math.max(a, from))

/** First line of a final message with its markdown marks off, at most 160 characters; null when there is no text. */
export function firstLine(message: string | null): string | null {
  if (!message) return null
  for (const raw of message.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|>\s*)/, '').replace(/\s+/g, ' ').trim()
    if (!line || line.startsWith('```')) continue
    return line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX - 1).trimEnd()}…` : line
  }
  return null
}

const finalMessage = (payload: string): string | null => {
  try {
    const m = (JSON.parse(payload) as Record<string, unknown>).last_assistant_message
    return typeof m === 'string' ? m : null
  } catch {
    return null
  }
}

/** Working time per session inside the day: closed stretches clipped to it, plus the stretch still open. */
function agentTime(work: WorkStore, live: EodLive, from: number, to: number, now: number): Map<string, number> {
  const out = new Map<string, number>()
  const add = (id: string, ms: number): void => {
    if (ms > 0) out.set(id, (out.get(id) ?? 0) + ms)
  }
  for (const r of work.db.prepare('SELECT session_id, start_ts, end_ts FROM work_spans WHERE end_ts > ? AND start_ts < ?').all(from, to)) {
    add(String(r.session_id), overlap(Number(r.start_ts), Number(r.end_ts), from, to))
  }
  for (const s of live.sessions.values()) {
    if (s.status === 'working' && s.workingSince !== null) add(s.id, overlap(s.workingSince, now, from, to))
  }
  return out
}

/** The day's last turn-ending event per session, and the final message of its last Stop. */
function turnEnds(work: WorkStore, from: number, to: number): { last: Map<string, string>; message: Map<string, string | null> } {
  const last = new Map<string, string>()
  const message = new Map<string, string | null>()
  const rows = work.db
    .prepare("SELECT session_id, kind, payload FROM events WHERE ts >= ? AND ts < ? AND agent_id IS NULL AND kind IN ('turn.stopped', 'turn.failed') ORDER BY seq")
    .all(from, to)
  for (const r of rows) {
    const id = String(r.session_id)
    last.set(id, String(r.kind))
    if (r.kind === 'turn.stopped') message.set(id, finalMessage(String(r.payload)))
  }
  return { last, message }
}

/** What a session was doing when the day ended: its status now, unless it went on after midnight. */
function statusAt(s: SessionState, to: number, lastEnd: string | undefined): Status {
  if (s.lastEventAt < to) return s.status
  return lastEnd === 'turn.stopped' ? 'done' : lastEnd === 'turn.failed' ? 'failed' : 'idle'
}

function blockers(live: EodLive): EodBlocker[] {
  return live.attention
    .map((i) => ({
      itemId: i.id, kind: i.kind, title: i.title, sessionId: i.sessionId, project: live.sessions.get(i.sessionId)?.cwd ?? '', openedAt: i.openedAt
    }))
    .sort((a, b) => a.openedAt - b.openedAt || (a.itemId < b.itemId ? -1 : 1))
}

function projectsOf(sessions: EodSession[], turns: Map<string, number>, files: Map<string, Set<string>>): EodProject[] {
  const byCwd = new Map<string, EodSession[]>()
  for (const s of sessions) byCwd.set(s.project, [...(byCwd.get(s.project) ?? []), s])
  return [...byCwd].map(([cwd, list]) => ({
    cwd,
    name: projectName(cwd) || 'Unknown project',
    agentTimeMs: list.reduce((t, s) => t + s.agentTimeMs, 0),
    sessions: list.length,
    turns: list.reduce((t, s) => t + (turns.get(s.id) ?? 0), 0),
    files: new Set(list.flatMap((s) => [...(files.get(s.id) ?? [])])).size
  }))
}

/** `YYYY-MM-DD` strings sort the same as the days they name. */
const isPast = (day: string, now: number): boolean => day < dayKey(now)

interface DayRows {
  /** Latest real event of each session that day. */
  lastAt: Map<string, number>
  /** Finished turns per session. */
  turns: Map<string, number>
  /** Distinct changed files per session. */
  files: Map<string, Set<string>>
}

function dayRows(work: WorkStore, from: number, to: number): DayRows {
  const db = work.db
  const lastAt = new Map<string, number>()
  const turns = new Map<string, number>()
  const files = new Map<string, Set<string>>()
  for (const r of db
    .prepare(`SELECT session_id, MAX(ts) AS at FROM events WHERE ts >= ? AND ts < ? AND kind NOT IN (${POLL_ONLY}) GROUP BY session_id`)
    .all(from, to)) {
    lastAt.set(String(r.session_id), Number(r.at))
  }
  for (const r of db.prepare('SELECT session_id FROM finished_turns WHERE ts >= ? AND ts < ?').all(from, to)) {
    const id = String(r.session_id)
    turns.set(id, (turns.get(id) ?? 0) + 1)
  }
  for (const r of db.prepare('SELECT session_id, path_key FROM files WHERE changed_at >= ? AND changed_at < ?').all(from, to)) {
    const id = String(r.session_id)
    const keys = files.get(id) ?? new Set<string>()
    files.set(id, keys.add(String(r.path_key)))
  }
  return { lastAt, turns, files }
}

/** Sessions with something to show that day, newest activity first. Rows whose session aged out of memory are left out. */
function sessionsOf(live: EodLive, time: Map<string, number>, rows: DayRows, ends: ReturnType<typeof turnEnds>, to: number): EodSession[] {
  const ids = new Set([...time.keys(), ...rows.lastAt.keys(), ...rows.turns.keys(), ...rows.files.keys()])
  return [...ids]
    .flatMap((id) => {
      const s = live.sessions.get(id)
      if (!s) return []
      const session: EodSession = {
        id,
        name: s.name,
        project: s.cwd,
        status: statusAt(s, to, ends.last.get(id)),
        startedAt: s.startedAt,
        lastEventAt: rows.lastAt.get(id) ?? Math.min(s.lastEventAt, to - 1),
        agentTimeMs: Math.round(time.get(id) ?? 0),
        plan: toSession(s).plan,
        summary: firstLine(ends.message.get(id) ?? null)
      }
      return [session]
    })
    .sort((a, b) => b.lastEventAt - a.lastEventAt || (a.id < b.id ? -1 : 1))
}

/** The report for `day` from live data and the database. Today's is as of `now`; a past day's is as of its own end. */
export function buildEod(work: WorkStore, live: EodLive, day: string, now: number): EodReport {
  const [from, to] = dayBounds(day)
  const rows = dayRows(work, from, to)
  const sessions = sessionsOf(live, agentTime(work, live, from, to, now), rows, turnEnds(work, from, to), to)
  const known = new Set(sessions.map((s) => s.id))
  const answered = work.db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE ts >= ? AND ts < ? AND outcome IN ('approved', 'rejected')").get(from, to)
  const tasksDone = work.doneBetween(from, to)
  return {
    day,
    generatedAt: now,
    closed: isPast(day, now),
    totals: {
      agentTimeMs: sessions.reduce((t, s) => t + s.agentTimeMs, 0),
      sessions: sessions.length,
      turns: [...rows.turns].reduce((t, [id, n]) => t + (known.has(id) ? n : 0), 0),
      filesChanged: new Set([...rows.files].flatMap(([id, keys]) => (known.has(id) ? [...keys] : []))).size,
      approvalsAnswered: Number(answered?.n ?? 0),
      tasksDone: tasksDone.length
    },
    projects: projectsOf(sessions, rows.turns, rows.files).sort((a, b) => b.agentTimeMs - a.agentTimeMs || (a.name < b.name ? -1 : 1)),
    sessions,
    tasksDone,
    carryOver: work.openAt(to),
    blockers: dayKey(now) === day ? blockers(live) : [],
    notes: work.notes(day) ?? ''
  }
}

/** The user's notes live in their own table, so every copy kept of a report takes them from there. */
const withNotes = (work: WorkStore, r: EodReport): EodReport => ({ ...r, notes: work.notes(r.day) ?? '' })

/**
 * A rebuilt report is never emptier than the copy kept before it: when events or sessions have aged out since, the agent
 * part of the kept copy stays and only the tasks, which live in their own table, come from the rebuild.
 */
export function keepFuller(next: EodReport, kept: EodReport): EodReport {
  if (next.totals.agentTimeMs >= kept.totals.agentTimeMs && next.sessions.length >= kept.sessions.length) return next
  return { ...next, totals: { ...kept.totals, tasksDone: next.totals.tasksDone }, projects: kept.projects, sessions: kept.sessions }
}

/** The kept copy ignoring when it was made: whether a new build says anything new. */
const sameContent = (a: EodReport, b: EodReport): boolean => JSON.stringify({ ...a, generatedAt: 0 }) === JSON.stringify({ ...b, generatedAt: 0 })

/**
 * Today is always live. A day that is over is its closed report, else rebuilt from the events still on disk
 * (and never emptier than the last copy kept while it was going).
 */
export function reportFor(work: WorkStore, live: EodLive, day: string, now: number): EodReport {
  if (!isPast(day, now)) return buildEod(work, live, day, now)
  const kept = work.kept(day)
  if (kept?.closed) return withNotes(work, kept.report)
  const built = buildEod(work, live, day, now)
  return kept ? keepFuller(built, kept.report) : built
}

/**
 * Builds the report and keeps a copy (open) when it says something new. `changed` is true only then, which is when the
 * file is worth writing again. A closed day is left as it is.
 */
export function refreshEod(work: WorkStore, live: EodLive, day: string, now: number): { report: EodReport; changed: boolean } {
  const kept = work.kept(day)
  if (kept?.closed && isPast(day, now)) return { report: withNotes(work, kept.report), changed: false }
  const report = buildEod(work, live, day, now)
  const changed = hasContent(report) && (!kept || !sameContent(kept.report, report))
  if (changed) work.keep(report, false, now)
  return { report, changed }
}

/**
 * Closes a day that is over: keeps its final report, so it outlives event retention. Asking again returns the closed
 * one (`fresh: false`). A day still going is not closed, and a day with nothing in it is not kept.
 */
export function finalizeEod(work: WorkStore, live: EodLive, day: string, now: number): { report: EodReport; fresh: boolean } {
  if (!isPast(day, now)) return { report: buildEod(work, live, day, now), fresh: false }
  const kept = work.kept(day)
  if (kept?.closed) return { report: withNotes(work, kept.report), fresh: false }
  const built = buildEod(work, live, day, now)
  const report = kept ? keepFuller(built, kept.report) : built
  if (hasContent(report)) work.keep(report, true, now)
  return { report, fresh: true }
}

/** Days with something to show, newest first: closed reports of any age, and the last 30 days from events, tasks and notes. */
export function eodDays(work: WorkStore, live: EodLive, now: number): EodDayRow[] {
  const oldest = addDays(dayKey(now), -REBUILD_DAYS)
  const since = dayBounds(oldest)[0]
  const closed = new Set(work.closedDays())
  const days = new Set<string>(closed)
  const recent = (day: string): boolean => day >= oldest
  for (const day of [...work.keptDays(), ...work.noteDays(), ...work.doneTimes(since).map(dayKey)]) if (recent(day)) days.add(day)
  for (const sql of [
    `SELECT DISTINCT ts / ${BUCKET_MS} AS b FROM events WHERE ts >= ? AND kind NOT IN (${POLL_ONLY})`,
    `SELECT DISTINCT end_ts / ${BUCKET_MS} AS b FROM work_spans WHERE end_ts >= ?`
  ]) {
    for (const r of work.db.prepare(sql).all(since)) days.add(dayKey(Number(r.b) * BUCKET_MS))
  }
  return [...days]
    .filter((day) => closed.has(day) || recent(day))
    .sort()
    .reverse()
    .slice(0, DAYS_MAX)
    .flatMap((day) => {
      const final = closed.has(day) && isPast(day, now) ? work.kept(day)?.report : undefined
      const r = final ? withNotes(work, final) : reportFor(work, live, day, now)
      if (!final && !hasContent(r)) return []
      return [{ day, agentTimeMs: r.totals.agentTimeMs, sessions: r.totals.sessions, tasksDone: r.totals.tasksDone, hasFile: false, closed: closed.has(day) }]
    })
}
