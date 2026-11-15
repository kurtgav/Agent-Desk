import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { fixture } from '../src/collector/fixtures'
import { addDays, dayBounds, dayKey } from '../src/shared/day'
import { renderEodMarkdown } from '../src/shared/eod-markdown'
import {
  FIRST_SUMMARY, SESSION_CWD, SESSION_ID, bridge, cleanup, clearOfMidnight, closeApps, collectorPid, collectorReady, launch, playSession, postHook, profile, rawBridge, taskOf, type Endpoint
} from './support'

// Tasks and the Daily report against the REAL collector (live mode, temp profile, no polling): the bridge as the renderer
// calls it, a hook run posted the way Claude Code does, the markdown file, the scheduler, and a relaunch.

test.afterEach(cleanup)

const today = (): string => dayKey(Date.now())
const config = (userData: string, value: Record<string, unknown>): void => writeFileSync(join(userData, 'config.json'), JSON.stringify(value))
const readConfig = (userData: string): Record<string, unknown> => JSON.parse(readFileSync(join(userData, 'config.json'), 'utf8')) as Record<string, unknown>

async function live(userData: string): Promise<{ app: ElectronApplication; page: Page; endpoint: Endpoint }> {
  const { app, page } = await launch(userData)
  await expect(page.getByTestId('home')).toBeVisible()
  return { app, page, endpoint: await collectorReady(userData) }
}

/** The collector reads events off a queue after answering 200, so wait for the report to show the whole run. */
const untilTurns = (page: Page, turns: number) =>
  expect.poll(async () => (await bridge(page, 'getEod', today()))?.totals.turns, { timeout: 10_000 }).toBe(turns)

test('tasks: add, list, done sets doneAt and moving back clears it, rename, remove', async () => {
  const { page } = await live(profile('tasks'))
  expect(await bridge(page, 'listTasks')).toEqual([])

  const before = Date.now()
  const added = taskOf(await bridge(page, 'addTask', { title: '  Ship the invoice export  ', project: SESSION_CWD }))
  expect(added).toMatchObject({ title: 'Ship the invoice export', project: SESSION_CWD, status: 'todo', doneAt: null, sessionName: null })
  expect(added.createdAt).toBeGreaterThanOrEqual(before - 1_000)
  expect(await bridge(page, 'listTasks')).toEqual([added])

  const doing = taskOf(await bridge(page, 'updateTask', added.id, { status: 'doing', sessionName: 'bg-1' }))
  expect(doing).toMatchObject({ status: 'doing', doneAt: null, sessionName: 'bg-1' })

  const done = taskOf(await bridge(page, 'updateTask', added.id, { status: 'done' }))
  expect(done.status).toBe('done')
  expect(done.doneAt).toBeGreaterThanOrEqual(before - 1_000)
  expect(done.doneAt).toBeLessThanOrEqual(Date.now() + 1_000)
  // Done again, or renamed while done, keeps the first doneAt.
  expect(taskOf(await bridge(page, 'updateTask', added.id, { status: 'done', title: 'Ship the export' }))).toMatchObject({ title: 'Ship the export', doneAt: done.doneAt })

  const back = taskOf(await bridge(page, 'updateTask', added.id, { status: 'todo', project: null }))
  expect(back).toMatchObject({ status: 'todo', doneAt: null, project: null })
  expect(await bridge(page, 'listTasks')).toEqual([back])

  expect(await bridge(page, 'removeTask', added.id)).toEqual({ ok: true })
  expect(await bridge(page, 'listTasks')).toEqual([])
  // Removing what is already gone is not an error, and a task that is gone cannot be updated.
  expect(await bridge(page, 'removeTask', added.id)).toEqual({ ok: true })
  expect(await bridge(page, 'updateTask', added.id, { status: 'done' })).toMatchObject({ ok: false, error: expect.stringContaining('no longer exists') })
})

