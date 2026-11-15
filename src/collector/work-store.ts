import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { EodReport, TaskInput, TaskPatch, TaskResult, TaskStatus, WorkTask } from '@shared/work'

/** A finished task is kept for a year; open ones, notes and closed reports are kept for good. */
export const TASK_RETENTION_MS = 365 * 86_400_000
const GONE = 'That task no longer exists. Refresh the list.'

type Row = Record<string, unknown>
const orNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

function toTask(r: Row): WorkTask {
  return {
    id: String(r.id),
    title: String(r.title),
    project: orNull(r.project),
    status: String(r.status) as TaskStatus,
    createdAt: Number(r.created_at),
    doneAt: r.done_at === null ? null : Number(r.done_at),
    sessionName: orNull(r.session_name),
    role: orNull(r.role),
    roleName: orNull(r.role_name)
  }
}

function isReport(v: unknown): v is EodReport {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Partial<EodReport>
  return typeof r.day === 'string' && typeof r.totals === 'object' && r.totals !== null && Array.isArray(r.sessions) && Array.isArray(r.projects)
}

/**
 * What the Tasks page and the Daily report keep on disk: tasks, the user's notes per day, and the closed reports.
 * None of it is derived from events, so none of it follows the 30-day event retention.
 */
export class WorkStore {
  constructor(readonly db: DatabaseSync) {}

  listTasks(): WorkTask[] {
    return this.db.prepare('SELECT * FROM tasks ORDER BY created_at, rowid').all().map(toTask)
  }

  task(id: string): WorkTask | null {
    const r = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
    return r ? toTask(r) : null
  }

  /** Tasks sent to an agent that are not done: the only ones a session's progress can move (follow.ts). */
  linkedOpen(): WorkTask[] {
    return this.db.prepare("SELECT * FROM tasks WHERE session_name IS NOT NULL AND status <> 'done' ORDER BY created_at, rowid").all().map(toTask)
  }

  /** `roleName`: the name of `input.role` as main read it from the catalog; only kept with a role. */
  addTask(input: TaskInput, now: number, roleName: string | null = null): WorkTask {
    const role = input.role ?? null
    const task: WorkTask = {
      id: randomUUID(), title: input.title, project: input.project, status: 'todo', createdAt: now, doneAt: null, sessionName: null, role, roleName: role ? roleName : null
    }
    this.db
      .prepare('INSERT INTO tasks (id, title, project, status, created_at, done_at, session_name, role, role_name) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)')
      .run(task.id, task.title, task.project, task.status, task.createdAt, task.role ?? null, task.roleName ?? null)
    return task
  }

  /** Moving to `done` sets `doneAt` to `now` (once; follow.ts passes the session's finish time); moving back clears it. */
  updateTask(id: string, patch: TaskPatch, now: number, roleName: string | null = null): TaskResult {
    const cur = this.task(id)
    if (!cur) return { ok: false, error: GONE }
    const status = patch.status ?? cur.status
    // A new role brings its name; `null` takes the role off; an untouched role keeps both.
    const role = patch.role === undefined ? (cur.role ?? null) : patch.role
    const keptName = patch.role === undefined || patch.role === cur.role ? (cur.roleName ?? null) : null
    const next: WorkTask = {
      ...cur,
      title: patch.title ?? cur.title,
      project: patch.project === undefined ? cur.project : patch.project,
      sessionName: patch.sessionName === undefined ? cur.sessionName : patch.sessionName,
      role,
      roleName: role ? (roleName ?? keptName) : null,
      status,
      doneAt: status === 'done' ? (cur.status === 'done' ? (cur.doneAt ?? now) : now) : null
    }
    this.db
      .prepare('UPDATE tasks SET title = ?, project = ?, status = ?, done_at = ?, session_name = ?, role = ?, role_name = ? WHERE id = ?')
      .run(next.title, next.project, next.status, next.doneAt, next.sessionName, next.role ?? null, next.roleName ?? null, id)
    return { ok: true, task: next }
  }

  removeTask(id: string): void {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  }

  /** Tasks finished inside [from, to). */
  doneBetween(from: number, to: number): WorkTask[] {
    return this.db.prepare('SELECT * FROM tasks WHERE done_at >= ? AND done_at < ? ORDER BY done_at, rowid').all(from, to).map(toTask)
  }

  /** Tasks that were open when the day ended at `to`: made before it and not finished before it. */
  openAt(to: number): WorkTask[] {
    return this.db.prepare('SELECT * FROM tasks WHERE created_at < ? AND (done_at IS NULL OR done_at >= ?) ORDER BY created_at, rowid').all(to, to).map(toTask)
  }

  /** Every time a task was finished since `since`, for the history list. */
  doneTimes(since: number): number[] {
    return this.db.prepare('SELECT done_at FROM tasks WHERE done_at >= ?').all(since).map((r) => Number(r.done_at))
  }

  /** The user's notes for the day, or null when none were ever saved. */
  notes(day: string): string | null {
    const r = this.db.prepare('SELECT notes FROM eod_notes WHERE day = ?').get(day)
    return r ? String(r.notes) : null
  }

  /** Blank notes remove the row, so a day with nothing written is not listed for it. */
  setNotes(day: string, notes: string, now: number): void {
    if (notes.trim() === '') {
      this.db.prepare('DELETE FROM eod_notes WHERE day = ?').run(day)
      return
    }
    this.db
      .prepare('INSERT INTO eod_notes (day, notes, updated_at) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at')
      .run(day, notes, now)
  }

  noteDays(): string[] {
    return this.db.prepare('SELECT day FROM eod_notes').all().map((r) => String(r.day))
  }

  /** The report kept for a day, open (the day is still going) or closed (it is over), or null when none is kept or the row cannot be read. */
  kept(day: string): { report: EodReport; closed: boolean } | null {
    const r = this.db.prepare('SELECT json, closed FROM eod_reports WHERE day = ?').get(day)
    if (!r) return null
    try {
      const v: unknown = JSON.parse(String(r.json))
      return isReport(v) ? { report: v, closed: Number(r.closed) === 1 } : null
    } catch {
      return null
    }
  }

  keep(report: EodReport, closed: boolean, now: number): void {
    this.db
      .prepare('INSERT OR REPLACE INTO eod_reports (day, json, closed, generated_at) VALUES (?, ?, ?, ?)')
      .run(report.day, JSON.stringify(report), closed ? 1 : 0, now)
  }

  keptDays(): string[] {
    return this.db.prepare('SELECT day FROM eod_reports').all().map((r) => String(r.day))
  }

  closedDays(): string[] {
    return this.db.prepare('SELECT day FROM eod_reports WHERE closed = 1').all().map((r) => String(r.day))
  }

  /** Retention: only finished tasks age out. */
  prune(now: number): void {
    this.db.prepare('DELETE FROM tasks WHERE done_at IS NOT NULL AND done_at < ?').run(now - TASK_RETENTION_MS)
  }
}
