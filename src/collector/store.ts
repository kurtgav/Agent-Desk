import { DatabaseSync } from 'node:sqlite'
import type { History, PlanTask, SessionDetail } from '@shared/detail'
import { dayKey } from '@shared/day'
import { pathKey } from '@shared/paths'
import { SNAPSHOT_FILES_MAX, SNAPSHOT_SESSIONS_MAX, type ChangedFile, type Snapshot, type Usage } from '@shared/snapshot'
import { DEFAULT_WEEKLY_BUDGET_USD } from '@shared/work'
import {
  answer, attend, dismiss, emptyAttention, fastPollUntil, stall, toItem, type AttentionRecord, type AttentionState, type Attended, type StallConfig
} from './attention'
import type { AgentEvent } from './events'
import type { AuditRow, HoldOutcome } from './holds'
import { closeStale, correlate, duePoll, reduceSession, toSession, type SessionState } from './reduce'
import { summarizeUsage, type UsagePoint, type UsageType } from './usage'
import { summarizeLog } from './usage-log-summary'
import { UsageLogStore } from './usage-log-store'
import type { WatcherStatus } from './usage-log'
import { WorkStore } from './work-store'

/** ADR-0003. Each entry runs once, in order, inside one transaction; `user_version` records progress. */
const MIGRATIONS = [
  `CREATE TABLE events (
     seq INTEGER PRIMARY KEY,
     id TEXT NOT NULL UNIQUE,
     ts INTEGER NOT NULL,
     source TEXT NOT NULL,
     session_id TEXT NOT NULL,
     agent_id TEXT,
     agent_type TEXT,
     kind TEXT NOT NULL,
     tool_name TEXT,
     tool_use_id TEXT,
     summary TEXT NOT NULL,
     cwd TEXT,
     dedupe_key TEXT UNIQUE,
     payload TEXT NOT NULL
   );
   CREATE INDEX events_session_ts ON events(session_id, ts);
   CREATE INDEX events_ts ON events(ts);
   CREATE TABLE sessions (id TEXT PRIMARY KEY, last_event_at INTEGER NOT NULL, state TEXT NOT NULL);
   CREATE TABLE work_spans (session_id TEXT NOT NULL, start_ts INTEGER NOT NULL, end_ts INTEGER NOT NULL);
   CREATE INDEX work_spans_end ON work_spans(end_ts);
   CREATE TABLE finished_turns (session_id TEXT NOT NULL, ts INTEGER NOT NULL);
   CREATE INDEX finished_turns_ts ON finished_turns(ts);
   CREATE TABLE files (path_key TEXT NOT NULL, path TEXT NOT NULL, session_id TEXT NOT NULL, tool TEXT NOT NULL, changed_at INTEGER NOT NULL);
   CREATE INDEX files_changed_at ON files(changed_at);`,
  // M3: the attention engine's output (ADR-0013). `data` is the AttentionRecord as JSON; the columns are for queries and Diagnostics.
  `CREATE TABLE attention_items (
     id TEXT PRIMARY KEY,
     session_id TEXT NOT NULL,
     key TEXT NOT NULL,
     state TEXT NOT NULL,
     opened_at INTEGER NOT NULL,
     resolved_at INTEGER,
     resolved_by TEXT,
     data TEXT NOT NULL
   );
   CREATE INDEX attention_items_state ON attention_items(state);
   CREATE INDEX attention_items_opened ON attention_items(opened_at);`,
  // M4: the remote approvals audit log (ADR-0006), one row per held request, written when it settles.
  `CREATE TABLE approvals (
     seq INTEGER PRIMARY KEY,
     ts INTEGER NOT NULL,
     requested_at INTEGER NOT NULL,
     item_id TEXT NOT NULL,
     session_id TEXT NOT NULL,
     agent_id TEXT,
     tool_name TEXT,
     title TEXT NOT NULL,
     input_hash TEXT NOT NULL,
     risk_flags TEXT NOT NULL,
     outcome TEXT NOT NULL
   );
   CREATE INDEX approvals_ts ON approvals(ts);`,
  // M4: tasks, the user's end-of-day notes and the closed daily reports. Not derived from events, so the prune leaves them alone.
  `CREATE TABLE tasks (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     project TEXT,
     status TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     done_at INTEGER,
     session_name TEXT
   );
   CREATE INDEX tasks_done_at ON tasks(done_at);
   CREATE TABLE eod_notes (day TEXT PRIMARY KEY, notes TEXT NOT NULL, updated_at INTEGER NOT NULL);
   CREATE TABLE eod_reports (day TEXT PRIMARY KEY, json TEXT NOT NULL, closed INTEGER NOT NULL, generated_at INTEGER NOT NULL);`,
  // Usage from Claude Code's OTel metrics (ADR-0007): delta points summed per local day × model × type. No session, no
  // account: the identity attributes never reach this table (R12). `type` is input, output, cacheRead, cacheCreation or cost.
  `CREATE TABLE usage (
     day TEXT NOT NULL,
     model TEXT NOT NULL,
     type TEXT NOT NULL,
     value REAL NOT NULL,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (day, model, type)
   ) WITHOUT ROWID;`,
  // Token counts read from Claude Code's local logs (ADR-0009 amendment, opt-in `usage.readLogs`), one row per assistant message
  // (`key` = message id : request id, so a streamed message counts once) and where reading stopped in each file. Apart from the
  // OTel `usage` table: the snapshot takes one source or the other, never both. No prompt, reply, tool data or path is stored
  // except the log file's own path in usage_log_files, which is needed to resume reading it.
  `CREATE TABLE usage_log (
     key TEXT PRIMARY KEY,
     ts INTEGER NOT NULL,
     model TEXT NOT NULL,
     input INTEGER NOT NULL,
     output INTEGER NOT NULL,
     cache_read INTEGER NOT NULL,
     cache_write INTEGER NOT NULL,
     cache_write_1h INTEGER NOT NULL,
     odd INTEGER NOT NULL
   ) WITHOUT ROWID;
   CREATE INDEX usage_log_ts ON usage_log(ts);
   CREATE TABLE usage_log_files (
     path TEXT PRIMARY KEY,
     size INTEGER NOT NULL,
     mtime INTEGER NOT NULL,
     offset INTEGER NOT NULL,
     head TEXT NOT NULL
   ) WITHOUT ROWID;`,
  // Roles: the role a task is for (a Roles catalog id) and its name when it was chosen, so the daily report still says "as CTO" if the
  // role is renamed or deleted. Both are nullable and ignored by a build that does not know them (every statement names its columns).
  `ALTER TABLE tasks ADD COLUMN role TEXT;
   ALTER TABLE tasks ADD COLUMN role_name TEXT;`
]

