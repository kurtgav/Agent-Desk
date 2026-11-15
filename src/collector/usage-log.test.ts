import { appendFileSync, mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Store } from './store'
import { UsageLogWatcher, parseLogLine, scanFile } from './usage-log'
import { assistant, lines, projects, toolResultLine, userLine } from './usage-log.fixtures'

const NOW = Date.now()
const MIN = 60_000
const ago = (m: number): number => NOW - m * MIN

const parents: string[] = []
const stores: Store[] = []
const watchers: UsageLogWatcher[] = []
function fixture(files: Record<string, string> = {}): { root: string; parent: string } {
  const p = projects(files)
  parents.push(p.parent)
  return p
}
function open(file = ':memory:'): Store {
  const s = new Store(file, NOW)
  stores.push(s)
  return s
}
afterEach(() => {
  for (const w of watchers.splice(0)) w.stop()
  for (const s of stores.splice(0)) s.close()
  for (const p of parents.splice(0)) rmSync(p, { recursive: true, force: true })
})
const scan = (store: Store, path: string): Promise<boolean> => scanFile(path, store.usageLog, { stopped: () => false, now: () => NOW })
const recs = (store: Store) => [...store.usageLog.records()]
const total = (store: Store): number => recs(store).reduce((n, r) => n + r.input + r.output + r.cacheRead + r.cacheWrite, 0)