test('the report of a real hook run: totals, project, session, tasks, markdown file and notes round-trip', async () => {
  await clearOfMidnight()
  const userData = profile('report')
  const folder = join(userData, 'reports')
  config(userData, { eod: { enabled: false, folder } }) // the scheduler stays off: only writeEod writes here
  const { page, endpoint } = await live(userData)

  taskOf(await bridge(page, 'updateTask', taskOf(await bridge(page, 'addTask', { title: 'Ship the invoice export', project: SESSION_CWD })).id, { status: 'done' }))
  const open = taskOf(await bridge(page, 'addTask', { title: 'Plan the Q1 rollout', project: null }))
  await playSession(endpoint, 2)
  await untilTurns(page, 2)
  const notes = 'Waiting on finance for the VAT rate.\nSecond line, with `code` and a - dash.'
  expect(await bridge(page, 'saveEodNotes', today(), notes)).toEqual({ ok: true })

  const report = (await bridge(page, 'getEod', today()))!
  expect(report).toMatchObject({ day: today(), closed: false, notes })
  expect(report.totals).toMatchObject({ sessions: 1, turns: 2, filesChanged: 2, tasksDone: 1, approvalsAnswered: 0 })
  expect(report.totals.agentTimeMs).toBeGreaterThan(0)
  expect(report.projects).toHaveLength(1)
  expect(report.projects[0]).toMatchObject({ cwd: SESSION_CWD, name: 'acme-billing', sessions: 1, turns: 2, files: 2 })
  expect(report.sessions).toHaveLength(1)
  expect(report.sessions[0]).toMatchObject({ id: SESSION_ID, project: SESSION_CWD, status: 'done', summary: 'Follow-up 2 done.' })
  expect(report.tasksDone.map((t) => t.title)).toEqual(['Ship the invoice export'])
  expect(report.carryOver.map((t) => t.id)).toEqual([open.id])
  expect(report.blockers.every((b) => b.sessionId === SESSION_ID)).toBe(true)

  const days = (await bridge(page, 'listEodDays'))!
  expect(days[0]).toMatchObject({ day: today(), sessions: 1, tasksDone: 1, hasFile: false })

  // The file: <folder>/<day>.md, written atomically (no .tmp left), the same text the app renders, with what the user sees.
  expect(existsSync(folder), 'nothing is written before asked').toBe(false)
  const written = await bridge(page, 'writeEod', today())
  expect(written).toEqual({ ok: true, path: join(folder, `${today()}.md`) })
  expect(readdirSync(folder)).toEqual([`${today()}.md`])
  const md = readFileSync(join(folder, `${today()}.md`), 'utf8')
  expect(md).toBe(renderEodMarkdown((await bridge(page, 'getEod', today()))!))
  expect(md).toMatch(/^# End of day: \w+, \d{1,2} \w+ \d{4}\n/)
  for (const part of ['- [x] Ship the invoice export (acme-billing)', '- [ ] Plan the Q1 rollout', '**acme-billing**', '1 session', '1 task done', '2 files changed', notes, 'Follow-up 2 done.']) {
    expect(md).toContain(part)
  }
  expect(md).not.toContain(FIRST_SUMMARY) // a session shows its last final message only
  expect((await bridge(page, 'listEodDays'))![0]).toMatchObject({ day: today(), hasFile: true })

  // Removing the open task takes it off tomorrow's list; the next file no longer has it.
  expect(await bridge(page, 'removeTask', open.id)).toEqual({ ok: true })
  expect((await bridge(page, 'getEod', today()))!.carryOver).toEqual([])
  await bridge(page, 'writeEod', today())
  expect(readFileSync(join(folder, `${today()}.md`), 'utf8')).not.toContain('Plan the Q1 rollout')
})

test('tasks, notes and the day survive a relaunch on the same profile', async () => {
  await clearOfMidnight()
  const userData = profile('persist')
  const first = await live(userData)
  const a = taskOf(await bridge(first.page, 'addTask', { title: 'Finish the migration', project: SESSION_CWD }))
  taskOf(await bridge(first.page, 'updateTask', a.id, { status: 'done' }))
  const b = taskOf(await bridge(first.page, 'addTask', { title: 'Write the changelog', project: null }))
  taskOf(await bridge(first.page, 'updateTask', b.id, { status: 'doing', sessionName: 'bg-7' }))
  const gone = taskOf(await bridge(first.page, 'addTask', { title: 'Delete me', project: null }))
  await bridge(first.page, 'removeTask', gone.id)
  await bridge(first.page, 'saveEodNotes', today(), 'Notes that must outlive the app.')
  await playSession(first.endpoint, 2)
  await untilTurns(first.page, 2)
  const tasks = await bridge(first.page, 'listTasks')
  const report = (await bridge(first.page, 'getEod', today()))!
  await first.app.close()

  const second = await live(userData)
  expect(await bridge(second.page, 'listTasks')).toEqual(tasks)
  expect(tasks?.map((t) => t.title)).toEqual(['Finish the migration', 'Write the changelog'])
  const again = (await bridge(second.page, 'getEod', today()))!
  expect(again.notes).toBe('Notes that must outlive the app.')
  expect(again.tasksDone).toEqual(report.tasksDone)
  expect(again.carryOver).toEqual(report.carryOver)
  expect(again.totals).toEqual(report.totals)
  expect(again.projects).toEqual(report.projects)
  expect(again.sessions.map((s) => ({ id: s.id, project: s.project, summary: s.summary }))).toEqual(report.sessions.map((s) => ({ id: s.id, project: s.project, summary: s.summary })))
})

test('the scheduler writes the day on its own at the daily time, without writeEod', async () => {
  test.slow()
  await clearOfMidnight(240_000)
  const userData = profile('scheduler')
  const folder = join(userData, 'daily')
  config(userData, { eod: { enabled: false, time: '18:00', folder } })

  // Run 1 (scheduler off) only collects the day: a finished task and the user's notes.
  const first = await live(userData)
  taskOf(await bridge(first.page, 'updateTask', taskOf(await bridge(first.page, 'addTask', { title: 'Scheduler proof task', project: null })).id, { status: 'done' }))
  await bridge(first.page, 'saveEodNotes', today(), 'Written by nobody but the scheduler.')
  await closeApps()
  expect(existsSync(folder)).toBe(false)

  // Run 2: the report time was a minute ago (00:00 in the first minute of the day), so the first check after launch is due.
  const now = new Date()
  const minutes = Math.max(0, now.getHours() * 60 + now.getMinutes() - 1)
  const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  config(userData, { ...readConfig(userData), eod: { enabled: true, time, folder } })
  const second = await launch(userData)
  await expect(second.page.getByTestId('home')).toBeVisible()

  // Past days are closed first and today is written at the first check (15 s after launch, then every minute): a file
  // for today, or for yesterday if midnight passed meanwhile, carries the task and the notes.
  const text = (): string => (existsSync(folder) ? readdirSync(folder).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).map((f) => readFileSync(join(folder, f), 'utf8')).join('\n') : '')
  await expect.poll(text, { timeout: 90_000, intervals: [1_000] }).toContain('Scheduler proof task')
  expect(text()).toContain('Written by nobody but the scheduler.')
  expect(readdirSync(folder).some((f) => f.endsWith('.tmp'))).toBe(false)
})