const DAY_MS = 86_400_000
export const RETENTION_MS = 30 * DAY_MS
/**
 * D-056: a byte-identical body within this window is a repeated delivery. Later ones are real: a PermissionRequest
 * has no per-request field, so asking twice for the same command sends the same bytes.
 */
export const DEDUPE_MS = 2_000
const MAX_AGENT_TYPES = 5
/** The drawer (UI_MAP § Session drawer): newest events and files of one session. */
const TIMELINE_MAX = 200
const DETAIL_FILES_MAX = 100

/** D-008: a week starts Monday 00:00 local time. */
export function weekStart(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}

function lastWeekStart(now: number): number {
  const d = new Date(weekStart(now))
  d.setDate(d.getDate() - 7)
  return d.getTime()
}

/** Length of [a, b] that falls inside [from, to]. */
const overlap = (a: number, b: number, from: number, to: number): number => Math.max(0, Math.min(b, to) - Math.max(a, from))

interface Span {
  sessionId: string
  start: number
  end: number
}

export interface SnapshotExtras {
  awaySince: number | null
  awayUntil: number | null
  agentDefinitionCount: number
  /** The Usage card's bar (Settings › Claude Code); the default until main says otherwise. */
  weeklyBudgetUsd?: number
  /** `usage.readLogs` is on: the card is fed from the local logs, with this watcher's progress. Absent or off: from OTel. */
  usageLogs?: WatcherStatus
}

interface UsageCell {
  day: string
  type: UsageType
  value: number
}

/** The model name is cut and cleaned at parse time and can hold no tab, so a tab joins the three parts safely. */
const usageKey = (day: string, model: string, type: string): string => [day, model, type].join('\t')