describe('parseLogLine', () => {
  it('keeps the time, the model, the four counts, the 1h share of the cache writes and a key: nothing else', () => {
    const r = parseLogLine(assistant({ id: 'm1', ts: ago(5), input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cache1h: 1, model: 'claude-opus-5-5' }), 'f#0')
    expect(r).toEqual({ key: 'm1:req_m1', ts: ago(5), model: 'claude-opus-5-5', input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cacheWrite1h: 1, odd: false })
    expect(Object.keys(r!).sort()).toEqual(['cacheRead', 'cacheWrite', 'cacheWrite1h', 'input', 'key', 'model', 'odd', 'output', 'ts'])
  })

  it('skips what is not an assistant message with usage', () => {
    expect(parseLogLine(userLine(), 'f#0')).toBeNull()
    expect(parseLogLine(toolResultLine(), 'f#0')).toBeNull()
    expect(parseLogLine('{"type":"assistant","message":{"usage":', 'f#0')).toBeNull() // a cut line
    expect(parseLogLine('not json "usage"', 'f#0')).toBeNull()
    expect(parseLogLine(assistant({ id: 'm', ts: ago(1), model: '<synthetic>' }), 'f#0')).toBeNull()
    expect(parseLogLine(assistant({ id: 'm', ts: ago(1), input: 0, output: 0, cacheRead: 0 }), 'f#0')).toBeNull()
    expect(parseLogLine(assistant({ id: 'm', ts: ago(1) }).replace(/"timestamp":"[^"]*"/, '"timestamp":"nope"'), 'f#0')).toBeNull()
  })

  it('keys a row without ids by where it sits, so reading it twice counts it once', () => {
    expect(parseLogLine(assistant({ id: '', req: null, ts: ago(1) }), 'file#120')?.key).toBe('file#120')
  })

  it('marks a request billed other than at the standard rate, and clamps an impossible 1h share', () => {
    expect(parseLogLine(assistant({ id: 'm', ts: ago(1), speed: 'fast' }), 'f#0')?.odd).toBe(true)
    expect(parseLogLine(assistant({ id: 'm', ts: ago(1), cacheWrite: 3, cache1h: 99 }), 'f#0')?.cacheWrite1h).toBe(3)
  })
})

describe('scanFile', () => {
  it('counts a streamed message once, however many times it was written', async () => {
    const m1 = assistant({ id: 'm1', ts: ago(5) })
    const { root } = fixture({ 'a/s.jsonl': lines(m1, userLine(), m1, toolResultLine(), m1, assistant({ id: 'm2', ts: ago(4) })) })
    const store = open()
    expect(await scan(store, join(root, 'a/s.jsonl'))).toBe(true)
    expect(recs(store)).toHaveLength(2)
  })

  it('takes the larger output of a streamed message, once', async () => {
    const { root } = fixture({ 's.jsonl': lines(assistant({ id: 'm1', ts: ago(5), output: 5 }), assistant({ id: 'm1', ts: ago(5), output: 50 }), assistant({ id: 'm1', ts: ago(5), output: 7 })) })
    const store = open()
    await scan(store, join(root, 's.jsonl'))
    expect(recs(store).map((r) => r.output)).toEqual([50])
  })

  it('counts a message copied into a resumed session’s file once', async () => {
    const m = assistant({ id: 'm1', ts: ago(5) })
    const { root } = fixture({ 'one.jsonl': lines(m), 'two.jsonl': lines(m, assistant({ id: 'm2', ts: ago(1) })) })
    const store = open()
    await scan(store, join(root, 'one.jsonl'))
    await scan(store, join(root, 'two.jsonl'))
    expect(recs(store)).toHaveLength(2)
  })

  it('counts subagent (sidechain) rows: they are separate requests, each with its own id', async () => {
    const { root } = fixture({ 's.jsonl': lines(assistant({ id: 'main', ts: ago(5) }), assistant({ id: 'sub1', ts: ago(4), sidechain: true }), assistant({ id: 'sub1', ts: ago(4), sidechain: true })) })
    const store = open()
    await scan(store, join(root, 's.jsonl'))
    expect(recs(store).map((r) => r.key.split(':')[0]).sort()).toEqual(['main', 'sub1'])
  })

  it('leaves a half-written last line for later, and counts it once when it is whole', async () => {
    const whole = assistant({ id: 'm2', ts: ago(3) })
    const { root } = fixture({ 's.jsonl': `${assistant({ id: 'm1', ts: ago(4) })}\n${whole.slice(0, 120)}` })
    const file = join(root, 's.jsonl')
    const store = open()
    await scan(store, file)
    expect(recs(store)).toHaveLength(1)
    expect(store.usageLog.state(file)!.offset).toBeLessThan(statSync(file).size)
    expect(await scan(store, file)).toBe(false) // nothing changed: not read again
    appendFileSync(file, `${whole.slice(120)}\n`)
    expect(await scan(store, file)).toBe(true)
    expect(recs(store)).toHaveLength(2)
    expect(await scan(store, file)).toBe(false)
  })

  it('reads only what was appended', async () => {
    const { root } = fixture({ 's.jsonl': lines(assistant({ id: 'm1', ts: ago(4) })) })
    const file = join(root, 's.jsonl')
    const store = open()
    await scan(store, file)
    const before = store.usageLog.state(file)!.offset
    appendFileSync(file, lines(assistant({ id: 'm2', ts: ago(3) })))
    await scan(store, file)
    expect(recs(store)).toHaveLength(2)
    expect(store.usageLog.state(file)!.offset).toBeGreaterThan(before)
  })

  it('reads a file that was cut short or replaced from the top, without counting anything twice', async () => {
    const m1 = assistant({ id: 'm1', ts: ago(5) })
    const m2 = assistant({ id: 'm2', ts: ago(4) })
    const { root } = fixture({ 's.jsonl': lines(m1, m2) })
    const file = join(root, 's.jsonl')
    const store = open()
    await scan(store, file)
    expect(recs(store)).toHaveLength(2)
    writeFileSync(file, lines(m2, assistant({ id: 'm3', ts: ago(1) }))) // shorter, starts differently
    expect(await scan(store, file)).toBe(true)
    expect(recs(store).map((r) => r.key.split(':')[0]).sort()).toEqual(['m1', 'm2', 'm3'])
  })

  it('reads a file larger than one chunk line by line, lines that straddle chunks included', async () => {
    const pad = 'x'.repeat(6_000)
    const big = Array.from({ length: 500 }, (_, i) => assistant({ id: `m${i}`, ts: ago(30) + i, input: 1, output: 1, cacheRead: 1 }).replace('"thinking":"', `"thinking":"${pad}`))
    const { root } = fixture({ 's.jsonl': lines(...big) })
    const file = join(root, 's.jsonl')
    expect(statSync(file).size).toBeGreaterThan(2_500_000) // ten chunks
    const store = open()
    await scan(store, file)
    expect(recs(store)).toHaveLength(500)
    expect(total(store)).toBe(500 * 3)
  })

  it('goes on after a multi-megabyte line, and skips one that is absurdly long without losing the lines after it', async () => {
    const huge = JSON.stringify({ type: 'user', message: { content: `${'y'.repeat(3_000_000)} "usage"` } })
    const absurd = JSON.stringify({ type: 'user', message: { content: `${'z'.repeat(17 * 1024 * 1024)} "usage"` } })
    const { root } = fixture({ 's.jsonl': lines(assistant({ id: 'a', ts: ago(5) }), huge, assistant({ id: 'b', ts: ago(4) }), absurd, assistant({ id: 'c', ts: ago(3) })) })
    const store = open()
    await scan(store, join(root, 's.jsonl'))
    expect(recs(store).map((r) => r.key.split(':')[0]).sort()).toEqual(['a', 'b', 'c'])
  })

  it('does not hold the event loop: a 40 MB log is read in slices (hook ingest budget: p95 < 20 ms)', async () => {
    const pad = 'x'.repeat(5_000)
    const rows = Array.from({ length: 8_000 }, (_, i) => assistant({ id: `m${i}`, ts: ago(60) + i }).replace('"thinking":"', `"thinking":"${pad}`))
    const { root } = fixture({ 's.jsonl': lines(...rows) })
    expect(statSync(join(root, 's.jsonl')).size).toBeGreaterThan(40_000_000)
    const store = open()
    let last = performance.now()
    let worst = 0
    const probe = setInterval(() => {
      const now = performance.now()
      worst = Math.max(worst, now - last)
      last = now
    }, 1)
    await scan(store, join(root, 's.jsonl'))
    clearInterval(probe)
    expect(recs(store)).toHaveLength(8_000)
    // The real figure is in the benchmark note (usage-log.real.test.ts); this only catches a scan that went back to blocking.
    expect(worst).toBeLessThan(150)
  }, 60_000)

  it('counts tokens for a model with no known price and gives it no cost', async () => {
    const { root } = fixture({ 's.jsonl': lines(assistant({ id: 'k', ts: ago(2), model: 'claude-sonnet-5-5' }), assistant({ id: 'u', ts: ago(2), model: 'claude-unreleased-9' })) })
    const store = open()
    await scan(store, join(root, 's.jsonl'))
    const byId = Object.fromEntries(recs(store).map((r) => [r.key.split(':')[0], r]))
    expect(byId.k!.cost).toBeGreaterThan(0)
    expect(byId.u!.cost).toBeNull()
    expect(total(store)).toBeGreaterThan(0)
  })

  it('does not count again after a restart, and picks up only what came after', async () => {
    const { root, parent } = fixture({ 's.jsonl': lines(assistant({ id: 'm1', ts: ago(5) }), assistant({ id: 'm2', ts: ago(4) })) })
    const file = join(root, 's.jsonl')
    const db = join(parent, 'agentdeck.db')
    const first = open(db)
    await scan(first, file)
    const before = total(first)
    first.close()
    stores.length = 0

    const second = open(db)
    expect(total(second)).toBe(before) // loaded from the database, not read again
    expect(await scan(second, file)).toBe(false)
    appendFileSync(file, lines(assistant({ id: 'm3', ts: ago(1) })))
    await scan(second, file)
    expect(recs(second)).toHaveLength(3)
    expect(total(second)).toBe(before + 130)
  })
})

describe('UsageLogWatcher', () => {
  const make = (roots: string[], store: Store, extra: Partial<ConstructorParameters<typeof UsageLogWatcher>[0]> = {}): UsageLogWatcher => {
    const w = new UsageLogWatcher({ roots, store: store.usageLog, onChange: () => undefined, onError: (e) => { throw e }, watch: false, pollMs: 40, now: () => NOW, ...extra })
    watchers.push(w)
    return w
  }

  it('reads the files touched in the last 8 days at first, and says how far it is', async () => {
    const { root } = fixture({ 'new.jsonl': lines(assistant({ id: 'n', ts: ago(5) })), 'old.jsonl': lines(assistant({ id: 'o', ts: ago(5) })) })
    const old = (NOW - 20 * 86_400_000) / 1000
    utimesSync(join(root, 'old.jsonl'), old, old)
    const store = open()
    const w = make([root], store)
    expect(w.status()).toMatchObject({ scanning: false, done: 0 })
    w.start()
    await w.idle()
    expect(w.status()).toMatchObject({ scanning: false, done: 1, total: 1, files: 1 })
    expect(recs(store).map((r) => r.key.split(':')[0])).toEqual(['n'])
  })

  it('finds new data and new files by itself (the 30 s poll, here every 40 ms)', async () => {
    const { root } = fixture({ 'a.jsonl': lines(assistant({ id: 'm1', ts: ago(5) })) })
    const store = open()
    const w = make([root], store)
    w.start()
    await w.idle()
    appendFileSync(join(root, 'a.jsonl'), lines(assistant({ id: 'm2', ts: ago(4) })))
    mkdirSync(join(root, 'proj2'))
    writeFileSync(join(root, 'proj2', 'b.jsonl'), lines(assistant({ id: 'm3', ts: ago(3) })))
    await waitFor(() => recs(store).length === 3)
    expect(w.status().files).toBe(2)
    expect(w.status().lastAt).not.toBeNull()
  })

  it('stops reading when stopped', async () => {
    const { root } = fixture({ 'a.jsonl': lines(assistant({ id: 'm1', ts: ago(5) })) })
    const store = open()
    const w = make([root], store)
    w.start()
    await w.idle()
    w.stop()
    appendFileSync(join(root, 'a.jsonl'), lines(assistant({ id: 'm2', ts: ago(4) })))
    await new Promise((r) => setTimeout(r, 200))
    expect(recs(store)).toHaveLength(1)
  })
})

async function waitFor(ok: () => boolean, ms = 5_000): Promise<void> {
  const until = Date.now() + ms
  while (!ok()) {
    if (Date.now() > until) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 20))
  }
}
