import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import * as Tooltip from '@radix-ui/react-tooltip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentDeckBridge } from '@shared/bridge'
import type { Session } from '@shared/snapshot'
import type { WorkTask } from '@shared/work'
import { demoSnapshot } from '@/demo/snapshot'
import { demoEod, demoTasks } from '@/demo/work'
import { useUi } from '@/store'
import { EodPage } from '../pages/Eod'
import { TasksPage } from '../pages/Tasks'
import { Report } from './Report'
import { useTasks } from './tasksStore'
import { canFollowWork, startFollowing } from './useWorkPush'

// Thursday 12 Nov 2026, 14:00 local: the demo's "done today" tasks fall on this day.
const NOW = new Date(2026, 10, 12, 14, 0).getTime()

beforeEach(() => {
  vi.stubGlobal('window', {})
  const snapshot = demoSnapshot(NOW)
  useUi.setState({ snapshot, now: NOW, link: 'up' })
  useTasks.setState({ tasks: demoTasks(snapshot), load: 'ready', removed: null })
  // A server render reads the stores' initial state, so make that what the window would show.
  Object.assign(useUi.getInitialState(), useUi.getState())
  Object.assign(useTasks.getInitialState(), useTasks.getState())
})
afterEach(() => vi.unstubAllGlobals())

// The page alone, without the sidebar and top bar around it (those are checked by the page smoke tests).
const render = (page: 'tasks' | 'report'): string =>
  renderToString(createElement(Tooltip.Provider, null, createElement(page === 'tasks' ? TasksPage : EodPage)))
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('Tasks page (demo data)', () => {
  let html = ''
  let words = ''
  beforeEach(() => {
    html = render('tasks')
    words = text(html)
  })

  it('has the quick-add row and the four labelled lanes with their counts', () => {
    expect(html).toContain('id="quick-add"')
    for (const lane of ['To do', 'In progress', 'Waiting on you', 'Done today']) expect(html).toMatch(new RegExp(`<h2[^>]*>${lane}</h2>`))
    expect(html).toContain('aria-labelledby="lane-doing"')
    expect(html).toContain('aria-labelledby="lane-needs"')
    // Waiting on you: stripe-webhooks and booking-form (approvals), the portal task's question, invoice-pdf (failed).
    expect(words).toMatch(/Today 4 to do 3 in progress \(2 running\) 4 waiting on you 2 done/)
    expect(words).toMatch(/Waiting on you 4 items .*Question.*Approval.*Failed/)
  })
  it('puts tasks, agent sessions and linked status in the lanes', () => {
    expect(words).toContain('Fix the flaky auth tests on CI')
    expect(words).toContain('Agent session') // stripe-webhooks, agentdeck-ui and booking-form have no task
    expect(words).toMatch(/Question/) // the portal task says why its session waits
    expect(words).toContain('Review the invoice PDF layout')
    expect(words).toContain('invoice-pdf') // the failed session that finished today
    expect(html).toContain('role="checkbox"')
    expect(html).toContain('aria-checked="true"') // done tasks
  })
})

describe('Daily report page (demo data)', () => {
  let html = ''
  let words = ''
  beforeEach(() => {
    html = render('report')
    words = text(html)
  })

  it('lists today first with the days before it, and says which are closed', () => {
    expect(html).toContain('aria-label="Report days"')
    expect(words).toContain('Today')
    expect(words).toContain('Yesterday')
    expect(words).toContain('Closed')
    expect(words).toContain('Live')
  })
  it('leads with agent time and carries every section', () => {
    expect(words).toMatch(/Agent time/)
    for (const h of ['Done', 'Agent work by project', 'Needs you', 'Tomorrow', 'Notes']) expect(html).toMatch(new RegExp(`<h3[^>]*>[^]*?${h}`))
    expect(words).toContain('stripe-webhooks')
    expect(words).toMatch(/(Published at 18:00, kept up to date until midnight|Will be published at 18:00) · folder AgentDeck data › eod/)
  })
})

describe('a task its agent finished', () => {
  const session = (over: Partial<Session> = {}): Session => ({
    id: 's-bg', bgId: null, name: 'brisk-otter-7', cwd: 'D:\\clients\\northwind-portal', surface: 'background', status: 'done', startedAt: NOW - 40 * 60_000,
    lastEventAt: NOW - 10 * 60_000, activity: 'Finished', plan: null, waitingSince: null, subagents: [], ...over
  })
  const task = (over: Partial<WorkTask> = {}): WorkTask => ({
    id: 't-bg', title: 'Rebuild the invoice table', project: 'D:\\clients\\northwind-portal', status: 'done', createdAt: NOW - 60 * 60_000, doneAt: NOW - 10 * 60_000,
    sessionName: 'brisk-otter-7', ...over
  })
  function show(t: WorkTask, s: Session): string {
    useUi.setState({ snapshot: { ...demoSnapshot(NOW), sessions: [s], attention: [] }, now: NOW })
    useTasks.setState({ tasks: [t], load: 'ready' })
    Object.assign(useUi.getInitialState(), useUi.getState())
    Object.assign(useTasks.getInitialState(), useTasks.getState())
    return text(render('tasks'))
  }

  it('says Done by its agent, with an Undo, when the task was completed at the finish of its session', () => {
    const words = show(task(), session())
    expect(words).toContain('Done by its agent')
    expect(words).toMatch(/Done by its agent 10 min ago · Undo/)
  })

  it('says plain Done, with no Undo, for a tick by hand', () => {
    const words = show(task({ doneAt: NOW - 2 * 60_000 }), session())
    expect(words).toMatch(/Done 2 min ago/)
    expect(words).not.toContain('by its agent')
    expect(words).not.toContain('Undo')
  })
})

