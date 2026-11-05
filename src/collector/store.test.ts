import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { Snapshot } from '@shared/snapshot'
import { s1Deliveries } from './fixtures'
import { normalizeHook } from './normalize'
import { DEDUPE_MS, RETENTION_MS, Store, weekStart } from './store'

const EXTRAS = { awaySince: null, awayUntil: null, agentDefinitionCount: 3 }
const dirs: string[] = []
const stores: Store[] = []

function open(file: string, now?: number): Store {
  const s = new Store(file, now)
  stores.push(s)
  return s
}
function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentdeck-store-'))
  dirs.push(dir)
  return join(dir, 'agentdeck.db')
}

afterEach(() => {
  for (const s of stores.splice(0)) s.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const s1 = () => s1Deliveries().map((d) => normalizeHook(d.raw, d.ts)!)
const lastTs = () => Math.max(...s1Deliveries().map((d) => d.ts))

describe('Store', () => {
  it('serves a snapshot that satisfies the shared contract', () => {
    const store = open(':memory:')
    store.ingest(s1())
    const snap = store.snapshot(lastTs(), EXTRAS)
    expect(() => Snapshot.parse(snap)).not.toThrow()
    expect(snap).toMatchObject({ mode: 'live', attention: [], usage: null, agentDefinitionCount: 3 })
    expect(snap.files.map((f) => f.path.split('\\').pop())).toEqual(['hello.txt'])
    expect(snap.week.finishedTurns).toHaveLength(6)
    expect(snap.recentAgentTypes).toEqual(['Explore']) // not the main thread's settings `agent` type
  })

  it('stores a repeated delivery once (test 7)', () => {
    const store = open(':memory:')
    for (const d of s1Deliveries()) {
      expect(store.ingest([normalizeHook(d.raw, d.ts)!])).toBe(true)
      expect(store.ingest([normalizeHook(d.raw, d.ts + 50)!])).toBe(false) // the same bytes again, 50 ms later
    }
    expect(store.snapshot(lastTs(), EXTRAS).week.finishedTurns).toHaveLength(6)
  })

  it('keeps a real repeat: the same permission asked again after the window (D-056)', () => {
    const store = open(':memory:')
    const ask = s1Deliveries().find((d) => d.name === 'PermissionRequest-1')!
    store.ingest([normalizeHook(ask.raw, ask.ts)!])
    const sid = JSON.parse(ask.raw).session_id as string
    const status = (t: number) => store.snapshot(t, EXTRAS).sessions.find((s) => s.id === sid)!.status
    expect(status(ask.ts)).toBe('needs_you')
    // Answered (any later event of that agent), then asked again with byte-identical bytes.
    store.ingest([normalizeHook(JSON.stringify({ ...JSON.parse(ask.raw), hook_event_name: 'PostToolUse', tool_use_id: 'x' }), ask.ts + 1_000)!])
    expect(status(ask.ts + 1_000)).toBe('working')
    expect(store.ingest([normalizeHook(ask.raw, ask.ts + 1_000 + DEDUPE_MS)!])).toBe(true)
    expect(status(ask.ts + 1_000 + DEDUPE_MS)).toBe('needs_you')
  })

  it('keeps sessions, spans, turns and files across a restart', () => {
    const file = tempDb()
    const first = open(file)
    first.ingest(s1())
    const before = first.snapshot(lastTs(), EXTRAS)
    first.close()
    stores.pop()
    const reopened = open(file, lastTs()).snapshot(lastTs(), EXTRAS)
    expect(reopened).toEqual(before)
  })

  it('splits agent time into this week and last week, and counts an open stretch up to now', () => {
    const store = open(':memory:')
    const monday = weekStart(Date.UTC(2026, 10, 5, 12))
    const hook = (kind: string, ts: number, body: Record<string, unknown> = {}) =>
      normalizeHook(JSON.stringify({ session_id: 'a', hook_event_name: kind, cwd: 'D:\\p', ...body, _t: ts }), ts)!
    store.ingest([
      hook('UserPromptSubmit', monday - 60_000, { prompt: 'x' }), // 1 min before the week starts
      hook('Stop', monday + 120_000, { stop_hook_active: false }), // ends 2 min into it
      hook('UserPromptSubmit', monday + 600_000, { prompt: 'y' }) // still working
    ])
    const snap = store.snapshot(monday + 900_000, EXTRAS)
    expect(snap.week.agentTimeLastWeekMs).toBe(60_000)
    expect(snap.week.agentTimeMs).toBe(120_000 + 300_000)
    expect(snap.week.finishedTurns).toEqual([monday + 120_000])
  })

  it('prunes rows past retention, on disk and in memory', () => {
    const file = tempDb()
    const store = open(file)
    store.ingest(s1())
    const db = new DatabaseSync(file)
    const count = (table: string) => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n)
    const tables = ['events', 'sessions', 'work_spans', 'finished_turns', 'files']
    for (const t of tables) expect(count(t), t).toBeGreaterThan(0)
    const later = lastTs() + RETENTION_MS + 1
    store.prune(later)
    for (const t of tables) expect(count(t), t).toBe(0)
    db.close()
    // Memory too: the same instance, asked about the time the rows were made, has nothing left.
    const snap = store.snapshot(lastTs(), EXTRAS)
    expect([snap.sessions, snap.files, snap.week.finishedTurns, snap.week.agentTimeMs]).toEqual([[], [], [], 0])
  })

  it('ends a working stretch at its last event across a restart, not at the next launch (D-057)', () => {
    const file = tempDb()
    const first = open(file)
    const t0 = Date.UTC(2026, 10, 5, 12)
    const body = (kind: string, extra: Record<string, unknown> = {}) => JSON.stringify({ session_id: 'w', hook_event_name: kind, cwd: 'D:\\p', ...extra })
    first.ingest([normalizeHook(body('UserPromptSubmit', { prompt: 'go' }), t0)!, normalizeHook(body('PreToolUse', { tool_name: 'Bash', tool_use_id: 'b', tool_input: { command: 'npm test' } }), t0 + 60_000)!])
    first.close()
    stores.pop()
    const reopened = open(file, t0 + 3_600_000) // an hour later
    const snap = reopened.snapshot(t0 + 3_600_000, EXTRAS)
    expect(snap.sessions[0]).toMatchObject({ id: 'w', status: 'idle', activity: 'Idle' })
    expect(snap.week.agentTimeMs).toBe(60_000) // the minute it was seen working, not the hour AgentDeck was closed
    expect(reopened.liveIds()).toEqual(['w'])
  })

  it('applies a poll the hook window held back once the window has passed (D-058)', () => {
    const store = open(':memory:')
    const t0 = Date.UTC(2026, 10, 5, 12)
    store.ingest([normalizeHook(JSON.stringify({ session_id: 'esc', hook_event_name: 'UserPromptSubmit', cwd: 'D:\\p', prompt: 'go' }), t0)!])
    // Esc 2 s in: no Stop hook. The poll at 3.3 s sees idle, inside the window, so it waits.
    const idle = { id: 'p1', ts: t0 + 3_300, source: 'poll' as const, sessionId: 'esc', agentId: null, parentAgentId: null, agentType: null, kind: 'session.state' as const, toolName: null, toolUseId: null, summary: 'Status: idle', payload: { kind: 'interactive', status: 'idle', surface: 'cli' }, cwd: null, dedupeKey: null }
    store.ingest([idle])
    const status = (t: number) => store.snapshot(t, EXTRAS).sessions[0]!.status
    expect(status(t0 + 3_300)).toBe('working')
    expect(store.duePolls(t0 + 4_900)).toEqual([]) // still inside the window
    // A notification in between does not cancel it: the row is still what `claude agents` says.
    store.ingest([normalizeHook(JSON.stringify({ session_id: 'esc', hook_event_name: 'Notification', message: 'waiting' }), t0 + 4_000)!])
    expect(store.duePolls(t0 + 8_000)).toEqual([])
    const due = store.duePolls(t0 + 9_100)
    expect(due).toHaveLength(1)
    store.ingest(due)
    expect(status(t0 + 9_100)).toBe('idle')
    expect(store.duePolls(t0 + 20_000)).toEqual([]) // applied once
  })
})

describe('weekStart (D-008)', () => {
  it('is Monday 00:00 local time', () => {
    const d = new Date(weekStart(new Date(2026, 10, 5, 15, 30).getTime())) // a Thursday
    expect([d.getDay(), d.getHours(), d.getMinutes(), d.getDate()]).toEqual([1, 0, 0, 2])
    expect(weekStart(new Date(2026, 10, 2, 0, 0).getTime())).toBe(new Date(2026, 10, 2).getTime())
    expect(new Date(weekStart(new Date(2026, 10, 8, 23).getTime())).getDate()).toBe(2) // Sunday belongs to the week before
  })
})
