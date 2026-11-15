// ADR-0009 amendment: with the opt-in `usage.readLogs`, token counts are read from Claude Code's local session logs
// (<config dir>/projects/**/*.jsonl). What leaves a line is a timestamp, a model name, four counts, two opaque ids and a
// billing flag: `parseLogLine` builds its result from those fields only, so a prompt, a reply, a tool input or output or
// a file's contents cannot be kept, stored, logged or sent, whatever the line holds. Nothing here imports electron.
import { createHash } from 'node:crypto'
import { existsSync, realpathSync, watch, type FSWatcher } from 'node:fs'
import { open, readdir, stat, type FileHandle } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { LOG_WINDOW_MS, type FileState, type NewRec, type UsageLogStore } from './usage-log-store'

const CHUNK_BYTES = 256 * 1024
/** A line longer than this (a pasted binary, say) is skipped unread. The longest line on the author's machine is 2.3 MB. */
const MAX_LINE_BYTES = 16 * 1024 * 1024
/** Work longer than this without yielding would delay a hook's reply (budget: p95 < 20 ms), so the scan lets the loop run. */
const SLICE_MS = 8
const HEAD_BYTES = 1024
/** Where a file stands is saved at least this often even when its lines held nothing countable; fewer commits, fewer WAL checkpoints. */
const SAVE_EVERY_BYTES = 8 * 1024 * 1024
const NEWLINE = 0x0a
const MODEL_MAX = 64
const POLL_MS = 30_000
const DEBOUNCE_MS = 300

type Json = Record<string, unknown>
const obj = (v: unknown): Json | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : null)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
/** A count: a whole, non-negative, finite number; anything else is 0. */
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0)

/**
 * One log line → the counts of one assistant message, or null (not an assistant message with usage, not JSON, no time).
 * `at` names the line (`<file>#<byte offset>`): it keys the rare row that carries no message id.
 */
export function parseLogLine(line: string, at: string): NewRec | null {
  if (!line.includes('"usage"')) return null // cheap test first: most lines are tool output and prompts
  let row: Json | null
  try {
    row = obj(JSON.parse(line))
  } catch {
    return null
  }
  const message = obj(row?.message)
  const usage = obj(message?.usage)
  if (!row || !message || !usage || row.type !== 'assistant') return null
  const model = str(message.model)
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .trim()
    .slice(0, MODEL_MAX)
  const ts = Date.parse(str(row.timestamp))
  if (!model || model === '<synthetic>' || !Number.isFinite(ts)) return null
  const rec = {
    input: count(usage.input_tokens),
    output: count(usage.output_tokens),
    cacheRead: count(usage.cache_read_input_tokens),
    cacheWrite: count(usage.cache_creation_input_tokens),
    cacheWrite1h: count(obj(usage.cache_creation)?.ephemeral_1h_input_tokens)
  }
  if (rec.input + rec.output + rec.cacheRead + rec.cacheWrite === 0) return null
  const id = str(message.id)
  const request = str(row.requestId)
  // The speed, region and tier a request ran with change its price (docs: fast mode, data residency); only the standard one is priced.
  const odd = [
    [usage.speed, ['standard']],
    [usage.inference_geo, ['global', '']],
    [usage.service_tier, ['standard']]
  ].some(([v, ok]) => typeof v === 'string' && !(ok as string[]).includes(v))
  return { key: id && request ? `${id}:${request}` : at, ts, model, ...rec, cacheWrite1h: Math.min(rec.cacheWrite1h, rec.cacheWrite), odd }
}

const nextTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
const headOf = (b: Buffer): string => createHash('sha1').update(b).digest('hex').slice(0, 16)

export interface ScanOptions {
  /** Set when the collector is closing or the setting went off: the scan stops at the next chunk. */
  stopped(): boolean
  now(): number
}

/**
 * Reads what is new in one log file and commits it with the new read position. A file that was replaced (a different start)
 * or cut short is read again from the top: rows already counted are left alone, so that is harmless. Returns whether a
 * figure changed. Never holds the event loop longer than SLICE_MS plus one line; the reads themselves are asynchronous.
 */
