import { describe, expect, it } from 'vitest'
import { pathKey } from '@shared/paths'
import { demoSnapshot } from './snapshot'
import { demoEod, demoEodDays, demoTasks } from './work'
import { buildLanes, dayKey, rankDays, shiftDay } from '../lib/work'

const NOW = new Date(2026, 10, 12, 14, 0).getTime()
const snapshot = demoSnapshot(NOW)
const tasks = demoTasks(snapshot)
const none = new Map<string, string>()

describe('demo tasks', () => {
  it('only name sessions and folders the demo snapshot has', () => {
    const names = new Set(snapshot.sessions.map((s) => s.name))
    const folders = new Set(snapshot.sessions.map((s) => pathKey(s.cwd)))
    for (const t of tasks) {
      if (t.sessionName) expect(names.has(t.sessionName), t.title).toBe(true)
      if (t.project) expect(folders.has(pathKey(t.project)), t.title).toBe(true)
    }
  })
  it('keep the finished items in Done today, and the failed run in Waiting on you, when the demo is opened just after midnight', () => {
    const late = new Date(2026, 10, 14, 0, 41).getTime()
    const s = demoSnapshot(late)
    const lanes = buildLanes(demoTasks(s), s.sessions, late, s.attention)
    expect(lanes.done).toHaveLength(2)
    expect(lanes.needs.some((i) => i.reason === 'failed')).toBe(true)
  })
  it('fill all four lanes, with live status on the linked cards and agents beside the tasks', () => {
    const lanes = buildLanes(tasks, snapshot.sessions, NOW, snapshot.attention)
    expect([lanes.todo.length, lanes.doing.length, lanes.needs.length, lanes.done.length]).toEqual([4, 3, 4, 2])
    expect(lanes.doing.every((i) => i.session?.status !== 'needs_you')).toBe(true)
    expect(lanes.doing.filter((i) => i.kind === 'agent').map((i) => i.session.name)).toEqual(['agentdeck-ui'])
    expect(lanes.needs.some((i) => i.kind === 'task' && i.reason === 'question')).toBe(true)
    expect(lanes.needs.filter((i) => i.kind === 'agent').map((i) => i.session.name).sort()).toEqual(['booking-form', 'invoice-pdf', 'stripe-webhooks'])
  })
})

describe('demo reports', () => {
  const days = demoEodDays(snapshot, tasks)

  it('cover today and five days before it, newest first once ranked', () => {
    expect(days).toHaveLength(6)
    expect(rankDays(days, dayKey(NOW)).map((d) => d.day)).toEqual([0, 1, 2, 3, 4, 5].map((n) => shiftDay(dayKey(NOW), -n)))
  })
  it('add up: totals equal the rows they are made from, on every day', () => {
    for (const d of days) {
      const r = demoEod(d.day, snapshot, tasks, none)!
      expect(r.totals.agentTimeMs, d.day).toBe(r.sessions.reduce((n, s) => n + s.agentTimeMs, 0))
      expect(r.totals.agentTimeMs, d.day).toBe(r.projects.reduce((n, p) => n + p.agentTimeMs, 0))
      expect(r.totals.sessions, d.day).toBe(r.sessions.length)
      expect(r.totals.tasksDone, d.day).toBe(r.tasksDone.length)
      expect(r.totals.turns, d.day).toBe(r.projects.reduce((n, p) => n + p.turns, 0))
      expect(d.agentTimeMs, d.day).toBe(r.totals.agentTimeMs)
    }
  })
  it("derives today's report from the snapshot and the tasks as they stand", () => {
    const r = demoEod(dayKey(NOW), snapshot, tasks, none)!
    expect(r.closed).toBe(false)
    expect(r.sessions).toHaveLength(snapshot.sessions.length)
    expect(r.blockers.map((b) => b.itemId).sort()).toEqual(['a-billing-push', 'a-booking-env', 'a-invoice-limit', 'a-portal-question'])
    expect(r.totals.approvalsAnswered).toBe(1) // the one sample approval the Approvals page logs
    expect(r.tasksDone.map((t) => t.id).sort()).toEqual(['t-invoice', 't-seo'])
    expect(r.carryOver).toHaveLength(7)
    const moved = demoEod(dayKey(NOW), snapshot, tasks.map((t) => (t.id === 't-auth' ? { ...t, status: 'done' as const, doneAt: NOW } : t)), none)!
    expect(moved.totals.tasksDone).toBe(3)
    expect(moved.carryOver).toHaveLength(6)
  })
  it('has a day of failures with blockers and a quiet day with neither', () => {
    const rough = demoEod(shiftDay(dayKey(NOW), -3), snapshot, tasks, none)!
    expect(rough.sessions.filter((s) => s.status === 'failed').length).toBeGreaterThan(1)
    expect(rough.blockers.length).toBe(3)
    const quiet = demoEod(shiftDay(dayKey(NOW), -4), snapshot, tasks, none)!
    expect([quiet.sessions.length, quiet.blockers.length, quiet.tasksDone.length]).toEqual([1, 0, 0])
    expect(quiet.totals.agentTimeMs).toBeLessThan(60 * 60_000)
  })
  it('keeps notes typed in this run over the sample ones, and knows no other day', () => {
    const day = shiftDay(dayKey(NOW), -5)
    expect(demoEod(day, snapshot, tasks, none)!.notes).toMatch(/legal/)
    expect(demoEod(day, snapshot, tasks, new Map([[day, 'mine']]))!.notes).toBe('mine')
    expect(demoEod('2020-01-01', snapshot, tasks, none)).toBeNull()
  })
})
