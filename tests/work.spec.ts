import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// Smoke tests for the Tasks page and the Daily report, in demo mode (fixed data, nothing is sent or written).
const MAIN = '.'
const SHOTS = 'test-results/work'

let app: ElectronApplication | undefined
let userData = ''
let pageErrors: string[] = []

function appEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('CLAUDE')) env[k] = v
  return { ...env, AGENTDECK_USER_DATA: userData, AGENTDECK_POLL: '0', AGENTDECK_THEME: 'light', CLAUDE_CONFIG_DIR: userData, CODEX_HOME: `${userData}/codex` }
}

async function open(config: Record<string, unknown> = {}, size = { width: 1440, height: 924 }): Promise<{ page: Page; errors: string[] }> {
  userData = mkdtempSync(join(tmpdir(), 'agentdeck-work-'))
  writeFileSync(join(userData, 'config.json'), JSON.stringify({ demo: true, ...config }))
  app = await electron.launch({ args: [MAIN], env: appEnv() })
  const page = await app.firstWindow()
  const errors: string[] = []
  pageErrors = errors
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  await app.evaluate(({ BrowserWindow }, s) => {
    const w = BrowserWindow.getAllWindows()[0]!
    w.unmaximize()
    w.setSize(s.width, s.height)
    w.center()
  }, size)
  await page.reload()
  await expect(page.getByTestId('home')).toBeVisible()
  await page.waitForFunction('document.fonts.status === "loaded"')
  return { page, errors }
}

test.afterEach(async () => {
  const info = test.info()
  if (info.status !== info.expectedStatus && pageErrors.length) console.error(`page errors in "${info.title}":\n${pageErrors.join('\n')}`)
  await app?.close().catch(() => undefined)
  app = undefined
  rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

const axe = async (page: Page): Promise<string[]> =>
  (await new AxeBuilder({ page }).setLegacyMode(true).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()).violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
  )

const goTo = async (page: Page, name: 'Tasks' | 'Daily report'): Promise<void> => {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: new RegExp(`^${name}`) }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)
}
const lane = (page: Page, name: 'To do' | 'In progress' | 'Done today') => page.getByRole('region', { name })
const rows = (page: Page, name: 'To do' | 'In progress' | 'Done today') => lane(page, name).getByRole('listitem')