export class Store {
  private readonly db: DatabaseSync
  /** Tasks, notes and closed daily reports: the tables the event prune never touches. */
  readonly work: WorkStore
  /** Token counts read from the local logs; empty and untouched unless `usage.readLogs` is on. */
  readonly usageLog: UsageLogStore
  private logSummary: { key: string; usage: Usage } | null = null
  private readonly sessions = new Map<string, SessionState>()
  private spans: Span[] = []
  private finished: number[] = []
  private files: ChangedFile[] = []
  private readonly agentTypes = new Map<string, number>()
  /** dedupeKey → arrival, oldest first (D-056). */
  private readonly recent = new Map<string, number>()
  private attention: AttentionState = emptyAttention()
  /** Usage rows of the last 30 days, keyed day · model · type (ADR-0007), and when figures last arrived. */
  private readonly usage = new Map<string, UsageCell>()
  private usageAt: number | null = null

  constructor(file: string, now = Date.now()) {
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;')
    this.migrate()
    this.work = new WorkStore(this.db)
    this.usageLog = new UsageLogStore(this.db, now)
    this.load(now)
  }

  /** What the Daily report needs from memory: stretches still open, session names and folders, and what waits on the user. */
  eodLive(): { sessions: ReadonlyMap<string, SessionState>; attention: readonly AttentionRecord[] } {
    return { sessions: this.sessions, attention: this.attention.open }
  }

  close(): void {
    this.db.close()
  }

