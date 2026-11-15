import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC, type ActionResult } from '@shared/bridge'
import type { FromCollector, ToCollector, WorkReq, WorkRes } from '@shared/collector'
import { renderEodMarkdown } from '@shared/eod-markdown'
import { EOD_NOTES_MAX, type EodDay, type EodReport, type EodWrite, type TaskResult, type WorkTask } from '@shared/work'
import type { Supervisor } from './collector'
import type { MainCtx } from './ctx'
import { registerWork, workChanged } from './work'

vi.mock('electron', () => ({
  clipboard: { writeText: vi.fn() },
  shell: { openPath: vi.fn(async (): Promise<string> => '') }
}))
// The catalog main reads a role's name from: one role, "cto".
vi.mock('./roles', () => ({ roles: () => ({ summary: async (id: string) => (id === 'cto' ? { id, name: 'CTO' } : null) }) }))
const { clipboard, shell } = await import('electron')

const task = (over: Partial<WorkTask> = {}): WorkTask => ({ id: 't1', title: 'Write it', project: null, status: 'todo', createdAt: 1, doneAt: null, sessionName: null, ...over })
const report = (day: string, busy = true): EodReport => ({
  day,
  generatedAt: 0,
  closed: false,
  totals: { agentTimeMs: busy ? 60_000 : 0, sessions: busy ? 1 : 0, turns: 0, filesChanged: 0, approvalsAnswered: 0, tasksDone: 0 },
  projects: [],
  sessions: [],
  tasksDone: [],
  carryOver: [],
  blockers: [],
  notes: ''
})

interface Rig {
  userData: string
  call<T>(channel: string, ...args: unknown[]): Promise<T>
  requests: WorkReq[]
  respond: { current: (req: WorkReq) => WorkRes | null }
  state: { demo: boolean; collector: boolean }
  /** The window main would send to; null = none. */
  win: { current: BrowserWindow | null }
  dispose(): void
}