test('invalid input is refused with a plain answer and changes nothing', async () => {
  await clearOfMidnight()
  const { page } = await live(profile('invalid'))
  const refused = { ok: false, error: expect.any(String) }

  for (const input of [
    { title: '', project: null }, { title: '   ', project: null }, { title: 'a'.repeat(201), project: null }, { title: 'x', project: 'C:' },
    { title: 'x', project: `C:\\${'p'.repeat(1_030)}` }, { title: 'x' }, { title: 42, project: null }, null, 'a task'
  ]) {
    expect(await rawBridge(page, 'addTask', input), JSON.stringify(input)).toMatchObject(refused)
  }
  const longest = taskOf(await bridge(page, 'addTask', { title: 'a'.repeat(200), project: null })) // the limit itself is fine
  expect(longest.title).toHaveLength(200)

  for (const [id, patch] of [
    [longest.id, { title: '' }], [longest.id, { title: 'a'.repeat(201) }], [longest.id, { status: 'finished' }], [longest.id, { surprise: 1 }], [longest.id, { sessionName: '' }],
    ['', { status: 'done' }], ['i'.repeat(65), { status: 'done' }], [7, { status: 'done' }], [longest.id, null]
  ] as const) {
    expect(await rawBridge(page, 'updateTask', id, patch), JSON.stringify([id, patch])).toMatchObject(refused)
  }
  for (const id of ['', 'i'.repeat(65), 7, null]) expect(await rawBridge(page, 'removeTask', id)).toMatchObject(refused)
  expect(await bridge(page, 'listTasks')).toEqual([longest]) // nothing slipped in, nothing changed

  for (const day of ['2026-02-31', '2026-13-01', 'today', '2026-1-1', '', '20261113', 7, null]) {
    expect(await rawBridge(page, 'getEod', day), String(day)).toBeNull()
    expect(await rawBridge(page, 'saveEodNotes', day, 'x'), String(day)).toMatchObject(refused)
    expect(await rawBridge(page, 'writeEod', day), String(day)).toMatchObject(refused)
  }
  expect(await bridge(page, 'saveEodNotes', today(), 'n'.repeat(4_000))).toEqual({ ok: true })
  expect(await bridge(page, 'saveEodNotes', today(), 'n'.repeat(4_001))).toMatchObject({ ok: false, error: expect.stringContaining('4,000') })
  expect(await rawBridge(page, 'saveEodNotes', today(), 5)).toMatchObject(refused)
  expect((await bridge(page, 'getEod', today()))!.notes).toHaveLength(4_000) // the refused save left the stored notes alone
  expect(await rawBridge(page, 'copyText', 'c'.repeat(100_001))).toMatchObject(refused)

  for (const patch of [{ eod: { time: '25:61' } }, { eod: { folder: '\\\\host\\share' } }, { eod: { folder: 'relative\\dir' } }, { eod: { surprise: true } }, { surprise: 1 }, { profileName: 'n'.repeat(201) }]) {
    await expect(rawBridge(page, 'updateSettings', patch), JSON.stringify(patch)).rejects.toThrow()
  }
})