test('Tasks: three lanes from demo data, agents beside tasks, live status on linked cards, axe clean', async () => {
  const { page, errors } = await open()
  await goTo(page, 'Tasks')

  await expect(rows(page, 'To do')).toHaveCount(4)
  await expect(rows(page, 'In progress')).toHaveCount(6)
  await expect(rows(page, 'Done today')).toHaveCount(3)
  await expect(page.getByText('Today', { exact: true })).toBeVisible()

  // A task sent to an agent carries that session's live status; a session no task owns is an agent row.
  const portal = rows(page, 'In progress').filter({ hasText: 'Move Northwind orders to the v2 API' })
  await expect(portal).toContainText('Needs you')
  await expect(portal).toContainText('portal-migration')
  const agent = rows(page, 'In progress').filter({ hasText: 'Agent session' }).filter({ hasText: 'agentdeck-ui' })
  await expect(agent).toContainText('Working')
  await expect(rows(page, 'Done today').filter({ hasText: 'invoice-pdf' })).toContainText('Failed')

  // An agent row opens the session drawer, and Escape gives focus back to it.
  const opener = agent.getByRole('button', { name: 'agentdeck-ui' })
  await opener.click()
  await expect(page.getByRole('dialog', { name: /agentdeck-ui/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(opener).toBeFocused()

  mkdirSync(SHOTS, { recursive: true })
  await page.mouse.move(0, 0)
  await page.screenshot({ path: join(SHOTS, 'tasks-1440.png') })
  expect(await page.getByTestId('home').evaluate((m) => m.scrollWidth > m.clientWidth)).toBe(false)
  expect(await axe(page)).toEqual([])
  expect(errors).toEqual([])
})

test('Tasks: add with Enter, start, mark done, undo, rename, delete and undo the delete', async () => {
  const { page, errors } = await open()
  await goTo(page, 'Tasks')
  const input = page.getByRole('combobox', { name: 'Add a task' })
  const add = page.getByRole('button', { name: 'Add', exact: true })

  // Empty: Add says why it does nothing, and nothing is added.
  await expect(add).toHaveAttribute('aria-disabled', 'true')
  await input.press('Enter')
  await expect(rows(page, 'To do')).toHaveCount(4)

  await input.fill('Draft the Q4 billing summary')
  await input.press('Enter')
  const mine = rows(page, 'To do').filter({ hasText: 'Draft the Q4 billing summary' })
  await expect(mine).toHaveCount(1)
  await expect(input).toHaveValue('')
  await expect(input).toBeFocused() // ready for the next one
  await expect(page.getByRole('status').filter({ hasText: 'Added to To do: Draft the Q4 billing summary' })).toBeAttached()

  // Start moves it to In progress and keeps the keyboard on its checkbox.
  await mine.getByRole('button', { name: /^More:/ }).click()
  await page.getByRole('menuitem', { name: 'Start' }).click()
  const started = rows(page, 'In progress').filter({ hasText: 'Draft the Q4 billing summary' })
  await expect(started).toHaveCount(1)
  await expect(started.getByRole('checkbox')).toBeFocused()

  // Marking it done moves it to Done today; the same checkbox brings it back.
  await page.keyboard.press('Space')
  const finished = rows(page, 'Done today').filter({ hasText: 'Draft the Q4 billing summary' })
  await expect(finished).toHaveCount(1)
  await expect(finished.getByRole('checkbox')).toBeChecked()
  await expect(finished.getByRole('checkbox')).toBeFocused()
  await page.keyboard.press('Space')
  await expect(rows(page, 'To do').filter({ hasText: 'Draft the Q4 billing summary' })).toHaveCount(1)

  // Rename in place: Escape cancels, Enter saves.
  const todo = rows(page, 'To do').filter({ hasText: 'Draft the Q4 billing summary' })
  await todo.getByRole('button', { name: /^More:/ }).click()
  await page.getByRole('menuitem', { name: 'Edit title' }).click()
  const edit = page.getByRole('textbox', { name: 'Task title' }) // the row's text is the field's value now, so find it on the page
  await expect(edit).toBeFocused()
  await edit.fill('Something else')
  await edit.press('Escape')
  await expect(rows(page, 'To do').filter({ hasText: 'Draft the Q4 billing summary' })).toHaveCount(1)
  await rows(page, 'To do').filter({ hasText: 'Draft the Q4 billing summary' }).getByText('Draft the Q4 billing summary').dblclick()
  await page.getByRole('textbox', { name: 'Task title' }).fill('Draft the Q4 billing summary for finance')
  await page.keyboard.press('Enter')
  const renamed = rows(page, 'To do').filter({ hasText: 'for finance' })
  await expect(renamed).toHaveCount(1)

  // Delete offers Undo, with focus on it.
  await renamed.getByRole('button', { name: /^More:/ }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(renamed).toHaveCount(0)
  const undo = page.getByRole('button', { name: 'Undo' })
  await expect(undo).toBeFocused()
  await undo.click()
  await expect(rows(page, 'To do').filter({ hasText: 'for finance' })).toHaveCount(1)
  expect(await axe(page)).toEqual([])
  expect(errors).toEqual([])
})

test('Tasks: sending to an agent asks for a project when there is none, and demo sends nothing', async () => {
  const { page, errors } = await open()
  await goTo(page, 'Tasks')
  const notice = page.getByTestId('notice')

  // A task with a project goes straight to dispatch; demo says so and changes nothing.
  const keyed = rows(page, 'To do').filter({ hasText: 'Add idempotency keys' })
  await keyed.getByRole('button', { name: /^Send to an agent:/ }).click()
  await expect(notice).toHaveText('Demo data: nothing was dispatched.')
  await expect(keyed).toHaveCount(1)

  // A task with no project asks which one first, with the composer's menu.
  const loose = rows(page, 'To do').filter({ hasText: 'Reply to Northwind' })
  await loose.getByRole('button', { name: /^Send to an agent:/ }).click()
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem', { name: /billing-api/ })).toBeVisible()
  await menu.getByRole('menuitem', { name: /billing-api/ }).click()
  await expect(notice).toHaveText('Demo data: nothing was dispatched.')
  expect(errors).toEqual([])
})

test('Daily report: days, document, totals led by agent time, every section, axe clean', async () => {
  const { page, errors } = await open()
  await goTo(page, 'Daily report')

  const rail = page.getByRole('navigation', { name: 'Report days' })
  await expect(rail.getByRole('button')).toHaveCount(6)
  await expect(rail.getByRole('button').first()).toContainText('Today')
  await expect(rail.getByRole('button').first()).toHaveAttribute('aria-current', 'date')
  await expect(rail.getByRole('button').first()).toContainText('Live')
  await expect(rail.getByRole('button', { name: /Yesterday/ })).toContainText('Closed')

  const doc = page.getByRole('region').filter({ has: page.locator('#eod-day') })
  const totals = doc.locator('dl')
  await expect(totals.getByText('Agent time')).toBeVisible()
  for (const label of ['Sessions', 'Turns', 'Files changed', 'Approvals answered', 'Tasks done']) await expect(totals.getByText(label, { exact: true })).toBeVisible()
  // Agent time is the largest figure on the page.
  const sizes = (await page.evaluate("Array.from(document.querySelectorAll('dl dd')).map((e) => parseFloat(getComputedStyle(e).fontSize))")) as number[]
  expect(sizes).toHaveLength(6)
  expect(sizes[0]).toBeGreaterThan(Math.max(...sizes.slice(1)))
  for (const h of ['Done', 'Agent work by project', 'Needs you', 'Tomorrow', 'Notes']) await expect(doc.getByRole('heading', { level: 3, name: new RegExp(`^${h}`) })).toBeVisible()
  await expect(page.getByText(/(Published at 18:00, kept up to date until midnight|Will be published at 18:00) · folder/)).toBeVisible()

  // The blockers are today's open items; the quiet day has none.
  await expect(doc.getByRole('region', { name: /^Needs you/ }).getByRole('listitem')).toHaveCount(4)
  await rail.getByRole('button').nth(3).click() // three days back: the day with failures
  await expect(doc.getByRole('region', { name: /^Needs you/ }).getByRole('listitem')).toHaveCount(3)
  await expect(doc.getByText('Failed').first()).toBeVisible()

  mkdirSync(SHOTS, { recursive: true })
  await rail.getByRole('button').first().click()
  await page.mouse.move(0, 0)
  await page.screenshot({ path: join(SHOTS, 'report-1440.png') })
  await doc.getByRole('heading', { level: 3, name: /^Agent work by project/ }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(SHOTS, 'report-1440-projects.png') })
  expect(await axe(page)).toEqual([])
  expect(errors).toEqual([])
})

test('Daily report: notes autosave after a pause, survive switching days, and closed days stay editable only there', async () => {
  const { page, errors } = await open()
  await goTo(page, 'Daily report')
  const notes = page.getByRole('textbox', { name: 'Notes' })

  await notes.fill('Ship the Stripe retries first thing tomorrow.')
  await expect(page.getByText('Saving…')).toBeVisible() // pending, before the 0.8 s pause ends
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 5_000 })

  // Type, then leave straight away: the unsaved text is sent as the field goes.
  const rail = page.getByRole('navigation', { name: 'Report days' })
  await notes.fill('Ship the Stripe retries first thing tomorrow. Then the invoice footer.')
  await rail.getByRole('button', { name: /Yesterday/ }).click()
  await expect(page.locator('#eod-day')).toBeVisible()
  await expect(page.getByText('Final version')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Notes' })).toHaveValue('')
  await rail.getByRole('button', { name: /Today/ }).click()
  await expect(page.getByRole('textbox', { name: 'Notes' })).toHaveValue('Ship the Stripe retries first thing tomorrow. Then the invoice footer.')

  // A closed day takes notes too.
  await rail.getByRole('button', { name: /Yesterday/ }).click()
  await page.getByRole('textbox', { name: 'Notes' }).fill('Yesterday in one line.')
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 5_000 })
  expect(errors).toEqual([])
})