const dirs: string[] = []
function rig(config: Record<string, unknown> = {}): Rig {
  const userData = mkdtempSync(join(tmpdir(), 'agentdeck-work-main-'))
  dirs.push(userData)
  writeFileSync(join(userData, 'config.json'), JSON.stringify(config))
  const handlers = new Map<string, (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const requests: WorkReq[] = []
  const respond: Rig['respond'] = { current: () => null }
  const state = { demo: false, collector: true }
  const win: Rig['win'] = { current: null }
  const supervisor = {
    post: vi.fn(),
    stop: vi.fn(),
    request: async (build: (reqId: number) => ToCollector): Promise<FromCollector | null> => {
      const m = build(7)
      if (m.type !== 'work') return null
      requests.push(m.req)
      return { type: 'work', reqId: m.reqId, res: respond.current(m.req) }
    }
  } as unknown as Supervisor
  const ctx: MainCtx = {
    handle: (channel, fn) => void handlers.set(channel, fn),
    collector: () => (state.collector ? supervisor : null),
    demo: () => state.demo,
    configFile: () => join(userData, 'config.json'),
    userData: () => userData,
    window: () => win.current
  }
  const dispose = registerWork(ctx)
  return {
    userData,
    call: async <T>(channel: string, ...args: unknown[]) => (await handlers.get(channel)!({} as IpcMainInvokeEvent, ...args)) as T,
    requests,
    respond,
    state,
    win,
    dispose
  }
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  vi.useRealTimers()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('registerWork', () => {
  it('registers every task, report and clipboard channel', () => {
    const handled: string[] = []
    const ctx = { handle: (c: string) => handled.push(c), collector: () => null, demo: () => false, configFile: () => 'x', userData: () => 'y', window: () => null } as unknown as MainCtx
    registerWork(ctx)()
    expect(handled.sort()).toEqual(
      [IPC.listTasks, IPC.addTask, IPC.updateTask, IPC.removeTask, IPC.getEod, IPC.listEodDays, IPC.saveEodNotes, IPC.writeEod, IPC.openEodFolder, IPC.copyText].sort()
    )
  })
})

describe('tasks', () => {
  it('lists, adds, updates and removes through the collector', async () => {
    const r = rig()
    r.respond.current = (req) => {
      if (req.kind === 'tasks.list') return { kind: 'tasks', tasks: [task()] }
      if (req.kind === 'tasks.add') return { kind: 'task', result: { ok: true, task: task({ title: req.input.title }) } }
      if (req.kind === 'tasks.update') return { kind: 'task', result: { ok: true, task: task({ status: 'done', doneAt: 5 }) } }
      return { kind: 'ok', result: { ok: true } }
    }
    expect(await r.call<WorkTask[]>(IPC.listTasks)).toEqual([task()])
    expect(await r.call<TaskResult>(IPC.addTask, { title: '  Ship it  ', project: null })).toMatchObject({ ok: true, task: { title: 'Ship it' } })
    expect(await r.call<TaskResult>(IPC.updateTask, 't1', { status: 'done' })).toMatchObject({ ok: true, task: { status: 'done' } })
    expect(await r.call<ActionResult>(IPC.removeTask, 't1')).toEqual({ ok: true })
    expect(r.requests).toEqual([
      { kind: 'tasks.list' },
      { kind: 'tasks.add', input: { title: 'Ship it', project: null } },
      { kind: 'tasks.update', id: 't1', patch: { status: 'done' } },
      { kind: 'tasks.remove', id: 't1' }
    ])
  })

  it('refuses malformed input without asking the collector', async () => {
    const r = rig()
    for (const bad of [{ title: '   ', project: null }, { title: 'x'.repeat(201), project: null }, { title: 'ok', project: 'C' }, { title: 'ok' }, 'text', null]) {
      expect(await r.call<TaskResult>(IPC.addTask, bad), JSON.stringify(bad)).toMatchObject({ ok: false })
    }
    for (const [id, patch] of [['t1', { status: 'finished' }], ['t1', { id: 'other' }], ['t1', { title: '' }], ['', {}], [7, {}], ['x'.repeat(65), {}]] as const) {
      expect(await r.call<TaskResult>(IPC.updateTask, id, patch), JSON.stringify([id, patch])).toMatchObject({ ok: false })
    }
    expect(await r.call<ActionResult>(IPC.removeTask, '')).toMatchObject({ ok: false })
    expect(await r.call<ActionResult>(IPC.removeTask, { id: 1 })).toMatchObject({ ok: false })
    expect(r.requests).toEqual([])
  })

  it('answers in plain words in demo and while the collector is down', async () => {
    const r = rig()
    r.state.demo = true
    expect(await r.call(IPC.listTasks)).toBeNull()
    expect(await r.call<TaskResult>(IPC.addTask, { title: 'a', project: null })).toEqual({ ok: false, error: 'Demo data: nothing was saved.' })
    expect(await r.call<ActionResult>(IPC.removeTask, 't1')).toMatchObject({ ok: false, error: expect.stringContaining('Demo data') })
    r.state.demo = false
    r.state.collector = false
    expect(await r.call(IPC.listTasks)).toBeNull()
    expect(await r.call<TaskResult>(IPC.updateTask, 't1', { title: 'b' })).toEqual({ ok: false, error: expect.stringContaining('starting its collector') })
    r.state.collector = true
    r.respond.current = () => null // the collector could not answer
    expect(await r.call(IPC.listTasks)).toBeNull()
    expect(await r.call<TaskResult>(IPC.addTask, { title: 'a', project: null })).toMatchObject({ ok: false })
    expect(r.requests).toHaveLength(2) // only the last two reached the collector
  })
})

describe('the role of a task', () => {
  it('is checked against the catalog and sent to the collector with the name it has now', async () => {
    const r = rig()
    r.respond.current = (req) => ({ kind: 'task', result: { ok: true, task: task({ role: 'cto', roleName: req.kind === 'tasks.add' || req.kind === 'tasks.update' ? (req.roleName ?? null) : null }) } })
    expect(await r.call<TaskResult>(IPC.addTask, { title: 'Plan', project: null, role: 'cto' })).toMatchObject({ ok: true, task: { role: 'cto', roleName: 'CTO' } })
    expect(await r.call<TaskResult>(IPC.updateTask, 't1', { role: 'cto' })).toMatchObject({ ok: true })
    expect(r.requests).toEqual([
      { kind: 'tasks.add', input: { title: 'Plan', project: null, role: 'cto' }, roleName: 'CTO' },
      { kind: 'tasks.update', id: 't1', patch: { role: 'cto' }, roleName: 'CTO' }
    ])
  })

  it('takes a role off with null, and asks the catalog for nothing', async () => {
    const r = rig()
    r.respond.current = () => ({ kind: 'task', result: { ok: true, task: task() } })
    expect(await r.call<TaskResult>(IPC.updateTask, 't1', { role: null })).toMatchObject({ ok: true })
    expect(r.requests).toEqual([{ kind: 'tasks.update', id: 't1', patch: { role: null } }])
  })

  it('refuses a role the catalog does not have, in words, without asking the collector', async () => {
    const r = rig()
    const gone = { ok: false, error: 'That role no longer exists. Reload the roles and pick it again.' }
    expect(await r.call<TaskResult>(IPC.addTask, { title: 'Plan', project: null, role: 'ghost' })).toEqual(gone)
    expect(await r.call<TaskResult>(IPC.updateTask, 't1', { role: 'ghost' })).toEqual(gone)
    expect(r.requests).toEqual([])
  })

  it('refuses anything that is not a role id: a name, a path, a number', async () => {
    const r = rig()
    for (const role of ['CTO', '../cto', 'C:\\roles\\cto.md', 'cto cto', 'x'.repeat(200), 7, ['cto']]) {
      expect(await r.call<TaskResult>(IPC.addTask, { title: 'Plan', project: null, role }), JSON.stringify(role)).toMatchObject({ ok: false })
      expect(await r.call<TaskResult>(IPC.updateTask, 't1', { role }), JSON.stringify(role)).toMatchObject({ ok: false })
    }
    expect(r.requests).toEqual([])
  })
})

describe('the Daily report', () => {
  it('asks for a valid day only', async () => {
    const r = rig()
    r.respond.current = (req) => (req.kind === 'eod.get' ? { kind: 'eod', report: report(req.day) } : null)
    expect(await r.call<EodReport>(IPC.getEod, '2026-11-13')).toMatchObject({ day: '2026-11-13' })
    for (const bad of ['2026-02-31', '2026-11-1', '..\\..\\x', '', 20261113, null]) expect(await r.call(IPC.getEod, bad), String(bad)).toBeNull()
    expect(r.requests).toEqual([{ kind: 'eod.get', day: '2026-11-13' }])
    r.state.demo = true
    expect(await r.call(IPC.getEod, '2026-11-13')).toBeNull()
  })

  it('lists the collector days with their files, plus days that only have a file, newest first', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'agentdeck-eod-list-'))
    dirs.push(folder)
    const r = rig({ eod: { folder } })
    r.respond.current = () => ({
      kind: 'days',
      days: [
        { day: '2026-11-13', agentTimeMs: 5, sessions: 2, tasksDone: 1, hasFile: false, closed: false },
        { day: '2026-11-11', agentTimeMs: 9, sessions: 1, tasksDone: 0, hasFile: false, closed: true }
      ]
    })
    writeFileSync(join(folder, '2026-11-11.md'), 'written')
    writeFileSync(join(folder, '2026-11-12.md'), 'from before the database was reset')
    expect(await r.call<EodDay[]>(IPC.listEodDays)).toEqual([
      { day: '2026-11-13', agentTimeMs: 5, sessions: 2, tasksDone: 1, hasFile: false },
      { day: '2026-11-12', agentTimeMs: 0, sessions: 0, tasksDone: 0, hasFile: true },
      { day: '2026-11-11', agentTimeMs: 9, sessions: 1, tasksDone: 0, hasFile: true }
    ])
    r.respond.current = () => null
    expect(await r.call(IPC.listEodDays)).toBeNull()
  })

  it('saves notes for a valid day, within the limit', async () => {
    const r = rig()
    r.respond.current = () => ({ kind: 'ok', result: { ok: true } })
    expect(await r.call<ActionResult>(IPC.saveEodNotes, '2026-11-13', 'Talked to Sam')).toEqual({ ok: true })
    expect(await r.call<ActionResult>(IPC.saveEodNotes, '2026-11-13', 'x'.repeat(EOD_NOTES_MAX))).toEqual({ ok: true })
    const tooLong = await r.call<ActionResult>(IPC.saveEodNotes, '2026-11-13', 'x'.repeat(EOD_NOTES_MAX + 1))
    expect(tooLong).toMatchObject({ ok: false, error: expect.stringContaining('4,000') })
    expect(await r.call<ActionResult>(IPC.saveEodNotes, '2026-02-31', 'x')).toMatchObject({ ok: false })
    expect(await r.call<ActionResult>(IPC.saveEodNotes, '2026-11-13', 42)).toMatchObject({ ok: false })
    expect(r.requests).toHaveLength(2)
    r.state.collector = false
    expect(await r.call<ActionResult>(IPC.saveEodNotes, '2026-11-13', 'x')).toMatchObject({ ok: false, error: expect.stringContaining('collector') })
  })

  it('writes the day to the report folder, and says why it could not', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'agentdeck-eod-out-'))
    dirs.push(folder)
    const r = rig({ eod: { folder } })
    r.respond.current = (req) => (req.kind === 'eod.get' ? { kind: 'eod', report: report(req.day) } : null)
    const w = await r.call<EodWrite>(IPC.writeEod, '2026-11-13')
    expect(w).toEqual({ ok: true, path: join(folder, '2026-11-13.md') })
    expect(readFileSync(join(folder, '2026-11-13.md'), 'utf8')).toBe(renderEodMarkdown(report('2026-11-13')))

    r.respond.current = (req) => (req.kind === 'eod.get' ? { kind: 'eod', report: report(req.day, false) } : null)
    expect(await r.call<EodWrite>(IPC.writeEod, '2026-11-13')).toMatchObject({ ok: false, error: expect.stringContaining('left as it is') })
    expect(await r.call<EodWrite>(IPC.writeEod, 'tomorrow')).toMatchObject({ ok: false })
    r.state.collector = false
    expect(await r.call<EodWrite>(IPC.writeEod, '2026-11-14')).toMatchObject({ ok: false, error: expect.stringContaining('collector') })
  })

  it('writes into <userData>/eod when no folder is set, or the one set is not absolute', async () => {
    const r = rig({ eod: { folder: 'relative\\path' } })
    r.respond.current = (req) => (req.kind === 'eod.get' ? { kind: 'eod', report: report(req.day) } : null)
    const w = await r.call<EodWrite>(IPC.writeEod, '2026-11-13')
    expect(w).toEqual({ ok: true, path: join(r.userData, 'eod', '2026-11-13.md') })
  })

  it('opens the report folder, creating it first', async () => {
    const r = rig()
    expect(await r.call<ActionResult>(IPC.openEodFolder)).toEqual({ ok: true })
    expect(existsSync(join(r.userData, 'eod'))).toBe(true)
    expect(shell.openPath).toHaveBeenCalledWith(join(r.userData, 'eod'))
    vi.mocked(shell.openPath).mockResolvedValueOnce('No application is associated')
    expect(await r.call<ActionResult>(IPC.openEodFolder)).toEqual({ ok: false, error: 'No application is associated' })
    // A file in the way of the folder.
    const blocked = rig({ eod: { folder: join(r.userData, 'config.json', 'inside') } })
    expect(await blocked.call<ActionResult>(IPC.openEodFolder)).toMatchObject({ ok: false, error: expect.stringContaining('could not create') })
  })

  it('works without a collector for the folder and the clipboard', async () => {
    const r = rig()
    r.state.demo = true
    expect(await r.call<ActionResult>(IPC.openEodFolder)).toEqual({ ok: true })
    expect(await r.call<ActionResult>(IPC.copyText, 'hello')).toEqual({ ok: true })
    expect(clipboard.writeText).toHaveBeenCalledWith('hello')
  })
})