test('demo mode answers null or "not saved" and never throws or writes', async () => {
  const userData = profile('demo')
  config(userData, { demo: true })
  const { page } = await launch(userData)
  await expect(page.getByTestId('home')).toBeVisible()
  const notSaved = { ok: false, error: expect.stringContaining('Demo data') }

  expect(await bridge(page, 'listTasks')).toBeNull()
  expect(await bridge(page, 'addTask', { title: 'In demo', project: null })).toMatchObject(notSaved)
  expect(await bridge(page, 'updateTask', 'some-id', { status: 'done' })).toMatchObject(notSaved)
  expect(await bridge(page, 'removeTask', 'some-id')).toMatchObject(notSaved)
  expect(await bridge(page, 'getEod', today())).toBeNull()
  expect(await bridge(page, 'listEodDays')).toBeNull()
  expect(await bridge(page, 'saveEodNotes', today(), 'notes')).toMatchObject(notSaved)
  expect(await bridge(page, 'writeEod', today())).toMatchObject(notSaved)
  expect(await rawBridge(page, 'getEod', 'garbage')).toBeNull()
  expect(await bridge(page, 'getSettings')).toMatchObject({ eod: { enabled: true, time: '18:00', folder: null } })
  expect(readdirSync(userData).filter((f) => f === 'eod' || f === 'reports')).toEqual([]) // no report folder was made
  expect(existsSync(join(userData, 'agentdeck.db')), 'demo reads demo.db only').toBe(false)
})

test('a day the app missed is closed and written on the next launch, once, and a hand edit of that file stays', async () => {
  test.slow()
  await clearOfMidnight(300_000)
  const userData = profile('catch-up')
  const folder = join(userData, 'daily')
  config(userData, { eod: { enabled: false, time: '23:59', folder } })

  // Run 1 makes the database and a task finished today; then yesterday is put in by hand: a task done at 15:00 and its notes.
  const first = await live(userData)
  taskOf(await bridge(first.page, 'updateTask', taskOf(await bridge(first.page, 'addTask', { title: 'Done today', project: null })).id, { status: 'done' }))
  await closeApps()
  const yesterday = addDays(today(), -1)
  const [midnight] = dayBounds(yesterday)
  const db = new DatabaseSync(join(userData, 'agentdeck.db'))
  db.prepare("INSERT INTO tasks (id, title, project, status, created_at, done_at, session_name) VALUES ('seed-1', 'Finished yesterday', NULL, 'done', ?, ?, NULL)").run(midnight! + 3_600_000, midnight! + 15 * 3_600_000)
  db.prepare("INSERT INTO eod_notes (day, notes, updated_at) VALUES (?, 'Yesterday I wrote this.', ?)").run(yesterday, midnight! + 16 * 3_600_000)
  db.close()

  // Run 2: the first check closes yesterday (before it writes today's file) and writes yesterday's file.
  config(userData, { ...readConfig(userData), eod: { enabled: true, time: '00:00', folder } })
  const second = await launch(userData)
  await expect(second.page.getByTestId('home')).toBeVisible()
  const file = join(folder, `${yesterday}.md`)
  const todays = join(folder, `${today()}.md`)
  // One check does both, yesterday first: close the missed day, then write today.
  await expect.poll(() => existsSync(file) && existsSync(todays), { timeout: 90_000, intervals: [1_000] }).toBe(true)
  const md = readFileSync(file, 'utf8')
  expect(md).toContain('- [x] Finished yesterday')
  expect(md).toContain('Yesterday I wrote this.')
  expect(md).not.toContain('Done today')
  const closed = (await bridge(second.page, 'getEod', yesterday))!
  expect(closed).toMatchObject({ day: yesterday, closed: true, notes: 'Yesterday I wrote this.' })
  expect(closed.tasksDone.map((t) => t.title)).toEqual(['Finished yesterday'])
  expect((await bridge(second.page, 'listEodDays'))!.find((d) => d.day === yesterday)).toMatchObject({ tasksDone: 1, hasFile: true })

  // Run 3: yesterday is closed, so it is not written again. Today's file is deleted first: it comes back only when the
  // first check has run (catch-up is the first step of it), so its return is the moment to look at yesterday's file.
  writeFileSync(file, `${md}\nEDITED BY HAND\n`)
  await closeApps()
  rmSync(todays)
  await launch(userData)
  await expect.poll(() => existsSync(todays), { timeout: 90_000, intervals: [1_000] }).toBe(true)
  expect(readFileSync(file, 'utf8')).toContain('EDITED BY HAND')
  expect(readFileSync(todays, 'utf8')).toContain('Done today')
})