test('Daily report: toolbar acts, and demo data writes and opens nothing', async () => {
  const { page, errors } = await open()
  await goTo(page, 'Daily report')
  const notice = page.getByTestId('notice')

  await page.getByRole('button', { name: 'Write file now' }).click()
  await expect(notice).toHaveText('Demo data: nothing was written.')
  await page.getByRole('button', { name: 'Open folder' }).click()
  await expect(notice).toHaveText('Demo data: nothing was opened.')
  await page.getByRole('button', { name: 'Copy as Markdown' }).click()
  await expect(notice).toHaveText('Copied the report as Markdown.')
  expect(errors).toEqual([])
})

test('Daily report off: the status line says so and links to Settings', async () => {
  const { page, errors } = await open({ eod: { enabled: false } })
  await goTo(page, 'Daily report')
  await expect(page.getByText('Daily report is off.')).toBeVisible()
  await page.getByRole('button', { name: 'Turn it on in Settings' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings')
  expect(errors).toEqual([])
})

test('both pages hold at the minimum window: lanes stack, no horizontal scroll, axe clean', async () => {
  const { page, errors } = await open({}, { width: 1200, height: 760 })
  for (const name of ['Tasks', 'Daily report'] as const) {
    await goTo(page, name)
    expect(await page.evaluate<boolean>('document.documentElement.scrollWidth > window.innerWidth')).toBe(false)
    expect(await page.getByTestId('home').evaluate((m) => m.scrollWidth > m.clientWidth)).toBe(false)
    if (name === 'Tasks') {
      const todo = await lane(page, 'To do').boundingBox()
      const doing = await lane(page, 'In progress').boundingBox()
      expect(todo && doing && doing.y >= todo.y + todo.height).toBe(true) // stacked, not side by side
    }
    await page.mouse.move(0, 0)
    mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: join(SHOTS, `${name === 'Tasks' ? 'tasks' : 'report'}-1200.png`) })
    expect(await axe(page)).toEqual([])
  }
  expect(errors).toEqual([])
})
