import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Snapshot } from '@shared/snapshot'
import { DEFAULT_WEEKLY_BUDGET_USD } from '@shared/work'
import { startCollector, type Collector } from './app'
import { RETENTION_MS, Store } from './store'
import { parseUsage } from './usage'

const EXTRAS = { awaySince: null, awayUntil: null, agentDefinitionCount: 0 }
// Friday 13 Nov 2026, noon local time: the week began on Monday the 9th (D-008).
const NOW = new Date(2026, 10, 13, 12).getTime()
const DAY = 86_400_000
const body = (n: number): string => readFileSync(join(__dirname, '../../test/fixtures/otel/2.1.318', `metrics-${n}.json`), 'utf8')

const dirs: string[] = []
const stores: Store[] = []
const collectors: Collector[] = []
function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentdeck-usage-'))
  dirs.push(dir)
  return join(dir, 'agentdeck.db')
}
function open(file: string, now = NOW): Store {
  const s = new Store(file, now)
  stores.push(s)
  return s
}
afterEach(async () => {
  for (const s of stores.splice(0)) s.close()
  for (const c of collectors.splice(0)) await c.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const points = (cost: number, input: number) => [
  { model: 'claude-opus-5', type: 'cost' as const, value: cost },
  { model: 'claude-opus-5', type: 'input' as const, value: input },
  { model: 'claude-opus-5', type: 'cacheRead' as const, value: input * 10 }
]

describe('usage in the Store (migration 5)', () => {
  it('has no usage until Claude Code reports once: null, never a made-up zero', () => {
    const store = open(':memory:')
    expect(store.snapshot(NOW, EXTRAS).usage).toBeNull()
    expect(store.lastUsageAt()).toBeNull()
  })

  it('keeps day, model, type and a number: no session and no account column', () => {
    const file = tempDb()
    open(file).close()
    stores.length = 0 // closed already
    const db = new DatabaseSync(file)
    expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: expect.any(Number) })
    expect((db.prepare("SELECT name FROM pragma_table_info('usage') ORDER BY cid").all() as { name: string }[]).map((c) => c.name)).toEqual(['day', 'model', 'type', 'value', 'updated_at'])
    db.close()
  })

  it('adds deltas up, and the snapshot satisfies the shared contract', () => {
    const store = open(':memory:')
    expect(store.ingestUsage(points(0.5, 100), NOW)).toBe(true)
    expect(store.ingestUsage(points(0.25, 50), NOW + 10_000)).toBe(true)
    const snap = store.snapshot(NOW + 20_000, EXTRAS)
    expect(Snapshot.safeParse(snap).success).toBe(true)
    expect(snap.usage).toEqual({ todayTokens: 1650, weekTokens: 1650, todayCostUsd: 0.75, weekCostUsd: 0.75, weeklyBudgetUsd: DEFAULT_WEEKLY_BUDGET_USD })
    expect(store.lastUsageAt()).toBe(NOW + 10_000)
  })

  it('splits today from the week (Monday 00:00 local) and leaves last week out', () => {
    const store = open(':memory:')
    store.ingestUsage(points(9, 1000), NOW - 6 * DAY) // Saturday 7 Nov: last week
    store.ingestUsage(points(2, 10), NOW - 4 * DAY) // Monday 9 Nov
    store.ingestUsage(points(1, 5), NOW) // today
    expect(store.snapshot(NOW, EXTRAS).usage).toEqual({
      todayTokens: 55,
      weekTokens: 165,
      todayCostUsd: 1,
      weekCostUsd: 3,
      weeklyBudgetUsd: DEFAULT_WEEKLY_BUDGET_USD
    })
  })

  it('carries the budget Settings set', () => {
    const store = open(':memory:')
    store.ingestUsage(points(1, 1), NOW)
    expect(store.snapshot(NOW, { ...EXTRAS, weeklyBudgetUsd: 125 }).usage?.weeklyBudgetUsd).toBe(125)
  })

  it('survives a restart', () => {
    const file = tempDb()
    const first = open(file)
    first.ingestUsage(points(2, 10), NOW)
    const before = first.snapshot(NOW, EXTRAS).usage
    first.close()
    stores.length = 0
    const again = open(file)
    expect(again.snapshot(NOW, EXTRAS).usage).toEqual(before)
    expect(again.lastUsageAt()).toBe(NOW)
  })

  it('prunes after 30 days with the rest of the data', () => {
    const file = tempDb()
    const store = open(file)
    store.ingestUsage(points(5, 100), NOW - RETENTION_MS - 2 * DAY)
    store.ingestUsage(points(1, 1), NOW)
    store.prune(NOW)
    const db = new DatabaseSync(file)
    expect(db.prepare('SELECT COUNT(DISTINCT day) AS n FROM usage').get()).toEqual({ n: 1 })
    db.close()
    const old = open(tempDb())
    old.ingestUsage(points(5, 100), NOW - RETENTION_MS - 2 * DAY)
    old.prune(NOW)
    expect(old.snapshot(NOW, EXTRAS).usage).toBeNull()
  })

  it('stores what the real Claude Code body says', () => {
    const store = open(':memory:')
    store.ingestUsage(parseUsage(body(11)), NOW)
    expect(store.snapshot(NOW, EXTRAS).usage).toMatchObject({ todayTokens: 2 + 181 + 34_834 + 4_763, todayCostUsd: 0.00139164 })
  })
})

