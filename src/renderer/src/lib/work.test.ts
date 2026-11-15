import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AttentionItem, Session } from '@shared/snapshot'
import type { EodReport, WorkTask } from '@shared/work'
import {
  WORK_REFETCH_MS, buildLanes, dayKey, dayLabel, dayStart, doneByAgent, eodStatusLine, followWork, hhmmss, newlyDone, projectBars, rankDays, reportFinding,
  sessionForTask, sessionsOf, shiftDay, startOfDay, summarize
} from './work'

const MIN = 60_000
const NOW = new Date(2026, 10, 12, 14, 0).getTime() // Thursday 12 Nov 2026, 14:00 local
const ago = (m: number): number => NOW - m * MIN

function session(over: Partial<Session> & Pick<Session, 'id' | 'name'>): Session {
  return {
    bgId: null, cwd: 'D:\\clients\\northwind-portal', surface: 'background', status: 'working', startedAt: ago(30), lastEventAt: ago(1),
    activity: 'Working', plan: null, waitingSince: null, subagents: [], ...over
  }
}
function task(over: Partial<WorkTask> & Pick<WorkTask, 'id'>): WorkTask {
  return { title: `Task ${over.id}`, project: null, status: 'todo', createdAt: ago(300), doneAt: null, sessionName: null, ...over }
}

describe('days', () => {
  it('keys a local calendar day and shifts it across a month end', () => {
    expect(dayKey(NOW)).toBe('2026-11-12')
    expect(dayKey(new Date(2026, 10, 12, 23, 59).getTime())).toBe('2026-11-12')
    expect(shiftDay('2026-11-01', -1)).toBe('2026-10-31')
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01')
    expect(dayStart('2026-11-12')).toBe(startOfDay(NOW))
  })
  it('labels today and yesterday in words, other days by weekday and date', () => {
    expect(dayLabel('2026-11-12', '2026-11-12')).toBe('Today')
    expect(dayLabel('2026-11-11', '2026-11-12')).toBe('Yesterday')
    expect(dayLabel('2026-11-09', '2026-11-12')).toMatch(/9/)
  })
  it('pins today first, orders the rest newest first and shows a day once', () => {
    const d = (day: string) => ({ day, agentTimeMs: 1, sessions: 1, tasksDone: 0, hasFile: true })
    const ranked = rankDays([d('2026-11-09'), d('2026-11-11'), d('2026-11-12'), d('2026-11-11'), d('2026-11-10')], '2026-11-12')
    expect(ranked.map((x) => x.day)).toEqual(['2026-11-12', '2026-11-11', '2026-11-10', '2026-11-09'])
  })
  it('lists today even when no data exists yet, and when nothing loaded', () => {
    expect(rankDays([{ day: '2026-11-10', agentTimeMs: 1, sessions: 1, tasksDone: 0, hasFile: true }], '2026-11-12').map((x) => x.day)).toEqual(['2026-11-12', '2026-11-10'])
    expect(rankDays(null, '2026-11-12')).toEqual([{ day: '2026-11-12', agentTimeMs: 0, sessions: 0, tasksDone: 0, hasFile: false }])
  })
})