test('a report folder that cannot be made is answered with the reason, and nothing else breaks', async () => {
  const userData = profile('blocked')
  writeFileSync(join(userData, 'blocker'), 'a file where a folder is needed')
  config(userData, { eod: { enabled: false, folder: join(userData, 'blocker', 'reports') } })
  const { page } = await live(userData)
  const r = await bridge(page, 'writeEod', today())
  expect(r).toMatchObject({ ok: false, error: expect.stringContaining('could not write') })
  expect(readdirSync(userData).filter((f) => f.endsWith('.md') || f.endsWith('.tmp'))).toEqual([])
  expect(await bridge(page, 'listTasks')).toEqual([]) // the window and the collector are fine
})

test('when the collector crashes and restarts, tasks and notes are still there and a call in the gap fails plainly', async () => {
  await clearOfMidnight()
  const userData = profile('crash')
  const { page, endpoint } = await live(userData)
  const kept = taskOf(await bridge(page, 'addTask', { title: 'Survives the crash', project: null }))
  await bridge(page, 'saveEodNotes', today(), 'Notes before the crash.')

  process.kill(await collectorPid(endpoint))
  // Main restarts it (ADR-0002). A call made meanwhile is answered, never thrown or left hanging: ok, or a plain reason.
  const added: string[] = []
  await expect
    .poll(
      async () => {
        const r = await bridge(page, 'addTask', { title: `After the crash ${added.length}`, project: null })
        if (r.ok) added.push(r.task.title)
        else expect(r.error).toMatch(/collector|starting/i)
        return r.ok
      },
      { timeout: 30_000, intervals: [250] }
    )
    .toBe(true)
  expect((await bridge(page, 'listTasks'))!.map((t) => t.title)).toEqual([kept.title, ...added])
  expect((await bridge(page, 'getEod', today()))!.notes).toBe('Notes before the crash.')

  // The restarted collector takes hooks again, and the report sees them.
  await playSession(await collectorReady(userData), 1)
  await untilTurns(page, 1)
})

// ---- Real time: tasks and the report follow the sessions. Written without a build to run them against: UNRUN. ----

/** A session that came from hooks is named after its folder, and that is what a task links to. */
const SESSION_NAME = SESSION_CWD.split('\\').pop()!

/** Counts what main pushes to this window as `work:changed`, from now on. */
async function countPushes(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const w = globalThis as unknown as { agentdeck: { onWorkChanged(l: () => void): () => void }; __pushes: number }
    w.__pushes = 0
    w.agentdeck.onWorkChanged(() => {
      w.__pushes++
    })
  })
  return () => page.evaluate(() => (globalThis as unknown as { __pushes: number }).__pushes)
}

const openPage = async (page: Page, name: 'Tasks' | 'Daily report'): Promise<void> => {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: new RegExp(`^${name}`) }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)
}
const figureOf = (page: Page, label: string) => page.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd')
const laneRows = (page: Page, lane: 'To do' | 'In progress' | 'Done today') => page.getByRole('region', { name: lane }).getByRole('listitem')