  private migrate(): void {
    const { user_version: version } = this.db.prepare('PRAGMA user_version').get() as { user_version: number }
    MIGRATIONS.slice(version).forEach((sql, i) =>
      this.tx(() => {
        this.db.exec(sql)
        this.db.exec(`PRAGMA user_version = ${version + i + 1}`)
      })
    )
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  private load(now: number): void {
    const since = lastWeekStart(now)
    for (const row of this.db.prepare('SELECT state FROM sessions WHERE last_event_at >= ?').all(now - RETENTION_MS)) {
      const s = JSON.parse(String(row.state)) as SessionState
      this.sessions.set(s.id, s)
    }
    this.closeStaleSessions()
    const open = this.db.prepare("SELECT data FROM attention_items WHERE state = 'open' ORDER BY opened_at").all()
    // A hold lives in a connection, so none survives a restart: the terminal asks instead.
    const unheld = (i: AttentionRecord): AttentionRecord => (i.held ? { ...i, held: false, hint: null } : i)
    this.attention = { open: open.map((r) => unheld(JSON.parse(String(r.data)) as AttentionRecord)), quiet: {} }
    this.spans = this.db
      .prepare('SELECT session_id, start_ts, end_ts FROM work_spans WHERE end_ts >= ?')
      .all(since)
      .map((r) => ({ sessionId: String(r.session_id), start: Number(r.start_ts), end: Number(r.end_ts) }))
    this.finished = this.db
      .prepare('SELECT ts FROM finished_turns WHERE ts >= ?')
      .all(since)
      .map((r) => Number(r.ts))
    this.files = this.db
      .prepare('SELECT path, session_id, tool, changed_at FROM files WHERE changed_at >= ? ORDER BY changed_at')
      .all(since)
      .map((r) => ({ path: String(r.path), sessionId: String(r.session_id), tool: String(r.tool), changedAt: Number(r.changed_at) }))
    for (const r of this.db.prepare('SELECT day, model, type, value, updated_at FROM usage WHERE day >= ?').all(dayKey(now - RETENTION_MS))) {
      this.usage.set(usageKey(String(r.day), String(r.model), String(r.type)), { day: String(r.day), type: String(r.type) as UsageType, value: Number(r.value) })
      this.usageAt = Math.max(this.usageAt ?? 0, Number(r.updated_at))
    }
    for (const r of this.db
      // Subagents only (UI_MAP § Agents): main-thread events also carry agent_type when settings name an `agent`.
      .prepare("SELECT agent_type, MAX(ts) AS at FROM events WHERE kind = 'subagent.started' AND agent_type IS NOT NULL AND ts >= ? GROUP BY agent_type")
      .all(now - 7 * DAY_MS)) {
      this.agentTypes.set(String(r.agent_type), Number(r.at))
    }
  }

  /** D-057: sessions that were working when AgentDeck stopped end their stretch at their last event. */
  private closeStaleSessions(): void {
    const closed = [...this.sessions.values()].flatMap((s) => {
      const c = closeStale(s)
      return c.session === s ? [] : [c]
    })
    if (!closed.length) return
    const upsert = this.db.prepare('UPDATE sessions SET state = ? WHERE id = ?')
    const insertSpan = this.db.prepare('INSERT INTO work_spans (session_id, start_ts, end_ts) VALUES (?, ?, ?)')
    this.tx(() => {
      for (const { session, span } of closed) {
        upsert.run(JSON.stringify(session), session.id)
        if (span) insertSpan.run(session.id, span[0], span[1])
      }
    })
    for (const { session } of closed) this.sessions.set(session.id, session)
  }

  /** Sessions not known to have ended; the Poller ends the ones its first poll doesn't list (D-057). */
  liveIds(): string[] {
    return [...this.sessions.values()].filter((s) => !s.ended).map((s) => s.id)
  }

  /** Poll rows held back by the hook window whose window has now passed (D-058). */
  duePolls(now: number): AgentEvent[] {
    return [...this.sessions.values()].flatMap((s) => duePoll(s, now) ?? [])
  }

  /** Writes what the attention engine opened and closed; call inside a transaction. */
  private saveAttention(a: Attended): void {
    if (a.opened.length) {
      const insert = this.db.prepare('INSERT INTO attention_items (id, session_id, key, state, opened_at, data) VALUES (?, ?, ?, ?, ?, ?)')
      for (const i of a.opened) insert.run(i.id, i.sessionId, i.key, 'open', i.openedAt, JSON.stringify(i))
    }
    if (a.closed.length) {
      const update = this.db.prepare('UPDATE attention_items SET state = ?, resolved_at = ?, resolved_by = ? WHERE id = ?')
      for (const c of a.closed) update.run(c.state, c.at, c.by, c.item.id)
    }
  }

  /** P3 stall rules, on the collector's timer. Returns whether an item opened. */
  tick(now: number, cfg?: StallConfig): boolean {
    const a = stall(this.attention, this.sessions.values(), now, cfg)
    if (!a.opened.length) return false
    this.tx(() => this.saveAttention(a))
    this.attention = a.state
    return true
  }

  /** User Dismiss from the window (P2–P4). Returns whether an item closed. */
  dismiss(id: string, now: number, cfg?: StallConfig): boolean {
    const a = dismiss(this.attention, id, now, cfg)
    if (!a.closed.length) return false
    this.tx(() => this.saveAttention(a))
    this.attention = a.state
    return true
  }

  /**
   * Ingests a PermissionRequest that AgentDeck holds (ADR-0006) and returns its approval item: the one this event
   * opened, or the open one a repeated delivery matched. Ingesting closed this agent's earlier P1 items, so it is the last.
   */
  holdFor(ev: AgentEvent): AttentionRecord | null {
    this.ingest([ev])
    return this.attention.open.filter((i) => i.sessionId === ev.sessionId && i.agentId === ev.agentId && i.kind === 'approval' && i.source === 'hook').at(-1) ?? null
  }

  isOpen(id: string): boolean {
    return this.attention.open.some((i) => i.id === id)
  }

  /** Marks an open approval as waiting in AgentDeck, or not any more. Returns whether it changed. */
  setHeld(id: string, held: boolean, hint: string | null): boolean {
    const item = this.attention.open.find((i) => i.id === id)
    if (!item || item.held === held) return false
    const next = { ...item, held, hint }
    this.db.prepare('UPDATE attention_items SET data = ? WHERE id = ?').run(JSON.stringify(next), id)
    this.attention = { ...this.attention, open: this.attention.open.map((i) => (i === item ? next : i)) }
    return true
  }

  /** Approve or Reject went out: the held item closes, resolved by AgentDeck. Returns whether it closed. */
  answer(id: string, now: number): boolean {
    const a = answer(this.attention, id, now)
    if (!a.closed.length) return false
    this.tx(() => this.saveAttention(a))
    this.attention = a.state
    return true
  }

  audit(row: AuditRow): void {
    this.db
      .prepare(
        `INSERT INTO approvals (ts, requested_at, item_id, session_id, agent_id, tool_name, title, input_hash, risk_flags, outcome)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(row.ts, row.requestedAt, row.itemId, row.sessionId, row.agentId, row.toolName, row.title, row.inputHash, JSON.stringify(row.riskFlags), row.outcome)
  }

  /** The audit log, newest first. */
  auditLog(limit: number): AuditRow[] {
    return this.db
      .prepare('SELECT * FROM approvals ORDER BY ts DESC, seq DESC LIMIT ?')
      .all(limit)
      .map((r) => ({
        ts: Number(r.ts), requestedAt: Number(r.requested_at), itemId: String(r.item_id), sessionId: String(r.session_id),
        agentId: r.agent_id === null ? null : String(r.agent_id), toolName: r.tool_name === null ? null : String(r.tool_name),
        title: String(r.title), inputHash: String(r.input_hash), riskFlags: JSON.parse(String(r.risk_flags)) as string[], outcome: String(r.outcome) as HoldOutcome
      }))
  }

  /** The 1 s poll runs until this time (0 = never), while a P1 item is open. */
  fastPollUntil(): number {
    return fastPollUntil(this.attention)
  }

  /** D-056. Forgets keys older than the window, then reports whether this one was seen inside it. */
  private repeated(ev: AgentEvent): boolean {
    for (const [k, at] of this.recent) {
      if (ev.ts - at < DEDUPE_MS) break
      this.recent.delete(k)
    }
    if (!ev.dedupeKey) return false
    const at = this.recent.get(ev.dedupeKey)
    if (at !== undefined && ev.ts - at < DEDUPE_MS) return true
    this.recent.set(ev.dedupeKey, ev.ts)
    return false
  }

  /**
   * One transaction per batch: events plus every derived row they produce (ADR-0003). Returns whether anything changed.
   * Memory is updated only after COMMIT, so a failed batch leaves it in step with the database.
   */
  ingest(events: readonly AgentEvent[]): boolean {
    if (!events.length) return false
    const insertEvent = this.db.prepare(
      `INSERT OR IGNORE INTO events (id, ts, source, session_id, agent_id, agent_type, kind, tool_name, tool_use_id, summary, cwd, dedupe_key, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const upsertSession = this.db.prepare(
      'INSERT INTO sessions (id, last_event_at, state) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET last_event_at = excluded.last_event_at, state = excluded.state'
    )
    const insertSpan = this.db.prepare('INSERT INTO work_spans (session_id, start_ts, end_ts) VALUES (?, ?, ?)')
    const insertFinished = this.db.prepare('INSERT INTO finished_turns (session_id, ts) VALUES (?, ?)')
    const insertFile = this.db.prepare('INSERT INTO files (path_key, path, session_id, tool, changed_at) VALUES (?, ?, ?, ?, ?)')

    const fresh = events.filter((ev) => !this.repeated(ev)) // STATE_MACHINE § 6 test 7
    if (!fresh.length) return false
    const sessions = new Map<string, SessionState>()
    const spans: Span[] = []
    const finished: number[] = []
    const files: ChangedFile[] = []
    const agentTypes: [string, number][] = []
    let attention = this.attention

    this.tx(() => {
      for (const raw of fresh) {
        const prev = sessions.get(raw.sessionId) ?? this.sessions.get(raw.sessionId)
        const ev = correlate(prev, raw)
        // dedupe_key stays NULL: the UNIQUE column would reject a real repeat after the window (D-056).
        insertEvent.run(
          ev.id, ev.ts, ev.source, ev.sessionId, ev.agentId, ev.agentType, ev.kind, ev.toolName, ev.toolUseId,
          ev.summary, ev.cwd, null, JSON.stringify(ev.payload)
        )
        const r = reduceSession(prev, ev)
        sessions.set(ev.sessionId, r.session)
        const a = attend(attention, ev, r.session)
        this.saveAttention(a)
        attention = a.state
        if (ev.kind === 'subagent.started' && ev.agentType) agentTypes.push([ev.agentType, ev.ts])
        if (r.span) {
          insertSpan.run(ev.sessionId, r.span[0], r.span[1])
          spans.push({ sessionId: ev.sessionId, start: r.span[0], end: r.span[1] })
        }
        if (r.finishedAt !== null) {
          insertFinished.run(ev.sessionId, r.finishedAt)
          finished.push(r.finishedAt)
        }
        if (r.file) {
          insertFile.run(pathKey(r.file.path), r.file.path, ev.sessionId, r.file.tool, ev.ts)
          files.push({ path: r.file.path, sessionId: ev.sessionId, tool: r.file.tool, changedAt: ev.ts })
        }
      }
      for (const [id, s] of sessions) upsertSession.run(id, s.lastEventAt, JSON.stringify(s))
    })

    for (const [id, s] of sessions) this.sessions.set(id, s)
    this.attention = attention
    for (const [t, at] of agentTypes) this.agentTypes.set(t, at)
    this.spans.push(...spans)
    this.finished.push(...finished)
    this.files.push(...files)
    return true
  }

  /** ADR-0007: Claude Code's token and cost deltas, added to today's rows. Returns whether anything was stored. */
  ingestUsage(points: readonly UsagePoint[], now: number): boolean {
    if (!points.length) return false
    const day = dayKey(now)
    const upsert = this.db.prepare(
      `INSERT INTO usage (day, model, type, value, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(day, model, type) DO UPDATE SET value = value + excluded.value, updated_at = excluded.updated_at`
    )
    this.tx(() => {
      for (const p of points) upsert.run(day, p.model, p.type, p.value, now)
    })
    for (const p of points) {
      const key = usageKey(day, p.model, p.type)
      this.usage.set(key,{ day, type: p.type, value: (this.usage.get(key)?.value ?? 0) + p.value })
    }
    this.usageAt = now
    return true
  }

  /** When figures last arrived, or null if none did in the last 30 days. */
  lastUsageAt(): number | null {
    return this.usageAt
  }

  /** From the logs: always a figure (zero is one) while reading is on. Rebuilt at most once a second, or when a figure changes. */
  private logUsage(now: number, weeklyBudgetUsd: number, status: WatcherStatus): Usage {
    const key = [this.usageLog.version, status.done, status.total, status.files, weeklyBudgetUsd, Math.floor(now / 1000)].join(':')
    if (this.logSummary?.key === key) return this.logSummary.usage
    const usage = summarizeLog({
      records: [...this.usageLog.records()],
      now,
      todayFrom: new Date(now).setHours(0, 0, 0, 0),
      weekFrom: weekStart(now),
      weeklyBudgetUsd,
      scan: status.scanning ? { done: status.done, total: status.total } : null,
      files: status.files,
      lastAt: status.lastAt
    })
    this.logSummary = { key, usage }
    return usage
  }

  /** Null until Claude Code has reported once: the card shows its prompt, never an invented zero. */
  private usageSummary(now: number, weeklyBudgetUsd: number): Usage | null {
    return this.usageAt === null ? null : summarizeUsage(this.usage.values(), dayKey(now), dayKey(weekStart(now)), weeklyBudgetUsd)
  }

  snapshot(now: number, extras: SnapshotExtras): Snapshot {
    const week = weekStart(now)
    const lastWeek = lastWeekStart(now)
    const sessions = [...this.sessions.values()]
      .filter((s) => !s.ended || s.lastEventAt >= week)
      .sort((a, b) => b.lastEventAt - a.lastEventAt)
      .slice(0, SNAPSHOT_SESSIONS_MAX)

    const open = [...this.sessions.values()].filter((s) => s.status === 'working' && s.workingSince !== null)
    const agentTime = (from: number, to: number): number =>
      this.spans.reduce((t, x) => t + overlap(x.start, x.end, from, to), 0) +
      open.reduce((t, s) => t + overlap(s.workingSince!, now, from, to), 0)

    const latest = new Map<string, ChangedFile>()
    for (const f of this.files) if (f.changedAt >= week) latest.set(pathKey(f.path), f)

    return {
      mode: 'live',
      generatedAt: now,
      awaySince: extras.awaySince,
      awayUntil: extras.awayUntil,
      sessions: sessions.map(toSession),
      attention: this.attention.open.map(toItem),
      files: [...latest.values()].sort((a, b) => b.changedAt - a.changedAt).slice(0, SNAPSHOT_FILES_MAX),
      week: {
        agentTimeMs: Math.round(agentTime(week, now)),
        agentTimeLastWeekMs: Math.round(agentTime(lastWeek, week)),
        finishedTurns: this.finished.filter((t) => t >= week)
      },
      // One source, never both: with the logs on their figures replace the OTel ones, so nothing is counted twice.
      usage: extras.usageLogs
        ? this.logUsage(now, extras.weeklyBudgetUsd ?? DEFAULT_WEEKLY_BUDGET_USD, extras.usageLogs)
        : this.usageSummary(now, extras.weeklyBudgetUsd ?? DEFAULT_WEEKLY_BUDGET_USD),
      recentAgentTypes: [...this.agentTypes.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_AGENT_TYPES)
        .map(([t]) => t),
      agentDefinitionCount: extras.agentDefinitionCount
    }
  }

  /** The Activity page: the newest events across every session (30 days), newest first. */
  activity(limit: number): History['activity'] {
    return this.db
      .prepare('SELECT id, ts, kind, agent_type, summary, session_id FROM events ORDER BY ts DESC, seq DESC LIMIT ?')
      .all(limit)
      .map((r) => ({
        id: String(r.id), ts: Number(r.ts), kind: String(r.kind), agentType: r.agent_type === null ? null : String(r.agent_type),
        summary: String(r.summary), sessionId: String(r.session_id)
      }))
  }

  /** One session for the drawer, from the database (30 days), or null when it is unknown. */
  detail(sessionId: string): SessionDetail | null {
    const s = this.sessions.get(sessionId)
    if (!s) return null
    const timeline = this.db
      .prepare('SELECT id, ts, kind, agent_type, summary FROM events WHERE session_id = ? ORDER BY ts DESC, seq DESC LIMIT ?')
      .all(sessionId, TIMELINE_MAX)
      .map((r) => ({ id: String(r.id), ts: Number(r.ts), kind: String(r.kind), agentType: r.agent_type === null ? null : String(r.agent_type), summary: String(r.summary) }))
    const tasks = new Map<string, PlanTask>()
    for (const r of this.db
      .prepare("SELECT kind, payload FROM events WHERE session_id = ? AND kind IN ('task.created', 'task.completed') ORDER BY seq")
      .all(sessionId)) {
      const p = JSON.parse(String(r.payload)) as Record<string, unknown>
      if (typeof p.task_id !== 'string') continue
      const prev = tasks.get(p.task_id)
      const subject = typeof p.task_subject === 'string' ? p.task_subject : (prev?.subject ?? 'A task')
      tasks.set(p.task_id, { id: p.task_id, subject, done: r.kind === 'task.completed' || (prev?.done ?? false) })
    }
    // A bare column next to MAX() takes its value from the row that holds the maximum (SQLite § bare columns).
    const files = this.db
      .prepare('SELECT path, tool, MAX(changed_at) AS at FROM files WHERE session_id = ? GROUP BY path_key ORDER BY at DESC LIMIT ?')
      .all(sessionId, DETAIL_FILES_MAX)
      .map((r) => ({ path: String(r.path), sessionId, tool: String(r.tool), changedAt: Number(r.at) }))
    const stop = this.db
      .prepare("SELECT payload FROM events WHERE session_id = ? AND kind = 'turn.stopped' AND agent_id IS NULL ORDER BY seq DESC LIMIT 1")
      .get(sessionId)
    const message = stop ? (JSON.parse(String(stop.payload)) as Record<string, unknown>).last_assistant_message : undefined
    return { session: toSession(s), timeline, tasks: [...tasks.values()], files, finalMessage: typeof message === 'string' && message.trim() ? message : null }
  }

  /** ADR-0003 retention: 30 days on disk; memory keeps only what this week and last week need. */
  prune(now: number): void {
    const cutoff = now - RETENTION_MS
    this.tx(() => {
      this.db.prepare('DELETE FROM events WHERE ts < ?').run(cutoff)
      this.db.prepare('DELETE FROM sessions WHERE last_event_at < ?').run(cutoff)
      this.db.prepare('DELETE FROM work_spans WHERE end_ts < ?').run(cutoff)
      this.db.prepare('DELETE FROM finished_turns WHERE ts < ?').run(cutoff)
      this.db.prepare('DELETE FROM files WHERE changed_at < ?').run(cutoff)
      this.db.prepare('DELETE FROM attention_items WHERE COALESCE(resolved_at, opened_at) < ?').run(cutoff)
      this.db.prepare('DELETE FROM approvals WHERE ts < ?').run(cutoff)
      this.db.prepare('DELETE FROM usage WHERE day < ?').run(dayKey(cutoff))
      this.work.prune(now)
      this.usageLog.prune(now)
    })
    this.attention = { ...this.attention, open: this.attention.open.filter((i) => i.openedAt >= cutoff) }
    const since = lastWeekStart(now)
    this.spans = this.spans.filter((x) => x.end >= since)
    this.finished = this.finished.filter((t) => t >= since)
    this.files = this.files.filter((f) => f.changedAt >= since)
    for (const [id, s] of this.sessions) if (s.lastEventAt < cutoff) this.sessions.delete(id)
    for (const [t, at] of this.agentTypes) if (at < now - 7 * DAY_MS) this.agentTypes.delete(t)
    for (const [k, u] of this.usage) if (u.day < dayKey(cutoff)) this.usage.delete(k)
    if (this.usage.size === 0) this.usageAt = null
  }
}
