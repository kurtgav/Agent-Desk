import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { fixture } from '../src/collector/fixtures'
import { dayKey } from '../src/shared/day'
import { SESSION_CWD, bridge, cleanup, clearOfMidnight, closeApps, collectorReady, launch, playSession, postHook, profile, taskOf } from './support'

// The Tasks page, the Daily report and Settings in live mode: the real collector behind the real pages, a temp profile.

test.afterEach(cleanup)

const today = (): string => dayKey(Date.now())
const config = (userData: string, value: Record<string, unknown>): void => writeFileSync(join(userData, 'config.json'), JSON.stringify(value))
const readConfig = (userData: string): { profile?: { name?: string }; eod?: { time?: string } } => JSON.parse(readFileSync(join(userData, 'config.json'), 'utf8'))

async function live(userData: string) {
  const { app, page, errors } = await launch(userData)
  await expect(page.getByTestId('home')).toBeVisible()
  return { app, page, errors, endpoint: await collectorReady(userData) }
}

const goTo = async (page: Page, name: 'Tasks' | 'Daily report'): Promise<void> => {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: new RegExp(`^${name}`) }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)
}
const rows = (page: Page, lane: 'To do' | 'In progress' | 'Done today') => page.getByRole('region', { name: lane }).getByRole('listitem')
const figure = (page: Page, label: string) => page.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd')