describe('copyText', () => {
  it('copies up to 100,000 characters and refuses more or anything that is not text', async () => {
    const r = rig()
    expect(await r.call<ActionResult>(IPC.copyText, 'x'.repeat(100_000))).toEqual({ ok: true })
    expect(await r.call<ActionResult>(IPC.copyText, '')).toEqual({ ok: true })
    expect(await r.call<ActionResult>(IPC.copyText, 'x'.repeat(100_001))).toMatchObject({ ok: false, error: expect.stringContaining('100,000') })
    expect(await r.call<ActionResult>(IPC.copyText, { text: 'x' })).toMatchObject({ ok: false })
    expect(clipboard.writeText).toHaveBeenCalledTimes(2)
  })
})

describe('the scheduler timers', () => {
  it('checks once after launch and then every minute, until disposed', async () => {
    vi.useFakeTimers()
    // After the publish time (18:00 by default) the scheduler keeps working all evening; before it, a quiet tick asks nothing.
    // Pinned, so the test does not depend on the hour it runs in.
    vi.setSystemTime(new Date(2026, 10, 13, 19, 0, 0))
    const r = rig()
    r.respond.current = () => ({ kind: 'days', days: [] })
    await vi.advanceTimersByTimeAsync(14_000)
    expect(r.requests).toEqual([])
    await vi.advanceTimersByTimeAsync(1_000)
    expect(r.requests[0]).toEqual({ kind: 'eod.days' })
    const before = r.requests.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(r.requests.length).toBeGreaterThan(before)
    r.dispose()
    const after = r.requests.length
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(r.requests).toHaveLength(after)
  })

  it('reads the settings on every tick', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 13, 19, 0, 0))
    const r = rig({ eod: { enabled: false } })
    r.respond.current = () => ({ kind: 'days', days: [] })
    await vi.advanceTimersByTimeAsync(76_000)
    expect(r.requests).toEqual([])
    writeFileSync(join(r.userData, 'config.json'), JSON.stringify({ eod: { enabled: true } }))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(r.requests.length).toBeGreaterThan(0)
    r.dispose()
  })
})