describe('task lanes', () => {
  const tasks = [
    task({ id: 'a', status: 'todo', createdAt: ago(200) }),
    task({ id: 'b', status: 'todo', createdAt: ago(20) }),
    task({ id: 'c', status: 'doing', sessionName: 'auth-tests' }),
    task({ id: 'd', status: 'doing' }),
    task({ id: 'e', status: 'done', doneAt: ago(60) }),
    task({ id: 'f', status: 'done', doneAt: ago(60 * 20) }) // done yesterday
  ]
  const sessions = [
    session({ id: 's1', name: 'auth-tests', status: 'working' }),
    session({ id: 's2', name: 'stripe-webhooks', status: 'needs_you', waitingSince: ago(5) }),
    session({ id: 's3', name: 'agentdeck-ui', status: 'working', lastEventAt: ago(0.2) }),
    session({ id: 's4', name: 'invoice-pdf', status: 'failed', lastEventAt: ago(125) }),
    session({ id: 's5', name: 'old-run', status: 'done', lastEventAt: ago(60 * 30) }), // finished yesterday
    session({ id: 's6', name: 'idle-one', status: 'idle' })
  ]
  const lanes = buildLanes(tasks, sessions, NOW, [])

  it('puts open tasks in To do, newest first', () => {
    expect(lanes.todo.map((i) => i.task.id)).toEqual(['b', 'a'])
  })
  it('merges started tasks with working sessions no task owns, and keeps waiting ones out', () => {
    const ids = lanes.doing.map((i) => (i.kind === 'task' ? i.task.id : i.session.name))
    expect(ids).toContain('c')
    expect(ids).toContain('d')
    expect(ids).toContain('agentdeck-ui')
    expect(ids).not.toContain('stripe-webhooks') // waits on you
    expect(ids).not.toContain('auth-tests') // its task already shows it
    expect(ids).not.toContain('idle-one')
  })
  it('puts a session that waits on you in Waiting on you', () => {
    expect(lanes.needs.map((i) => (i.kind === 'agent' ? i.session.name : i.task.id))).toEqual(['stripe-webhooks'])
    expect(lanes.needs[0]?.reason).toBeNull() // waiting with no item yet
  })
  it('puts live status from the session named by the task on its card', () => {
    const card = lanes.doing.find((i) => i.kind === 'task' && i.task.id === 'c')
    expect(card?.kind === 'task' && card.session?.id).toBe('s1')
    const bare = lanes.doing.find((i) => i.kind === 'task' && i.task.id === 'd')
    expect(bare?.kind === 'task' && bare.session).toBeNull()
  })
  it('puts tasks done today and sessions finished today in Done today, newest first', () => {
    const ids = lanes.done.map((i) => (i.kind === 'task' ? i.task.id : i.session.name))
    expect(ids).toEqual(['e', 'invoice-pdf'])
  })
  it('counts the four lanes and the agents running', () => {
    // doing = task c (auth-tests, working), task d (nobody on it), agentdeck-ui (working); needs = stripe-webhooks
    expect(summarize(lanes)).toEqual({ todo: 2, doing: 3, needs: 1, asking: 1, done: 2, running: 2 })
  })

  describe('with open attention items', () => {
    const item = (over: Partial<AttentionItem> & Pick<AttentionItem, 'id' | 'sessionId' | 'priority' | 'kind'>): AttentionItem => ({
      title: 'x', toolName: null, hint: null, riskFlags: [], held: false, openedAt: ago(10), ...over
    })
    const attention = [
      item({ id: 'i1', sessionId: 's4', priority: 2, kind: 'failed', openedAt: ago(120) }),
      item({ id: 'i2', sessionId: 's3', priority: 3, kind: 'stuck', openedAt: ago(15) }),
      item({ id: 'i3', sessionId: 's1', priority: 1, kind: 'approval', openedAt: ago(2) }),
      item({ id: 'i4', sessionId: 's5', priority: 4, kind: 'review', openedAt: ago(60 * 29) })
    ]
    const l = buildLanes(tasks, sessions, NOW, attention)
    const names = (items: typeof l.needs): string[] => items.map((i) => (i.kind === 'task' ? `task:${i.task.id}` : i.session.name))

    it('moves a failed run out of Done today, a stuck one out of In progress and a task whose agent asks for approval, most urgent first', () => {
      expect(names(l.needs)).toEqual(['stripe-webhooks', 'task:c', 'invoice-pdf', 'agentdeck-ui'])
      expect(l.needs.map((i) => i.reason)).toEqual([null, 'approval', 'failed', 'stuck'])
      expect(summarize(l).asking).toBe(3) // the stuck run waits quietly: no amber for it alone
      expect(names(l.done)).toEqual(['task:e'])
      expect(names(l.doing)).toEqual(['task:d'])
    })
    it('leaves review items (P4) out: the work is finished', () => {
      expect(names(l.needs)).not.toContain('old-run')
    })
    it('puts a dismissed failure back in Done today', () => {
      const after = buildLanes(tasks, sessions, NOW, attention.filter((i) => i.id !== 'i1'))
      expect(names(after.done)).toContain('invoice-pdf')
    })
  })
  it('still shows a live session whose only task is done, and hides a finished one a task owns', () => {
    const l = buildLanes(
      [task({ id: 'x', status: 'done', doneAt: ago(5), sessionName: 'auth-tests' }), task({ id: 'y', status: 'doing', sessionName: 'invoice-pdf' })],
      sessions,
      NOW,
      []
    )
    expect(l.doing.some((i) => i.kind === 'agent' && i.session.name === 'auth-tests')).toBe(true)
    expect(l.done.some((i) => i.kind === 'agent' && i.session.name === 'invoice-pdf')).toBe(false)
  })
  it('uses the newest session when a name repeats', () => {
    const both = [session({ id: 'old', name: 'dup', lastEventAt: ago(500) }), session({ id: 'new', name: 'dup', lastEventAt: ago(2) })]
    expect(sessionForTask(task({ id: 'z', sessionName: 'dup' }), both)?.id).toBe('new')
    expect(sessionForTask(task({ id: 'z', sessionName: null }), both)).toBeNull()
    expect(sessionForTask(task({ id: 'z', sessionName: 'gone' }), both)).toBeNull()
  })
  it('does not count a task done at midnight sharp as yesterday', () => {
    const l = buildLanes([task({ id: 'm', status: 'done', doneAt: startOfDay(NOW) })], [], NOW, [])
    expect(l.done).toHaveLength(1)
  })
})