describe('the OTLP receiver (ADR-0007)', () => {
  const TOKEN = 'c'.repeat(64)
  const onError = vi.fn()
  async function start(): Promise<Collector> {
    const c = await startCollector({ dbPath: ':memory:', token: TOKEN, ports: [0], agentsDir: null, claude: false, onChange: vi.fn(), onError })
    collectors.push(c)
    return c
  }
  function send(c: Collector, path: string, payload: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: c.port, method: 'POST', path, headers: { 'x-agentdeck-token': TOKEN, 'content-type': 'application/json', ...headers } }, (res) => {
        let data = ''
        res.on('data', (d: Buffer) => (data += d))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
      })
      req.on('error', reject)
      req.end(payload)
    })
  }

  it('answers 200 and shows the figures in the next snapshot', async () => {
    const c = await start()
    expect(c.snapshot().usage).toBeNull()
    const r = await send(c, '/v1/metrics', body(11))
    expect(r.status).toBe(200)
    expect(JSON.parse(r.body)).toEqual({})
    expect(c.snapshot().usage).toMatchObject({ todayTokens: 39_780, todayCostUsd: 0.00139164, weeklyBudgetUsd: DEFAULT_WEEKLY_BUDGET_USD })
    expect(c.lastUsageAt()).not.toBeNull()
  })

  it('takes JSON with a charset, and nothing else: protobuf and compressed bodies answer 415', async () => {
    const c = await start()
    expect((await send(c, '/v1/metrics', body(11), { 'content-type': 'application/json; charset=utf-8' })).status).toBe(200)
    expect((await send(c, '/v1/metrics', 'x', { 'content-type': 'application/x-protobuf' })).status).toBe(415)
    expect((await send(c, '/v1/metrics', 'x', { 'content-encoding': 'gzip' })).status).toBe(415)
  })

  it('keeps the token, Host and Origin rules of every route (ADR-0010)', async () => {
    const c = await start()
    expect((await send(c, '/v1/metrics', body(11), { 'x-agentdeck-token': 'd'.repeat(64) })).status).toBe(401)
    expect((await send(c, '/v1/metrics', body(11), { origin: 'https://evil.example' })).status).toBe(403)
    expect((await send(c, '/v1/metrics', body(11), { host: 'localhost' })).status).toBe(403)
    expect(c.snapshot().usage).toBeNull()
  })

  it('asks for no logs and takes none: /v1/logs is not there, so a prompt has no way in', async () => {
    const c = await start()
    expect((await send(c, '/v1/logs', '{"resourceLogs":[]}')).status).toBe(404)
    expect((await send(c, '/v1/traces', '{}')).status).toBe(404)
  })

  it('reports a body that is not JSON, stores nothing, and carries on', async () => {
    const c = await start()
    onError.mockClear()
    expect((await send(c, '/v1/metrics', 'not json')).status).toBe(200)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(c.snapshot().usage).toBeNull()
    expect((await send(c, '/v1/metrics', body(11))).status).toBe(200)
    expect(c.snapshot().usage).not.toBeNull()
  })

  it('takes a positive budget within the limit and ignores anything else', async () => {
    const c = await start()
    await send(c, '/v1/metrics', body(11))
    c.setUsageBudget(75)
    expect(c.snapshot().usage?.weeklyBudgetUsd).toBe(75)
    for (const bad of [0, -3, Number.NaN, Infinity, 1e9]) c.setUsageBudget(bad)
    expect(c.snapshot().usage?.weeklyBudgetUsd).toBe(75)
  })

  it('starts from the budget it was given', async () => {
    const c = await startCollector({ dbPath: ':memory:', token: TOKEN, ports: [0], agentsDir: null, claude: false, weeklyBudgetUsd: 60, onChange: vi.fn(), onError })
    collectors.push(c)
    await send(c, '/v1/metrics', body(11))
    expect(c.snapshot().usage?.weeklyBudgetUsd).toBe(60)
  })
})