describe('the live report header', () => {
  const closed = { ...demoEod('2026-11-12', demoSnapshot(NOW), [], new Map(), NOW)!, generatedAt: new Date(2026, 10, 12, 9, 5, 7).getTime() }
  const open = { ...closed, closed: false }
  const html = (report: typeof closed, live: boolean): string => renderToString(createElement(Tooltip.Provider, null, createElement(Report, { report, live })))

  it('shows when it was updated to the second, with a lit dot while it follows the collector', () => {
    expect(text(html(open, true))).toMatch(/Updated 09.05.07/)
    expect(html(open, true)).toContain('bg-[var(--working)]')
  })

  it('shows a quiet dot when it only refreshes on the tick, and no dot on a closed day', () => {
    expect(html(open, false)).toContain('bg-[var(--idle)]')
    expect(html(open, false)).not.toContain('bg-[var(--working)]')
    const done = html({ ...closed, closed: true }, true)
    expect(text(done)).toMatch(/Final version 09.05/)
    expect(done).not.toContain('Updates as your agents work')
  })
})

describe('following the collector from a page', () => {
  function bridge(): { api: Pick<AgentDeckBridge, 'onWorkChanged'>; push(): void; listeners(): number } {
    const listeners = new Set<() => void>()
    return {
      api: {
        onWorkChanged: (l) => {
          listeners.add(l)
          return () => void listeners.delete(l)
        }
      },
      push: () => listeners.forEach((l) => l()),
      listeners: () => listeners.size
    }
  }

  it('knows whether the bridge pushes', () => {
    expect(canFollowWork()).toBe(false) // no bridge in this window
    vi.stubGlobal('window', { agentdeck: {} })
    expect(canFollowWork()).toBe(false) // a preload from before the push
    vi.stubGlobal('window', { agentdeck: bridge().api })
    expect(canFollowWork()).toBe(true)
  })

  it('subscribes only when enabled and the bridge pushes, and the cleanup unsubscribes', () => {
    const b = bridge()
    const run = vi.fn()
    expect(startFollowing(undefined, run, true)).toBeUndefined()
    expect(startFollowing({} as Pick<AgentDeckBridge, 'onWorkChanged'>, run, true)).toBeUndefined()
    expect(startFollowing(b.api, run, false)).toBeUndefined()
    expect(b.listeners()).toBe(0)

    const stop = startFollowing(b.api, run, true)!
    expect(b.listeners()).toBe(1)
    b.push()
    expect(run).toHaveBeenCalledTimes(1)
    stop() // unmount
    expect(b.listeners()).toBe(0)
    b.push()
    expect(run).toHaveBeenCalledTimes(1)
    startFollowing(b.api, run, true) // the effect runs again (another day on screen)
    expect(b.listeners()).toBe(1)
  })
})

describe('the tasks store, live', () => {
  const doing = (): WorkTask => ({ id: 't1', title: 'Rebuild the table', project: null, status: 'doing', createdAt: 1, doneAt: null, sessionName: 'bg-1' })
  const finished = (): WorkTask => ({ ...doing(), status: 'done', doneAt: NOW })
  let lists: (WorkTask[] | null)[]
  let announced: string[]
  let unsubscribe: () => void

  beforeEach(() => {
    lists = []
    announced = []
    vi.stubGlobal('window', {
      agentdeck: {
        listTasks: async () => lists.shift() ?? null,
        updateTask: async () => ({ ok: true, task: finished() }),
        onWorkChanged: () => () => undefined
      }
    })
    useUi.setState({ snapshot: { ...demoSnapshot(NOW), mode: 'live' }, announcement: '' })
    useTasks.setState({ tasks: [], load: 'loading' })
    unsubscribe = useUi.subscribe((st, prev) => {
      if (st.announcement !== prev.announcement) announced.push(st.announcement)
    })
  })
  afterEach(() => unsubscribe())

  it('announces a task its agent finished while the page was open, once', async () => {
    lists = [[doing()], [finished()], [finished()]]
    await useTasks.getState().refresh() // the first read says nothing
    expect(announced).toEqual([])
    await useTasks.getState().refresh()
    expect(announced).toHaveLength(1)
    expect(announced[0]).toContain('Done by its agent: Rebuild the table')
    await useTasks.getState().refresh() // read again, still done: not news
    expect(announced).toHaveLength(1)
    expect(useTasks.getState().tasks[0]).toMatchObject({ status: 'done' })
  })

  it('does not announce a task the user finished here: that has its own words', async () => {
    lists = [[doing()], [finished()]]
    await useTasks.getState().refresh()
    await useTasks.getState().update('t1', { status: 'done' })
    await useTasks.getState().refresh()
    expect(announced).toEqual([])
  })

  it('keeps what is on screen when a read fails', async () => {
    lists = [[doing()], null]
    await useTasks.getState().refresh()
    await useTasks.getState().refresh() // the collector did not answer
    expect(useTasks.getState()).toMatchObject({ load: 'ready', tasks: [{ id: 't1', status: 'doing' }] })
    expect(announced).toEqual([])
  })
})