describe('report', () => {
  const base: EodReport = {
    day: '2026-11-12', generatedAt: NOW, closed: false,
    totals: { agentTimeMs: 380 * MIN, sessions: 3, turns: 9, filesChanged: 7, approvalsAnswered: 2, tasksDone: 1 },
    projects: [
      { cwd: 'D:\\thirdcode\\billing-api', name: 'billing-api', agentTimeMs: 190 * MIN, sessions: 2, turns: 5, files: 4 },
      { cwd: 'D:\\clients\\harbor-dental-site', name: 'harbor-dental-site', agentTimeMs: 150 * MIN, sessions: 1, turns: 3, files: 3 },
      { cwd: 'D:\\personal\\agentdeck', name: 'agentdeck', agentTimeMs: 40 * MIN, sessions: 1, turns: 1, files: 0 }
    ],
    sessions: [
      { id: 'a', name: 'invoice-pdf', project: 'D:\\thirdcode\\billing-api', status: 'done', startedAt: ago(300), lastEventAt: ago(200), agentTimeMs: 40 * MIN, plan: null, summary: null },
      { id: 'b', name: 'stripe-webhooks', project: 'd:/thirdcode/billing-api/', status: 'done', startedAt: ago(250), lastEventAt: ago(100), agentTimeMs: 150 * MIN, plan: { done: 3, total: 3 }, summary: 'Shipped' }
    ],
    tasksDone: [], carryOver: [], blockers: [], notes: ''
  }
  it('sizes project bars against the busiest and reports each share of the day', () => {
    const bars = projectBars(base.projects)
    expect(bars.map((b) => b.project.name)).toEqual(['billing-api', 'harbor-dental-site', 'agentdeck'])
    expect(bars[0]!.share).toBe(1)
    expect(bars[1]!.share).toBeCloseTo(150 / 190)
    expect(bars.map((b) => b.percent)).toEqual([50, 39, 11])
    expect(projectBars([])).toEqual([])
  })
  it('gives a project its sessions whatever the path spelling, longest first', () => {
    expect(sessionsOf(base, 'D:\\thirdcode\\billing-api').map((s) => s.name)).toEqual(['stripe-webhooks', 'invoice-pdf'])
  })
  it('states the day in one sentence, with what still waits', () => {
    expect(reportFinding(base)).toBe('Agents worked 6h 20m, 50% of it in billing-api.')
    const waiting = { ...base, blockers: [{ itemId: 'i', kind: 'approval' as const, title: 't', sessionId: 'a', project: 'p', openedAt: ago(5) }] }
    expect(reportFinding(waiting)).toBe('Agents worked 6h 20m, 50% of it in billing-api. 1 thing still waits on you.')
    const failing = { ...base, sessions: [...base.sessions, { ...base.sessions[0]!, id: 'f', status: 'failed' as const }] }
    expect(reportFinding(failing)).toBe('Agents worked 6h 20m, 50% of it in billing-api. 1 session failed.')
    const quiet = { ...base, totals: { ...base.totals, agentTimeMs: 0, tasksDone: 0 }, projects: [] }
    expect(reportFinding(quiet)).toBe('A quiet day: no agent ran.')
  })
  it('writes the status line from Settings: not yet published before the time, kept up to date after it', () => {
    const at = (h: number, m = 0): number => new Date(2026, 10, 12, h, m).getTime()
    const eod = { enabled: true, time: '18:00', folder: 'D:/notes/eod' }
    expect(eodStatusLine(eod, at(9))).toBe('Will be published at 18:00 · folder D:/notes/eod')
    expect(eodStatusLine(eod, at(17, 59))).toContain('Will be published at 18:00')
    expect(eodStatusLine(eod, at(18))).toBe('Published at 18:00, kept up to date until midnight · folder D:/notes/eod')
    expect(eodStatusLine({ ...eod, folder: null }, at(20))).toContain('folder AgentDeck data › eod')
    expect(eodStatusLine({ ...eod, enabled: false }, at(20))).toBeNull()
  })
})