export async function scanFile(path: string, store: UsageLogStore, o: ScanOptions): Promise<boolean> {
  let file: FileHandle
  try {
    file = await open(path, 'r')
  } catch {
    return false // it went away between the walk and now
  }
  try {
    const st = await file.stat()
    const headBuf = Buffer.alloc(Math.min(HEAD_BYTES, st.size))
    await file.read(headBuf, 0, headBuf.length, 0)
    const head = headOf(headBuf)
    const prev = store.state(path)
    if (prev && prev.head === head && prev.size === st.size && prev.mtime === st.mtimeMs) return false
    const resume = prev && prev.head === head && st.size >= prev.offset ? prev.offset : 0

    const buf = Buffer.allocUnsafe(CHUNK_BYTES)
    let changed = false
    let pos = resume // next byte to read
    let committed = resume // just after the last complete line
    let lineStart = resume
    let carry: Buffer[] = [] // the front of a line that continues in the next chunk
    let carried = 0
    let skipping = false
    let batch: NewRec[] = []
    let saved = resume
    let sliceStart = performance.now()
    const commit = (force = false): void => {
      if (!force && batch.length === 0 && committed - saved < SAVE_EVERY_BYTES) return
      saved = committed
      const state: FileState = { size: st.size, mtime: st.mtimeMs, offset: committed, head }
      changed = store.commit(path, state, batch, o.now()) || changed
      batch = []
    }

    while (pos < st.size && !o.stopped()) {
      const { bytesRead } = await file.read(buf, 0, Math.min(CHUNK_BYTES, st.size - pos), pos)
      if (bytesRead === 0) break
      const chunk = buf.subarray(0, bytesRead)
      const base = pos
      pos += bytesRead
      let from = 0
      while (from < bytesRead) {
        const nl = chunk.indexOf(NEWLINE, from)
        if (nl < 0) {
          if (!skipping) {
            carry.push(Buffer.from(chunk.subarray(from))) // a copy: `buf` is reused
            carried += bytesRead - from
            if (carried > MAX_LINE_BYTES) {
              skipping = true
              carry = []
              carried = 0
            }
          }
          break
        }
        if (skipping) skipping = false
        else {
          const line = carry.length ? Buffer.concat([...carry, chunk.subarray(from, nl)]) : chunk.subarray(from, nl)
          carry = []
          carried = 0
          if (line.includes('"usage"')) {
            const rec = parseLogLine(line.toString('utf8'), `${path}#${lineStart}`)
            if (rec) batch.push(rec)
          }
        }
        from = nl + 1
        committed = base + from
        lineStart = committed
        if (performance.now() - sliceStart > SLICE_MS) {
          commit()
          await nextTurn()
          sliceStart = performance.now()
        }
      }
      commit()
      await nextTurn()
      sliceStart = performance.now()
    }
    if (!o.stopped()) commit(true)
    return changed
  } finally {
    await file.close()
  }
}

/** The folders Claude Code keeps its logs in: CLAUDE_CONFIG_DIR, `~/.claude`, `~/.config/claude`; each only if it has `projects`. */
export function logRoots(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string[] {
  const found = new Map<string, string>()
  for (const dir of [env.CLAUDE_CONFIG_DIR, join(home, '.claude'), join(home, '.config', 'claude')]) {
    if (!dir) continue
    const projects = join(dir, 'projects')
    if (!existsSync(projects)) continue
    let real = projects
    try {
      real = realpathSync(projects)
    } catch {
      // keep the path as given
    }
    found.set(real.toLowerCase(), projects)
  }
  return [...found.values()]
}

interface Listed {
  path: string
  size: number
  mtime: number
}

/** Every `.jsonl` under `dir`. Yields to the loop between folders, so a thousand-file tree never blocks it. */
async function list(dir: string, out: Listed[] = []): Promise<Listed[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const path = join(dir, e.name)
    if (e.isDirectory()) await list(path, out)
    else if (e.isFile() && e.name.endsWith('.jsonl')) {
      try {
        const s = await stat(path)
        out.push({ path, size: s.size, mtime: s.mtimeMs })
      } catch {
        // gone already
      }
    }
  }
  await nextTurn()
  return out
}