/** A task sent to the session a run of hooks will create (the way Send to an agent links it). */
async function sentTask(page: Page, title: string, sessionName = SESSION_NAME) {
  const added = taskOf(await bridge(page, 'addTask', { title, project: SESSION_CWD }))
  return taskOf(await bridge(page, 'updateTask', added.id, { status: 'doing', sessionName }))
}

test('a task follows its session to done, the open report page moves with it, and the file is refreshed', async () => {
  test.slow()
  await clearOfMidnight(240_000)
  const userData = profile('follow')
  const folder = join(userData, 'daily')
  // The report time was a minute ago: the first check (15 s after launch) publishes; later rewrites come from work-changed.
  const now = new Date()
  const minutes = Math.max(0, now.getHours() * 60 + now.getMinutes() - 1)
  const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  config(userData, { eod: { enabled: true, time, folder } })
  const { page, endpoint } = await live(userData)
  const pushes = await countPushes(page)
  const task = await sentTask(page, 'Ship the invoice export')

  // The report is open before anything happens, and is never reloaded.
  await openPage(page, 'Daily report')
  await expect(figureOf(page, 'Sessions')).toHaveText('0')

  // The agent starts: the page shows the session without a reload, the task is still In progress.
  expect(await postHook(endpoint, { ...fixture('UserPromptSubmit-1'), session_id: SESSION_ID, cwd: SESSION_CWD, prompt: 'Add the invoice export' })).toBe(200)
  await expect(figureOf(page, 'Sessions')).toHaveText('1', { timeout: 10_000 })
  expect.soft(await pushes()).toBeGreaterThanOrEqual(1)
  expect(taskOf(await bridge(page, 'updateTask', task.id, {}))).toMatchObject({ status: 'doing', doneAt: null })

  // It finishes without asking anything: the task is done at that time, and the page counts it, still without a reload.
  const before = Date.now()
  await playSession(endpoint, 1)
  await expect.poll(async () => (await bridge(page, 'listTasks'))?.find((t) => t.id === task.id)?.status, { timeout: 10_000 }).toBe('done')
  const done = (await bridge(page, 'listTasks'))!.find((t) => t.id === task.id)!
  expect(done.doneAt).toBeGreaterThanOrEqual(before - 1_000)
  expect(done.doneAt).toBeLessThanOrEqual(Date.now() + 1_000)
  await expect(figureOf(page, 'Tasks done')).toHaveText('1', { timeout: 10_000 })
  await expect(figureOf(page, 'Turns')).toHaveText('1')
  await expect(page.getByText(/^Updated \d{2}:\d{2}:\d{2}$/)).toBeVisible()

  // The file is rewritten on its own, about 30 s after the change at the latest (plus the settle time and a tick of slack).
  const file = join(folder, `${today()}.md`)
  const text = (): string => (existsSync(file) ? readFileSync(file, 'utf8') : '')
  await expect.poll(text, { timeout: 90_000, intervals: [1_000] }).toContain('- [x] Ship the invoice export')
  expect(readdirSync(folder).some((f) => f.endsWith('.tmp'))).toBe(false)

  // The card says who finished it, and Undo moves it back.
  await openPage(page, 'Tasks')
  const card = laneRows(page, 'Done today').filter({ hasText: 'Ship the invoice export' })
  await expect(card).toContainText('Done by its agent')
  await card.getByRole('button', { name: /^Undo/ }).click()
  await expect(laneRows(page, 'In progress').filter({ hasText: 'Ship the invoice export' })).toHaveCount(1)
  expect(taskOf(await bridge(page, 'updateTask', task.id, {}))).toMatchObject({ status: 'doing', doneAt: null })

  // The agent works again and finishes again: the user's undo stands, the task stays In progress.
  await playSession(endpoint, 2) // two more finished turns on top of the first: three in all
  await expect.poll(async () => (await bridge(page, 'getEod', today()))?.totals.turns, { timeout: 10_000 }).toBe(3)
  await page.waitForTimeout(2_000)
  expect(taskOf(await bridge(page, 'updateTask', task.id, {}))).toMatchObject({ status: 'doing', doneAt: null })
})