describe('work-changed from the collector', () => {
  const stubWindow = (destroyed = false): { win: BrowserWindow; send: ReturnType<typeof vi.fn> } => {
    const send = vi.fn()
    return { win: { isDestroyed: () => destroyed, webContents: { send } } as unknown as BrowserWindow, send }
  }

  it('is sent on to the window once per call, and not to a window that is gone', () => {
    const r = rig({ eod: { enabled: false } })
    const live = stubWindow()
    r.win.current = live.win
    workChanged()
    workChanged()
    expect(live.send.mock.calls).toEqual([[IPC.workChanged], [IPC.workChanged]])
    const gone = stubWindow(true)
    r.win.current = gone.win
    workChanged()
    r.win.current = null
    workChanged() // no window yet: nothing to do, nothing thrown
    expect(gone.send).not.toHaveBeenCalled()
    r.dispose()
  })

  it('does nothing before the work module is registered or after it is disposed', () => {
    expect(() => workChanged()).not.toThrow()
    const r = rig({ eod: { enabled: false } })
    const live = stubWindow()
    r.win.current = live.win
    r.dispose()
    workChanged()
    expect(live.send).not.toHaveBeenCalled()
  })

  it('rewrites the report file within about 30 s of a change, and not before the 30 s are up', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 13, 12, 0))
    const r = rig({ eod: { enabled: true, time: '00:00' } })
    r.win.current = stubWindow().win
    let minutes = 1
    r.respond.current = (req) => {
      if (req.kind === 'eod.days') return { kind: 'days', days: [] }
      if (req.kind !== 'eod.refresh') return null
      const base = report('2026-11-13')
      return { kind: 'refreshed', changed: true, report: { ...base, totals: { ...base.totals, agentTimeMs: minutes * 60_000 } } }
    }
    const file = join(r.userData, 'eod', '2026-11-13.md')
    await vi.advanceTimersByTimeAsync(15_000) // the first check publishes
    const published = readFileSync(file, 'utf8')
    const refreshes = (): number => r.requests.filter((q) => q.kind === 'eod.refresh').length
    expect(refreshes()).toBe(1)

    minutes = 2
    workChanged()
    workChanged()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(refreshes()).toBe(1) // the last rewrite is not 30 s old
    expect(readFileSync(file, 'utf8')).toBe(published)
    await vi.advanceTimersByTimeAsync(11_000)
    expect(refreshes()).toBe(2)
    expect(readFileSync(file, 'utf8')).not.toBe(published)

    await vi.advanceTimersByTimeAsync(5 * 60_000) // nothing reported since: nothing asked
    expect(refreshes()).toBe(2)
    r.dispose()
  })
})
