// The promise of the ADR-0009 amendment, as a test: a transcript full of content goes in; counts come out, and nothing
// else is stored, logged, sent to main (the snapshot and the change/error callbacks) or left in the database file.
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Snapshot } from '@shared/snapshot'
import { startCollector, type Collector } from './app'
import { SENTINELS, assistant, lines, projects, toolResultLine, userLine } from './usage-log.fixtures'

const TOKEN = 'e'.repeat(64)
const dirs: string[] = []
const collectors: Collector[] = []
const minutesAgo = (m: number): number => Date.now() - m * 60_000

afterEach(async () => {
  vi.restoreAllMocks()
  for (const c of collectors.splice(0)) await c.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function waitFor(ok: () => boolean, ms = 8_000): Promise<void> {
  const until = Date.now() + ms
  while (!ok()) {
    if (Date.now() > until) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 25))
  }
}

function setup(text: string, options: { readLogs?: boolean } = {}) {
  const { root, parent } = projects({ 'p1/session.jsonl': text })
  const data = mkdtempSync(join(tmpdir(), 'agentdeck-priv-'))
  dirs.push(parent, data)
  const db = join(data, 'agentdeck.db')
  const onChange = vi.fn()
  const onError = vi.fn()
  const written: string[] = []
  // Everything this process prints, console or raw stream.
  for (const k of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, k).mockImplementation((...a: unknown[]) => void written.push(a.map(String).join(' ')))
  vi.spyOn(process.stdout, 'write').mockImplementation((c: string | Uint8Array) => (written.push(String(c)), true))
  vi.spyOn(process.stderr, 'write').mockImplementation((c: string | Uint8Array) => (written.push(String(c)), true))
  const start = async (readLogs: boolean | undefined = options.readLogs): Promise<Collector> => {
    const c = await startCollector({ dbPath: db, token: TOKEN, ports: [0], agentsDir: null, claude: false, readLogs, usageLogRoots: [root], onChange, onError })
    collectors.push(c)
    return c
  }
  return { root, db, onChange, onError, written, start }
}

const transcript = (): string =>
  lines(
    userLine(),
    assistant({ id: 'm1', ts: minutesAgo(5), input: 11, output: 22, cacheRead: 100 }),
    toolResultLine(),
    assistant({ id: 'm1', ts: minutesAgo(5), input: 11, output: 22, cacheRead: 100 }),
    assistant({ id: 'm2', ts: minutesAgo(4), input: 1, output: 2, cacheRead: 3, sidechain: true })
  )

const sentinelsIn = (text: string): string[] => SENTINELS.filter((s) => text.includes(s))

function dbText(file: string): string {
  return [file, `${file}-wal`, `${file}-shm`].filter(existsSync).map((f) => readFileSync(f).toString('latin1')).join('\n')
}

describe('privacy of the log reader', () => {
  it('stores, logs and sends nothing but counts: no sentinel from a transcript full of content survives', async () => {
    const t = setup(transcript())
    const c = await t.start(true)
    await waitFor(() => (c.snapshot().usage?.weekTokens ?? 0) > 0 && c.snapshot().usage?.logs?.scan === null)
    const usage = c.snapshot().usage!
    expect(usage).toMatchObject({ source: 'logs', weekTokens: 11 + 22 + 100 + 1 + 2 + 3 })

    // 1. over the snapshot, the only thing main and the window ever receive
    const snapshot = JSON.stringify(c.snapshot())
    expect(sentinelsIn(snapshot)).toEqual([])
    expect(Snapshot.safeParse(c.snapshot()).success).toBe(true)
    // 2. the callbacks (they carry no body, and errors carry no content)
    expect(sentinelsIn(JSON.stringify([t.onChange.mock.calls, t.onError.mock.calls]))).toEqual([])
    expect(t.onError).not.toHaveBeenCalled()
    // 3. anything printed
    expect(sentinelsIn(t.written.join('\n'))).toEqual([])
    // 4. the database, row by row and byte by byte (WAL included, after the close checkpoints it)
    await c.close()
    collectors.length = 0
    const db = new DatabaseSync(t.db)
    const rows = JSON.stringify([db.prepare('SELECT * FROM usage_log').all(), db.prepare('SELECT * FROM usage_log_files').all(), db.prepare('SELECT * FROM events').all()])
    db.close()
    expect(sentinelsIn(rows)).toEqual([])
    expect(sentinelsIn(dbText(t.db))).toEqual([])
  })

  it('keeps only identifiers, numbers and a model name in a row', async () => {
    const t = setup(transcript())
    const c = await t.start(true)
    await waitFor(() => (c.snapshot().usage?.weekTokens ?? 0) > 0 && c.snapshot().usage?.logs?.scan === null)
    await c.close()
    collectors.length = 0
    const db = new DatabaseSync(t.db)
    const rows = db.prepare('SELECT * FROM usage_log ORDER BY key').all()
    db.close()
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(['cache_read', 'cache_write', 'cache_write_1h', 'input', 'key', 'model', 'odd', 'output', 'ts'])
      expect(String(r.key)).toMatch(/^m\d:req_m\d$/)
      expect(String(r.model)).toBe('claude-sonnet-5-5')
    }
  })

  it('reads nothing while the setting is off (the default): no file is opened, no row is written', async () => {
    const t = setup(transcript())
    const c = await t.start(undefined)
    await new Promise((r) => setTimeout(r, 400))
    expect(c.snapshot().usage).toBeNull()
    await c.close()
    collectors.length = 0
    const db = new DatabaseSync(t.db)
    expect(db.prepare('SELECT COUNT(*) AS n FROM usage_log').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM usage_log_files').get()).toEqual({ n: 0 })
    db.close()
  })

  it('starts and stops with the switch, and its figures are not mixed with the OTel ones', async () => {
    const t = setup(transcript())
    const c = await t.start(false)
    expect(c.snapshot().usage).toBeNull()
    c.setReadLogs(true)
    await waitFor(() => (c.snapshot().usage?.weekTokens ?? 0) > 0)
    expect(c.snapshot().usage?.source).toBe('logs')
    c.setReadLogs(false)
    expect(c.snapshot().usage).toBeNull() // no OTel figures were ever received: nothing to fall back to, and no logs
    appendFileSync(join(t.root, 'p1/session.jsonl'), lines(assistant({ id: 'm9', ts: minutesAgo(1) })))
    await new Promise((r) => setTimeout(r, 600))
    expect(c.snapshot().usage).toBeNull()
  })

  it('follows a running session in real time, with no restart', async () => {
    const t = setup(transcript())
    const c = await t.start(true)
    await waitFor(() => (c.snapshot().usage?.weekTokens ?? 0) > 0 && c.snapshot().usage?.logs?.scan === null)
    const before = c.snapshot().usage!.weekTokens
    appendFileSync(join(t.root, 'p1/session.jsonl'), lines(assistant({ id: 'live', ts: minutesAgo(0), input: 7, output: 7, cacheRead: 7 })))
    await waitFor(() => (c.snapshot().usage?.weekTokens ?? 0) === before + 21)
    expect(c.snapshot().usage?.block?.tokens).toBeGreaterThanOrEqual(21)
  })
})