test('a session that ended by asking a question, a task nobody sent, and a task linked to another name all stay where they are', async () => {
  await clearOfMidnight()
  const { page, endpoint } = await live(profile('follow-stays'))
  const asked = await sentTask(page, 'Pick the export format')
  const plain = taskOf(await bridge(page, 'addTask', { title: 'Plain task', project: SESSION_CWD }))
  const stranger = await sentTask(page, 'Linked to another session', 'some-other-session')

  const send = async (name: string, extra: Record<string, unknown>): Promise<void> => {
    expect(await postHook(endpoint, { ...fixture(name), session_id: SESSION_ID, cwd: SESSION_CWD, ...extra })).toBe(200)
  }
  await send('UserPromptSubmit-1', { prompt: 'Export the invoices' })
  await send('Stop-1', { last_assistant_message: 'I can write CSV or JSON.\n\nWhich one do you want?' })
  await expect.poll(async () => (await bridge(page, 'getEod', today()))?.totals.turns, { timeout: 10_000 }).toBe(1)
  await page.waitForTimeout(1_500)

  const tasks = (await bridge(page, 'listTasks'))!
  expect(tasks.find((t) => t.id === asked.id)).toMatchObject({ status: 'doing', doneAt: null })
  expect(tasks.find((t) => t.id === plain.id)).toMatchObject({ status: 'todo', doneAt: null })
  expect(tasks.find((t) => t.id === stranger.id)).toMatchObject({ status: 'doing', doneAt: null })

  // Answering in the terminal and finishing cleanly then completes the first, and only the first.
  await send('UserPromptSubmit-1', { prompt: 'CSV, please' })
  await send('Stop-2', { last_assistant_message: 'Wrote the CSV export.' })
  await expect.poll(async () => (await bridge(page, 'listTasks'))?.find((t) => t.id === asked.id)?.status, { timeout: 10_000 }).toBe('done')
  const after = (await bridge(page, 'listTasks'))!
  expect(after.find((t) => t.id === plain.id)?.status).toBe('todo')
  expect(after.find((t) => t.id === stranger.id)?.status).toBe('doing')
})

test('a burst of hook events reaches the window as a few pushes, not one per event, and Tasks shows the result without a reload', async () => {
  await clearOfMidnight()
  const { page, endpoint } = await live(profile('follow-burst'))
  const task = await sentTask(page, 'Burst task')
  await openPage(page, 'Tasks')
  await expect(laneRows(page, 'In progress').filter({ hasText: 'Burst task' })).toHaveCount(1)
  const pushes = await countPushes(page)

  await playSession(endpoint, 3) // about fifteen hook events in well under a second
  await expect(laneRows(page, 'Done today').filter({ hasText: 'Burst task' })).toHaveCount(1, { timeout: 10_000 })
  await page.waitForTimeout(1_500)
  const n = await pushes()
  expect(n).toBeGreaterThanOrEqual(1)
  expect(n).toBeLessThanOrEqual(5)
  expect(taskOf(await bridge(page, 'updateTask', task.id, {})).status).toBe('done')
})

test('while the day keeps changing, the report file is rewritten no more than every 30 s', async () => {
  test.setTimeout(240_000)
  await clearOfMidnight(240_000)
  const userData = profile('follow-cadence')
  const folder = join(userData, 'daily')
  const now = new Date()
  const minutes = Math.max(0, now.getHours() * 60 + now.getMinutes() - 1)
  config(userData, { eod: { enabled: true, time: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`, folder } })
  const { endpoint } = await live(userData)
  await playSession(endpoint, 1)
  const file = join(folder, `${today()}.md`)
  await expect.poll(() => existsSync(file), { timeout: 60_000, intervals: [1_000] }).toBe(true) // published

  // A new turn every 5 s for 75 s: every rewrite has new content, yet they cannot come faster than the gap.
  const stamps = new Set<number>([statSync(file).mtimeMs])
  const until = Date.now() + 75_000
  for (let turns = 2; Date.now() < until; turns++) {
    await playSession(endpoint, turns)
    stamps.add(statSync(file).mtimeMs)
    await new Promise((r) => setTimeout(r, 5_000))
  }
  stamps.add(statSync(file).mtimeMs)
  expect(stamps.size).toBeGreaterThanOrEqual(2) // it did follow the day
  expect(stamps.size).toBeLessThanOrEqual(5) // 75 s at one rewrite per 30 s, plus the publish and a boundary
})