export interface WatcherOptions {
  /** The `projects` folders (see logRoots). */
  roots: readonly string[]
  store: UsageLogStore
  /** A figure changed, or the scan moved on. */
  onChange(): void
  onError(err: unknown): void
  now?: () => number
  pollMs?: number
  debounceMs?: number
  /** Whether to follow with fs.watch; a test can leave it to the poll. */
  watch?: boolean
}

export interface WatcherStatus {
  /** The first pass over the recent files is still running. */
  scanning: boolean
  done: number
  total: number
  /** Log files read so far. */
  files: number
  /** When a figure last changed (wall clock), or null. */
  lastAt: number | null
}

/**
 * Reads the recent logs once (files touched in the last 8 days), then follows them: fs.watch for the moment a line is
 * written, and a 30 s poll in case a watch event is missed. One file is read at a time, off the hook path.
 */
export class UsageLogWatcher {
  private readonly now: () => number
  private readonly watchers: FSWatcher[] = []
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly queue = new Set<string>()
  private poller: NodeJS.Timeout | null = null
  private stopped = true
  private busy = false
  private scanning = false
  private done = 0
  private total = 0

  constructor(private readonly o: WatcherOptions) {
    this.now = o.now ?? Date.now
  }

  status(): WatcherStatus {
    return { scanning: this.scanning, done: this.done, total: this.total, files: this.o.store.fileCount(), lastAt: this.o.store.lastAt }
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.scanning = true
    this.done = 0
    this.total = 0
    void this.first().catch((err: unknown) => this.o.onError(err))
  }

  stop(): void {
    this.stopped = true
    this.scanning = false
    this.queue.clear()
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
    for (const w of this.watchers.splice(0)) w.close()
    if (this.poller) clearInterval(this.poller)
    this.poller = null
  }

  /** Resolves when nothing is being read and nothing waits (for tests). */
  async idle(): Promise<void> {
    while (this.scanning || this.busy || this.queue.size > 0 || this.timers.size > 0) await new Promise((r) => setTimeout(r, 5))
  }

  private async first(): Promise<void> {
    const listed = (await Promise.all(this.o.roots.map((r) => list(r)))).flat()
    if (this.stopped) return
    const recent = listed.filter((f) => f.mtime >= this.now() - LOG_WINDOW_MS || this.o.store.state(f.path))
    this.total = recent.length
    this.o.onChange()
    for (const f of recent) {
      if (this.stopped) return
      await this.read(f.path)
      this.done++
      this.o.onChange()
    }
    this.scanning = false
    this.follow()
    this.o.onChange()
  }

  private follow(): void {
    if (this.stopped) return
    if (this.o.watch !== false) {
      for (const root of this.o.roots) {
        try {
          const w = watch(root, { recursive: true }, (_event, name) => {
            if (name && name.toString().endsWith('.jsonl')) this.schedule(join(root, name.toString()))
          })
          w.on('error', () => w.close()) // the poll still covers it
          this.watchers.push(w)
        } catch {
          // no recursive watch here: the poll covers it
        }
      }
    }
    this.poller = setInterval(() => void this.poll().catch((err: unknown) => this.o.onError(err)), this.o.pollMs ?? POLL_MS)
  }

  private schedule(path: string): void {
    if (this.stopped || this.timers.has(path)) return
    this.timers.set(
      path,
      setTimeout(() => {
        this.timers.delete(path)
        this.queue.add(path)
        void this.drain()
      }, this.o.debounceMs ?? DEBOUNCE_MS)
    )
  }

  /** Looks for files that are new or have grown since they were last read. */
  private async poll(): Promise<void> {
    const listed = (await Promise.all(this.o.roots.map((r) => list(r)))).flat()
    for (const f of listed) {
      const s = this.o.store.state(f.path)
      if (s ? s.size !== f.size || s.mtime !== f.mtime : f.mtime >= this.now() - LOG_WINDOW_MS) this.queue.add(f.path)
    }
    void this.drain()
  }

  private async drain(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      for (const path of this.queue) {
        this.queue.delete(path)
        if (this.stopped) return
        await this.read(path)
      }
    } finally {
      this.busy = false
    }
  }

  private async read(path: string): Promise<void> {
    try {
      if (await scanFile(path, this.o.store, { stopped: () => this.stopped, now: this.now })) this.o.onChange()
    } catch (err) {
      this.o.onError(err) // one unreadable file must not stop the rest
    }
  }
}