describe('following the collector', () => {
  afterEach(() => vi.useRealTimers())

  /** A bridge's `onWorkChanged`: listeners come and go, and `push` is main sending the event. */
  function bridge(): { subscribe(l: () => void): () => void; push(): void; listeners(): number } {
    const listeners = new Set<() => void>()
    return {
      subscribe: (l) => {
        listeners.add(l)
        return () => void listeners.delete(l)
      },
      push: () => listeners.forEach((l) => l()),
      listeners: () => listeners.size
    }
  }

  it('reads at once for the first change, and a burst after it once more when the second is up', () => {
    vi.useFakeTimers()
    const b = bridge()
    const run = vi.fn()
    followWork(b.subscribe, run)
    b.push()
    expect(run).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(10)
      b.push()
    }
    expect(run).toHaveBeenCalledTimes(1) // 200 ms in: held back
    vi.advanceTimersByTime(WORK_REFETCH_MS - 200)
    expect(run).toHaveBeenCalledTimes(2) // one for the whole burst
    vi.advanceTimersByTime(5_000)
    expect(run).toHaveBeenCalledTimes(2)
    b.push() // quiet for a while: at once again
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('never reads more than once a second, however steady the changes', () => {
    vi.useFakeTimers()
    const b = bridge()
    const at: number[] = []
    followWork(b.subscribe, () => at.push(Date.now()))
    for (let i = 0; i < 100; i++) {
      b.push()
      vi.advanceTimersByTime(50) // twenty changes a second for five seconds
    }
    vi.advanceTimersByTime(2_000)
    expect(at.length).toBeLessThanOrEqual(6)
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(WORK_REFETCH_MS)
  })

  it('unsubscribes, and drops a read that was still waiting', () => {
    vi.useFakeTimers()
    const b = bridge()
    const run = vi.fn()
    const stop = followWork(b.subscribe, run)
    expect(b.listeners()).toBe(1)
    b.push()
    b.push() // the second waits for the second to be up
    stop()
    expect(b.listeners()).toBe(0)
    vi.advanceTimersByTime(10_000)
    expect(run).toHaveBeenCalledTimes(1)
    b.push()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('subscribes again after an unsubscribe, with its own pace', () => {
    vi.useFakeTimers()
    const b = bridge()
    const run = vi.fn()
    followWork(b.subscribe, run)()
    followWork(b.subscribe, run)
    b.push()
    expect(run).toHaveBeenCalledTimes(1)
    expect(b.listeners()).toBe(1)
  })
})

describe('what the cards say about an agent finishing', () => {
  const finished = (over: Partial<Session> = {}): Session => session({ id: 's1', name: 'bg-1', status: 'done', lastEventAt: ago(10), ...over })
  const done = (over: Partial<WorkTask> = {}): WorkTask => task({ id: 't1', status: 'done', sessionName: 'bg-1', doneAt: ago(10), ...over })

  it('knows a task its agent finished by the time it was done at', () => {
    expect(doneByAgent(done(), finished())).toBe(true)
    expect(doneByAgent(done({ doneAt: ago(10) - 1_500 }), finished({ lastEventAt: ago(10) }))).toBe(true) // the session's last event trails the finish
    expect(doneByAgent(done({ doneAt: ago(10) + 1_500 }), finished({ lastEventAt: ago(10) }))).toBe(true)
  })

  it('leaves a hand tick as a plain Done: it comes well after the session finished', () => {
    expect(doneByAgent(done({ doneAt: ago(2) }), finished({ lastEventAt: ago(10) }))).toBe(false)
  })

  it('is not said of a task with no session, no listed session, one still live, or one not done', () => {
    expect(doneByAgent(done({ sessionName: null }), finished())).toBe(false)
    expect(doneByAgent(done(), null)).toBe(false)
    expect(doneByAgent(done(), finished({ status: 'working', lastEventAt: ago(10) }))).toBe(false)
    expect(doneByAgent(done(), finished({ status: 'needs_you' }))).toBe(false)
    expect(doneByAgent(task({ id: 't2', status: 'doing', sessionName: 'bg-1' }), finished())).toBe(false)
    expect(doneByAgent(done({ doneAt: null }), finished())).toBe(false)
    expect(doneByAgent(done({ doneAt: ago(10) - 2 * MIN }), finished({ lastEventAt: ago(10) }))).toBe(false) // done long before the session's last event
  })

  it('finds the tasks that turned done between two reads, and only those with a session', () => {
    const before = [task({ id: 'a', status: 'doing', sessionName: 'bg-1' }), task({ id: 'b', status: 'todo' }), task({ id: 'c', status: 'done', sessionName: 'bg-3' })]
    const after = [
      task({ id: 'a', status: 'done', sessionName: 'bg-1', doneAt: 1 }), // finished by its agent
      task({ id: 'b', status: 'done', doneAt: 1 }), // ticked elsewhere: no session, nothing to announce
      task({ id: 'c', status: 'done', sessionName: 'bg-3', doneAt: 1 }), // done before already
      task({ id: 'd', status: 'done', sessionName: 'bg-4', doneAt: 1 }) // new to this page: not "turned" done
    ]
    expect(newlyDone(before, after).map((t) => t.id)).toEqual(['a'])
    expect(newlyDone([], after)).toEqual([])
  })

  it('writes the time of a report to the second', () => {
    expect(hhmmss(new Date(2026, 10, 12, 9, 5, 7).getTime())).toMatch(/09.05.07/)
  })
})
