// Per-message token counts read from Claude Code's local logs (ADR-0009 amendment), kept apart from the OTel `usage`
// table (migration 5) so the two sources can never be added together. No electron import: unit-testable.
import type { DatabaseSync } from 'node:sqlite'
import { costOf } from './usage-price'

/** Rows older than this are not kept when read: the card shows today, this week and the 5-hour block, so nothing older is shown. */
export const LOG_WINDOW_MS = 8 * 86_400_000
/** ADR-0003: the same 30 days every other table keeps. */
export const LOG_RETENTION_MS = 30 * 86_400_000

/** What is kept of one assistant message: when, which model, the counts, and the key that makes it count once. Nothing else. */
export interface LogRec {
  /** `message.id:requestId`; `file#offset` for the rare row that has no ids. Opaque identifiers, not content. */
  key: string
  ts: number
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cacheWrite1h: number
  /** Billed other than at the standard rate (fast mode, US-only inference): the tokens count, the price is not known. */
  odd: boolean
  /** API-equivalent dollars, or null when the price is not known. Derived from the price table, never stored. */
  cost: number | null
}

export type NewRec = Omit<LogRec, 'cost'>

export const withCost = (r: NewRec): LogRec => ({ ...r, cost: costOf(r.model, r, r.odd) })

/** Where reading a file stopped. `head` is a hash of its first bytes: a different one means the file was replaced. */
export interface FileState {
  size: number
  mtime: number
  /** Just after the last complete line read. */
  offset: number
  head: string
}

export class UsageLogStore {
  private readonly byKey = new Map<string, LogRec>()
  private readonly states = new Map<string, FileState>()
  /** Bumps whenever a figure changes, so the snapshot can reuse its summary until then. */
  version = 0
  /** Wall-clock time of the last figure that changed, for "last figure 12 s ago". */
  lastAt: number | null = null

  constructor(
    private readonly db: DatabaseSync,
    now: number
  ) {
    for (const r of db.prepare('SELECT key, ts, model, input, output, cache_read, cache_write, cache_write_1h, odd FROM usage_log WHERE ts >= ?').all(now - LOG_WINDOW_MS)) {
      const rec = withCost({
        key: String(r.key),
        ts: Number(r.ts),
        model: String(r.model),
        input: Number(r.input),
        output: Number(r.output),
        cacheRead: Number(r.cache_read),
        cacheWrite: Number(r.cache_write),
        cacheWrite1h: Number(r.cache_write_1h),
        odd: Number(r.odd) === 1
      })
      this.byKey.set(rec.key, rec)
    }
    for (const f of db.prepare('SELECT path, size, mtime, offset, head FROM usage_log_files').all()) {
      this.states.set(String(f.path), { size: Number(f.size), mtime: Number(f.mtime), offset: Number(f.offset), head: String(f.head) })
    }
  }

  state(path: string): FileState | undefined {
    return this.states.get(path)
  }

  /** Every file read so far. */
  fileCount(): number {
    return this.states.size
  }

  records(): IterableIterator<LogRec> {
    return this.byKey.values()
  }

  /**
   * One transaction: the rows of one chunk and where the file's reading now stands, so a crash can neither lose a chunk nor
   * count it twice (a row already there is left alone, except that a later copy of a streamed message may carry more output).
   * Returns whether any figure changed.
   */
  commit(path: string, state: FileState, recs: readonly NewRec[], now: number): boolean {
    const insert = this.db.prepare(
      `INSERT INTO usage_log (key, ts, model, input, output, cache_read, cache_write, cache_write_1h, odd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET output = excluded.output WHERE excluded.output > usage_log.output`
    )
    const fresh = new Map<string, LogRec>() // also the copies of one streamed message that sit in this very chunk
    this.db.exec('BEGIN')
    try {
      for (const r of recs) {
        const old = fresh.get(r.key) ?? this.byKey.get(r.key)
        if (old ? r.output <= old.output : r.ts < now - LOG_WINDOW_MS) continue
        insert.run(r.key, r.ts, r.model, r.input, r.output, r.cacheRead, r.cacheWrite, r.cacheWrite1h, r.odd ? 1 : 0)
        fresh.set(r.key, withCost(old ? { ...old, output: r.output } : r))
      }
      this.db
        .prepare('INSERT INTO usage_log_files (path, size, mtime, offset, head) VALUES (?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime, offset = excluded.offset, head = excluded.head')
        .run(path, state.size, state.mtime, state.offset, state.head)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    for (const [key, r] of fresh) this.byKey.set(key, r)
    this.states.set(path, state)
    if (fresh.size === 0) return false
    this.version++
    this.lastAt = now
    return true
  }

  /** A file that is gone: forget where reading stopped (its rows stay, they are still usage). */
  forget(path: string): void {
    this.db.prepare('DELETE FROM usage_log_files WHERE path = ?').run(path)
    this.states.delete(path)
  }

  /** ADR-0003 retention. Memory keeps only the display window. */
  prune(now: number): void {
    this.db.prepare('DELETE FROM usage_log WHERE ts < ?').run(now - LOG_RETENTION_MS)
    this.db.prepare('DELETE FROM usage_log_files WHERE mtime < ?').run(now - LOG_RETENTION_MS)
    let dropped = false
    for (const [k, r] of this.byKey) {
      if (r.ts < now - LOG_WINDOW_MS) {
        this.byKey.delete(k)
        dropped = true
      }
    }
    for (const [p, s] of this.states) if (s.mtime < now - LOG_RETENTION_MS) this.states.delete(p)
    if (dropped) this.version++
  }
}
