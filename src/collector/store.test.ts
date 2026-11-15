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
    expect(snap).toMatchObject({ mode: 'live', usage: null, agentDefinitionCount: 3 })
    // Every approval was answered; what's left are the finished `-p` runs to review (they end with reason "other").
    expect(snap.attention.length).toBeGreaterThan(0)
    expect(snap.attention.every((i) => i.kind === 'review' && i.priority === 4)).toBe(true)
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
    const tables = ['events', 'sessions', 'work_spans', 'finished_turns', 'files', 'attention_items']
    for (const t of tables) expect(count(t), t).toBeGreaterThan(0)
    const later = lastTs() + RETENTION_MS + 1
    store.prune(later)
    for (const t of tables) expect(count(t), t).toBe(0)
    db.close()
    // Memory too: the same instance, asked about the time the rows were made, has nothing left.
    const snap = store.snapshot(lastTs(), EXTRAS)
    expect([snap.sessions, snap.files, snap.week.finishedTurns, snap.week.agentTimeMs, snap.attention]).toEqual([[], [], [], 0, []])
  })

  describe('attention (ADR-0013)', () => {
    const t0 = Date.UTC(2026, 10, 5, 12)
    const hook = (kind: string, ts: number, extra: Record<string, unknown> = {}) =>
      normalizeHook(JSON.stringify({ session_id: 'a', hook_event_name: kind, cwd: 'D:\\p', ...extra }), ts)!
    const pre = { tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'git push --force' } }
    const ask = (store: Store) =>
      store.ingest([hook('UserPromptSubmit', t0, { prompt: 'go' }), hook('PreToolUse', t0 + 100, pre), hook('PermissionRequest', t0 + 200, { tool_name: 'Bash', tool_input: pre.tool_input })])

    it('opens an approval with the exact command, and clears it on the PostToolUse', () => {
      const store = open(':memory:')
      ask(store)
      expect(store.snapshot(t0 + 200, EXTRAS).attention).toEqual([
        expect.objectContaining({ priority: 1, kind: 'approval', title: 'Run `git push --force`', riskFlags: ['Force push'], sessionId: 'a' })
      ])
      expect(store.fastPollUntil()).toBeGreaterThan(t0 + 200)
      store.ingest([hook('PostToolUse', t0 + 900, pre)])
      expect(store.snapshot(t0 + 900, EXTRAS).attention).toEqual([])
      expect(store.fastPollUntil()).toBe(0)
    })

    it('keeps open items across a restart, and records how each one closed', () => {
      const file = tempDb()
      const first = open(file)
      ask(first)
      first.close()
      stores.pop()
      const again = open(file, t0 + 1_000)
      expect(again.snapshot(t0 + 1_000, EXTRAS).attention).toHaveLength(1)
      again.ingest([hook('PostToolUse', t0 + 1_100, pre)])
      const db = new DatabaseSync(file)
      expect(db.prepare('SELECT state, resolved_at, resolved_by FROM attention_items').all()).toEqual([
        { state: 'resolved', resolved_at: t0 + 1_100, resolved_by: 'hook' }
      ])
      db.close()
    })

    it('dismisses a P4, refuses a P1, and ticks P3 on a timer', () => {
      const store = open(':memory:')
      store.ingest([hook('UserPromptSubmit', t0, { prompt: 'go' }), hook('Stop', t0 + 100, { stop_hook_active: false, last_assistant_message: 'Done.' })])
      const review = store.snapshot(t0 + 100, EXTRAS).attention[0]!
      expect(store.dismiss(review.id, t0 + 200)).toBe(true)
      expect(store.snapshot(t0 + 200, EXTRAS).attention).toEqual([])

      const p1 = open(':memory:')
      ask(p1)
      const approval = p1.snapshot(t0 + 300, EXTRAS).attention[0]!
      expect(p1.dismiss(approval.id, t0 + 300)).toBe(false)

      const cfg = { idleMs: 60_000, toolMs: 60_000 }
      expect(p1.tick(t0 + 30_000, cfg)).toBe(false)
      p1.ingest([hook('PostToolUse', t0 + 400, pre)])
      expect(p1.tick(t0 + 400 + 60_001, cfg)).toBe(true) // working, nothing in flight, quiet for over N
      expect(p1.snapshot(t0 + 400 + 60_001, EXTRAS).attention).toEqual([expect.objectContaining({ priority: 3, kind: 'stuck' })])
    })

    describe('held approvals (ADR-0006)', () => {
      const held = (store: Store) => {
        store.ingest([hook('UserPromptSubmit', t0, { prompt: 'go' }), hook('PreToolUse', t0 + 100, pre)])
        const item = store.holdFor(hook('PermissionRequest', t0 + 200, { tool_name: 'Bash', tool_input: pre.tool_input }))!
        expect(store.setHeld(item.id, true, 'Waits here.')).toBe(true)
        return item
      }

      it('holdFor returns the approval the request opened; an answer closes it by agentdeck and the audit row stays', () => {
        const file = tempDb()
        const store = open(file)
        const item = held(store)
        expect(item).toMatchObject({ kind: 'approval', title: 'Run `git push --force`', riskFlags: ['Force push'] })
        expect(store.snapshot(t0 + 200, EXTRAS).attention).toEqual([expect.objectContaining({ id: item.id, held: true, hint: 'Waits here.' })])
        expect(store.setHeld(item.id, true, 'Waits here.')).toBe(false) // no change

        expect(store.answer(item.id, t0 + 300)).toBe(true)
        expect(store.isOpen(item.id)).toBe(false)
        const row = { itemId: item.id, sessionId: 'a', agentId: null, toolName: 'Bash', title: item.title, riskFlags: item.riskFlags, inputHash: 'h', requestedAt: t0 + 200, ts: t0 + 300, outcome: 'approved' as const }
        store.audit(row)
        expect(store.auditLog(10)).toEqual([row])
        const db = new DatabaseSync(file)
        expect(db.prepare('SELECT resolved_by FROM attention_items').all()).toEqual([{ resolved_by: 'agentdeck' }])
        db.close()
        store.prune(t0 + 300 + RETENTION_MS + 1)
        expect(store.auditLog(10)).toEqual([])
      })

      it('only a held item can be answered, and no hold survives a restart', () => {
        const file = tempDb()
        const first = open(file)
        const item = held(first)
        expect(first.setHeld(item.id, false, null)).toBe(true)
        expect(first.answer(item.id, t0 + 300)).toBe(false) // the terminal has it now
        first.setHeld(item.id, true, 'Waits here.')
        first.close()
        stores.pop()
        const again = open(file, t0 + 1_000)
        expect(again.snapshot(t0 + 1_000, EXTRAS).attention).toEqual([expect.objectContaining({ id: item.id, held: false, hint: null })])
      })
    })
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

describe('Store.detail (UI_MAP § Session drawer)', () => {
  const t0 = Date.UTC(2026, 10, 3, 9)
  const hook = (kind: string, ts: number, extra: Record<string, unknown> = {}) =>
    normalizeHook(JSON.stringify({ session_id: 'd', hook_event_name: kind, cwd: 'D:\\p', ...extra }), ts)!

  it('serves the newest events first, the plan, the changed files and the main agent final message', () => {
    const store = open(':memory:', t0)
    store.ingest([
      hook('UserPromptSubmit', t0, { prompt: 'go' }),
      hook('TaskCreated', t0 + 10, { task_id: '1', task_subject: 'Write the test' }),
      hook('TaskCreated', t0 + 20, { task_id: '2', task_subject: 'Fix the bug' }),
      hook('PreToolUse', t0 + 30, { tool_name: 'Edit', tool_use_id: 'e1', tool_input: { file_path: 'D:\\p\\a.ts', old_string: 'x', new_string: 'y' } }),
      hook('PostToolUse', t0 + 40, { tool_name: 'Edit', tool_use_id: 'e1', tool_input: { file_path: 'D:\\p\\a.ts', old_string: 'x', new_string: 'y' }, tool_response: {} }),
      hook('TaskCompleted', t0 + 50, { task_id: '1', task_subject: 'Write the test' }),
      hook('SubagentStop', t0 + 60, { agent_id: 'a1', agent_type: 'Explore', last_assistant_message: 'Subagent report' }),
      hook('Stop', t0 + 70, { stop_hook_active: false, last_assistant_message: 'All green.' })
    ])
    const d = store.detail('d')!
    expect(d.session.id).toBe('d')
    expect(d.timeline.map((e) => e.kind)).toEqual([
      'turn.stopped', 'subagent.stopped', 'task.completed', 'tool.finished', 'tool.started', 'task.created', 'task.created', 'session.prompt'
    ])
    expect(d.timeline[1]).toMatchObject({ agentType: 'Explore' })
    expect(d.tasks).toEqual([
      { id: '1', subject: 'Write the test', done: true },
      { id: '2', subject: 'Fix the bug', done: false }
    ])
    expect(d.files.map((f) => [f.path, f.tool])).toEqual([['D:\\p\\a.ts', 'Edit']])
    expect(d.finalMessage).toBe('All green.') // the subagent's report is not the session's
  })

  it('is null for a session it never saw', () => {
    expect(open(':memory:', t0).detail('nope')).toBeNull()
  })

  it('serves activity across sessions, newest first, capped', () => {
    const store = open(':memory:', t0)
    store.ingest([
      hook('UserPromptSubmit', t0, { prompt: 'go' }),
      normalizeHook(JSON.stringify({ session_id: 'e', hook_event_name: 'UserPromptSubmit', cwd: 'D:\\q', prompt: 'hi' }), t0 + 10)!,
      hook('Stop', t0 + 20, { stop_hook_active: false, last_assistant_message: 'Done.' })
    ])
    expect(store.activity(10).map((e) => [e.sessionId, e.kind])).toEqual([
      ['d', 'turn.stopped'], ['e', 'session.prompt'], ['d', 'session.prompt']
    ])
    expect(store.activity(1)).toHaveLength(1)
  })
})