test('Tasks: a task added on the page is saved, and its place survives a reload', async () => {
  const userData = profile('ui-tasks')
  const { page, errors } = await live(userData)
  await goTo(page, 'Tasks')
  await expect(rows(page, 'To do')).toHaveCount(0)

  const input = page.getByRole('combobox', { name: 'Add a task' })
  await input.fill('Reconcile the March invoices')
  await input.press('Enter')
  await expect(rows(page, 'To do').filter({ hasText: 'Reconcile the March invoices' })).toHaveCount(1)
  await expect(input).toHaveValue('')
  expect(await bridge(page, 'listTasks')).toMatchObject([{ title: 'Reconcile the March invoices', status: 'todo', doneAt: null }])

  await page.reload()
  await expect(page.getByTestId('home')).toBeVisible()
  await goTo(page, 'Tasks')
  const mine = rows(page, 'To do').filter({ hasText: 'Reconcile the March invoices' })
  await expect(mine).toHaveCount(1)

  // The check button finishes it: it moves to Done today, is stamped in the collector, and is still there after a reload.
  await mine.getByRole('checkbox').click()
  await expect(rows(page, 'Done today').filter({ hasText: 'Reconcile the March invoices' })).toHaveCount(1)
  const [saved] = (await bridge(page, 'listTasks'))!
  expect(saved).toMatchObject({ status: 'done' })
  expect(saved!.doneAt).not.toBeNull()
  await page.reload()
  await expect(page.getByTestId('home')).toBeVisible()
  await goTo(page, 'Tasks')
  await expect(rows(page, 'Done today').filter({ hasText: 'Reconcile the March invoices' })).toHaveCount(1)
  await expect(rows(page, 'To do')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('Daily report: live totals, follows new activity, notes autosave, and Write file now writes the file', async () => {
  await clearOfMidnight()
  const userData = profile('ui-report')
  const folder = join(userData, 'reports')
  config(userData, { eod: { enabled: false, folder } })
  const { page, errors, endpoint } = await live(userData)
  taskOf(await bridge(page, 'updateTask', taskOf(await bridge(page, 'addTask', { title: 'Ship the invoice export', project: SESSION_CWD })).id, { status: 'done' }))
  taskOf(await bridge(page, 'addTask', { title: 'Plan the Q1 rollout', project: null }))
  await playSession(endpoint, 2)
  await expect.poll(async () => (await bridge(page, 'getEod', today()))?.totals.turns).toBe(2)

  await goTo(page, 'Daily report')
  const rail = page.getByRole('navigation', { name: 'Report days' })
  await expect(rail.getByRole('button')).toHaveCount(1)
  await expect(rail.getByRole('button').first()).toContainText('Today')
  await expect(rail.getByRole('button').first()).toContainText('Live')
  const doc = page.getByRole('region').filter({ has: page.locator('#eod-day') })
  await expect(figure(page, 'Sessions')).toHaveText('1')
  await expect(figure(page, 'Turns')).toHaveText('2')
  await expect(figure(page, 'Files changed')).toHaveText('2')
  await expect(figure(page, 'Approvals answered')).toHaveText('0')
  await expect(figure(page, 'Tasks done')).toHaveText('1')
  await expect(figure(page, 'Agent time')).not.toHaveText(/^0m/)
  await expect(doc.getByRole('region', { name: /^Done/ })).toContainText('Ship the invoice export')
  await expect(doc.getByRole('region', { name: /^Agent work by project/ })).toContainText('acme-billing')
  await expect(doc.getByRole('region', { name: /^Tomorrow/ })).toContainText('Plan the Q1 rollout')
  await expect(doc.getByRole('region', { name: /^Needs you/ })).toContainText('Follow-up 2 done.')

  // New activity shows up without leaving the page (the report is read again when the snapshot changes).
  await postHook(endpoint, { ...fixture('UserPromptSubmit-1'), session_id: 'ui-report-2', cwd: SESSION_CWD, prompt: 'A third turn' })
  await postHook(endpoint, { ...fixture('Stop-2'), session_id: 'ui-report-2', cwd: SESSION_CWD, last_assistant_message: 'Third turn done.' })
  await expect(figure(page, 'Turns')).toHaveText('3', { timeout: 20_000 })
  await expect(figure(page, 'Sessions')).toHaveText('2')

  // Notes save by themselves 0.8 s after typing stops and are in the collector, then on the page after a reload.
  const notes = page.getByRole('textbox', { name: 'Notes' })
  await notes.fill('Finance owes me the VAT rate.')
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 5_000 })
  expect((await bridge(page, 'getEod', today()))!.notes).toBe('Finance owes me the VAT rate.')
  await page.reload()
  await expect(page.getByTestId('home')).toBeVisible()
  await goTo(page, 'Daily report')
  await expect(page.getByRole('textbox', { name: 'Notes' })).toHaveValue('Finance owes me the VAT rate.')

  expect(existsSync(folder), 'nothing is written until asked').toBe(false)
  await page.getByRole('button', { name: 'Write file now' }).click()
  const file = join(folder, `${today()}.md`)
  await expect(page.getByTestId('notice')).toHaveText('Wrote the report file.')
  await expect(page.getByText(file)).toBeVisible()
  const md = readFileSync(file, 'utf8')
  for (const part of ['Ship the invoice export', 'Plan the Q1 rollout', 'acme-billing', 'Finance owes me the VAT rate.', '2 sessions']) expect(md).toContain(part)
  // The rail's "File written" mark follows on its next read (the 30 s tick); the collector's list already has it.
  expect((await bridge(page, 'listEodDays'))![0]).toMatchObject({ day: today(), hasFile: true })
  expect(errors).toEqual([])
})

test('Settings: the name and the report time are saved, survive a relaunch, and the Sidebar shows the name', async () => {
  const userData = profile('ui-settings')
  const first = await live(userData)
  await first.page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(first.page.getByRole('heading', { level: 2, name: 'Profile' })).toBeVisible()

  const name = first.page.getByRole('textbox', { name: 'Name', exact: true })
  await name.fill('Sam Rivera')
  await name.press('Enter')
  await expect(first.page.getByRole('button', { name: /^Sam Rivera, AgentDeck .*Your profile$/ })).toBeVisible()
  const time = first.page.getByLabel('Publish at')
  await time.fill('17:45')
  await time.press('Enter')
  await expect.poll(() => [readConfig(userData).profile?.name, readConfig(userData).eod?.time]).toEqual(['Sam Rivera', '17:45'])
  await closeApps()

  const second = await live(userData)
  await expect(second.page.getByRole('button', { name: /^Sam Rivera, AgentDeck .*Your profile$/ })).toBeVisible()
  await second.page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(second.page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Sam Rivera')
  await expect(second.page.getByLabel('Publish at')).toHaveValue('17:45')
  await goTo(second.page, 'Daily report')
  await expect(second.page.getByText(/ublished at 17:45/)).toBeVisible()
  expect(second.errors).toEqual([])
})
