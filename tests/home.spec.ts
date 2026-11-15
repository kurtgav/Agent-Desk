import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// `.` launches via package.json "main", so app.getVersion() is ours (0.1.0), not Electron's.
const MAIN = '.'
const EVIDENCE = 'docs/evidence'

let app: ElectronApplication | undefined
let userData = ''
/** The open window's console errors and page errors; printed when a test fails, so CI shows what broke. */
let pageErrors: string[] = []

/** Strip CLAUDE* so a dev run inside Claude Code can't leak into the app (F8); never poll the real machine (D-048). */
function appEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('CLAUDE')) env[k] = v
  return { ...env, AGENTDECK_USER_DATA: userData, AGENTDECK_POLL: '0', AGENTDECK_THEME: 'light', CLAUDE_CONFIG_DIR: userData }
}

/** These tests check the reference design against the fixed demo data (ADR-0011), so demo mode is seeded. */
async function open(width: number, height: number): Promise<{ page: Page; errors: string[] }> {
  userData = mkdtempSync(join(tmpdir(), 'agentdeck-home-'))
  writeFileSync(join(userData, 'config.json'), JSON.stringify({ demo: true }))
  app = await electron.launch({ args: [MAIN], env: appEnv() })
  const page = await app.firstWindow()
  const errors: string[] = []
  pageErrors = errors
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  await app.evaluate(({ BrowserWindow }, size) => {
    const w = BrowserWindow.getAllWindows()[0]!
    w.unmaximize()
    w.setSize(size.width, size.height)
    w.center()
  }, { width, height })
  // Reload so listeners see the whole load, including the first render.
  await page.reload()
  await expect(page.getByTestId('home')).toBeVisible()
  // String expressions: this tsconfig has no DOM lib, on purpose (it also types the main process).
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

test('Home renders demo data at the reference size with no console errors', async () => {
  const { page, errors } = await open(1440, 924)

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Good (morning|afternoon|evening), Kurt$/)
  await expect(page.getByRole('complementary', { name: 'Sidebar' })).toContainText('AgentDeck 0.1.0')
  await expect(page.getByText('3 things need your OK. Agents finished 6 tasks while you were away.')).toBeVisible()
  await expect(page.getByRole('banner').getByText('Demo data', { exact: true })).toBeVisible()

  const kpi = (label: string) => page.getByRole('region', { name: label })
  await expect(kpi('Agent time this week')).toContainText('14h 25m')
  await expect(kpi('Tasks finished')).toContainText('31')
  await expect(kpi('Waiting for you')).toContainText('4')
  await expect(kpi('Files changed')).toContainText('23')

  const needs = page.getByRole('region', { name: 'Needs you' })
  await expect(needs.getByRole('listitem')).toHaveCount(3)
  await expect(needs.getByRole('button', { name: 'See all (2 more)' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Running now' }).getByRole('progressbar')).toHaveCount(4)
  await expect(page.getByRole('region', { name: 'Your agents' }).getByRole('listitem')).toHaveCount(6)

  mkdirSync(EVIDENCE, { recursive: true })
  await page.mouse.move(0, 0)
  await page.screenshot({ path: join(EVIDENCE, 'm1-home.png') })
  const overflowPx = await page.getByTestId('home').evaluate((m) => m.scrollHeight - m.clientHeight)
  expect(overflowPx, 'Home fits the reference window without scrolling').toBe(0)
  expect(errors).toEqual([])
})

test('risky held approval asks first, then answers locally in demo', async () => {
  const { page, errors } = await open(1440, 924)
  const needs = page.getByRole('region', { name: 'Needs you' })
  const row = needs.getByRole('listitem').filter({ hasText: 'git push --force-with-lease' })
  await expect(row).toContainText('Force push')

  await row.getByRole('button', { name: 'Approve' }).click()
  const dialog = page.getByRole('dialog', { name: 'Approve a risky request?' })
  await expect(dialog).toContainText('git push --force-with-lease origin feat/stripe-webhooks')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(row).toBeVisible()

  await row.getByRole('button', { name: 'Approve' }).click()
  await dialog.getByRole('button', { name: 'Approve' }).click()
  await expect(row).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: /^Approved in demo: Run git push .* Nothing was sent\.$/ })).toBeAttached()
  await expect(page.getByText('2 things need your OK.', { exact: false })).toBeVisible()
  expect(errors).toEqual([])
})

test('a Running now row opens the session drawer; demo actions run nothing; Esc closes it', async () => {
  const { page, errors } = await open(1440, 924)
  const running = page.getByRole('region', { name: 'Running now' })
  const first = running.getByRole('listitem').first().getByRole('button').first()
  const name = (await first.innerText()).trim()
  await first.click()

  const drawer = page.getByRole('dialog', { name })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('tab', { name: 'Timeline' })).toHaveAttribute('aria-selected', 'true')
  await expect(drawer.getByRole('tabpanel')).toContainText('You sent a prompt')
  await drawer.getByRole('tab', { name: 'Plan' }).click()
  await expect(drawer.getByRole('tabpanel')).toBeVisible()

  await drawer.getByRole('button', { name: 'Copy resume command' }).click()
  await expect(page.getByTestId('notice')).toHaveText('Demo data: nothing was run.')

  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  // Focus goes back to the row that opened it, not to the top of the page.
  await expect(first).toBeFocused()
  expect(errors).toEqual([])
})

test('composer: Shift+Enter adds a line, @ brings an agent in as a chip, Run in the background sends nothing in demo', async () => {
  const { page, errors } = await open(1440, 924)
  const box = page.locator('#composer-input')
  const send = page.getByRole('button', { name: 'Start conversation' })
  await expect(send).toHaveAttribute('aria-disabled', 'true')
  await box.fill('Fix the flaky login test')
  await expect(send).toHaveAttribute('aria-disabled', 'false')
  await box.press('Shift+Enter')
  await box.pressSequentially('and the retry')
  await expect(box).toHaveValue('Fix the flaky login test\nand the retry')

  // An agent installed in Claude Code can lead a background session: @ writes it into the text, and a chip mirrors it.
  await box.press('Control+Home')
  await box.pressSequentially('@code-rev')
  await expect(page.getByRole('listbox', { name: 'Agents' })).toBeVisible()
  await box.press('Enter')
  await expect(box).toHaveValue(/^@code-reviewer Fix the flaky login test\nand the retry$/)
  await expect(page.getByRole('group', { name: 'Agents in this message' })).toContainText('code-reviewer')
  await expect(box).toBeFocused()

  await page.getByRole('button', { name: 'Run in the background' }).click()
  await expect(page.getByTestId('notice')).toHaveText('Demo data: nothing was dispatched.')
  await expect(box).toHaveValue(/@code-reviewer/)
  expect(errors).toEqual([])
})

/** D-033 is retired: no control may promise a later milestone, so every page and menu is checked for what used to mark one. */
async function expectNoPending(page: Page): Promise<void> {
  await expect(page.locator('[data-pending]')).toHaveCount(0)
  await expect(page.getByText(/Arrives with/)).toHaveCount(0)
}

test('no control promises a later milestone, and the working ones work', async () => {
  const { page, errors } = await open(1440, 924)
  await expectNoPending(page)

  const main = page.getByRole('navigation', { name: 'Main' })
  for (const name of ['Tasks', 'Sessions', 'Approvals', 'Files', 'Activity', 'Daily report', 'Home']) {
    // Approvals carries its open count in its name ("Approvals 2 open").
    const item = main.getByRole('button', { name: new RegExp(`^${name}( [0-9]+ open)?$`) })
    await item.click()
    await expect(item).toHaveAttribute('aria-current', 'page')
    await expectNoPending(page)
  }
  await page.getByRole('button', { name: /^Roles/ }).click()
  await expectNoPending(page)

  // The gear and the user block both open Settings, which has every section.
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  for (const title of ['Profile', 'Daily report', 'Notifications', 'Startup', 'Integration', 'Diagnostics']) {
    await expect(page.getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible()
  }
  await expectNoPending(page)
  await main.getByRole('button', { name: 'Home' }).click()
  await page.getByRole('button', { name: /Your profile$/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()

  // ⋯ › Diagnostics and ⋯ › Settings are ordinary menu items now; the switcher's Diagnostics too.
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Settings' })).not.toHaveAttribute('aria-disabled', 'true')
  await page.getByRole('menuitem', { name: 'Diagnostics' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Diagnostics' })).toBeInViewport()
  await page.getByRole('button', { name: 'Third Code workspace menu' }).click()
  await page.getByRole('menuitem', { name: 'Diagnostics' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Diagnostics' })).toBeInViewport()

  await expect(page.getByRole('button', { name: 'Enable usage' })).toHaveCount(0)
  await expectNoPending(page)

  // Working controls in M1: New task focuses the composer, effort cycles, sidebar toggles keep focus.
  await main.getByRole('button', { name: 'Home' }).click()
  await page.getByRole('banner').getByRole('button', { name: 'New task' }).click()
  await expect(page.locator('#composer-input')).toBeFocused()
  await page.getByRole('button', { name: /^Effort: High/ }).click()
  await page.getByRole('menuitemradio', { name: 'Extra high' }).click()
  await expect(page.getByRole('button', { name: 'Effort: Extra high. Change effort' })).toBeVisible()
  await page.getByRole('button', { name: 'Collapse sidebar' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeFocused()
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible() // collapsed, the gear stays
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeFocused()
  expect(errors).toEqual([])
})

test('Home has no axe violations (WCAG 2.x A/AA)', async () => {
  const { page, errors } = await open(1440, 924)
  // Legacy mode: the default mode opens a helper page, which Electron's CDP target doesn't support.
  const results = await new AxeBuilder({ page }).setLegacyMode(true).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  expect(errors).toEqual([])
})

const axe = async (page: Page): Promise<string[]> =>
  (await new AxeBuilder({ page }).setLegacyMode(true).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()).violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
  )

test('the sidebar opens every list page, each passes axe, and the breadcrumb and g-keys find the way back', async () => {
  const { page, errors } = await open(1440, 924)
  const nav = page.getByRole('navigation', { name: 'Main' })
  const title = page.getByRole('heading', { level: 1 })
  const crumb = page.getByRole('navigation', { name: 'Breadcrumb' })

  await nav.getByRole('button', { name: 'Sessions' }).click()
  await expect(title).toHaveText('Sessions')
  await expect(crumb.locator('[aria-current=page]')).toHaveText('Sessions')
  await expect(page.getByRole('region', { name: 'Sessions' }).getByRole('listitem')).toHaveCount(8)
  await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Failed' }).click()
  await expect(page.getByRole('region', { name: 'Sessions' }).getByRole('listitem')).toHaveCount(1)
  expect(await axe(page)).toEqual([])

  await nav.getByRole('button', { name: /^Approvals/ }).click()
  await expect(page.getByRole('region', { name: 'Waiting for your OK' }).getByRole('listitem')).toHaveCount(3)
  await expect(page.getByRole('region', { name: 'Audit log' })).toContainText('Approved once')
  expect(await axe(page)).toEqual([])

  await nav.getByRole('button', { name: 'Files' }).click()
  await expect(title).toHaveText('Files')
  expect(await page.locator('main section').count()).toBeGreaterThan(1) // one card per project
  expect(await axe(page)).toEqual([])

  await nav.getByRole('button', { name: 'Activity' }).click()
  await expect(page.getByRole('region', { name: 'Events' }).getByRole('listitem').first()).toBeVisible()
  expect(await axe(page)).toEqual([])

  await nav.getByRole('button', { name: 'Tasks' }).click()
  await expect(title).toHaveText('Tasks')
  await expect(page.getByRole('region', { name: 'In progress' }).getByRole('listitem')).toHaveCount(3)
  await expect(page.getByRole('region', { name: 'Waiting on you' }).getByRole('listitem')).toHaveCount(4)
  expect(await axe(page)).toEqual([])

  await nav.getByRole('button', { name: 'Daily report' }).click()
  await expect(title).toHaveText('Daily report')
  await expect(page.getByRole('navigation', { name: 'Report days' }).getByRole('button')).toHaveCount(6)
  expect(await axe(page)).toEqual([])

  await page.getByRole('button', { name: /^Roles/ }).click()
  await expect(title).toHaveText('Roles')
  await expect(page.getByRole('region', { name: 'Leadership' })).toBeVisible()
  expect(await axe(page)).toEqual([])

  await crumb.getByRole('button', { name: 'Home' }).click()
  await expect(title).toHaveText(/^Good (morning|afternoon|evening), Kurt$/)
  await page.locator('body').press('g')
  await page.locator('body').press('a')
  await expect(title).toHaveText('Approvals')
  await page.locator('body').press('g')
  await page.locator('body').press('h')
  await expect(title).toHaveText(/^Good/)
  expect(errors).toEqual([])
})

test('avatar stack and View all open active sessions; Ctrl+K finds a session and opens its drawer', async () => {
  const { page, errors } = await open(1440, 924)
  const pressed = page.getByRole('group', { name: 'Status' }).locator('[aria-pressed=true]')

  await page.getByRole('banner').getByRole('button', { name: /active sessions$/ }).click()
  await expect(pressed).toHaveText('Active')
  await expect(page.getByRole('region', { name: 'Sessions' }).getByRole('listitem')).toHaveCount(5)

  await page.keyboard.press('Control+K')
  const palette = page.getByRole('dialog', { name: 'Search AgentDeck' })
  await expect(palette).toBeVisible()
  expect(await axe(page)).toEqual([])
  await palette.getByRole('combobox').fill('stripe')
  await expect(palette.getByRole('option', { selected: true })).toContainText('stripe-webhooks')
  await page.keyboard.press('Enter')
  await expect(palette).toBeHidden()
  await expect(page.getByRole('dialog', { name: /stripe-webhooks/ })).toBeVisible()
  await page.keyboard.press('Escape')

  // Closed with Ctrl+K it forgets what was typed; either way, focus goes back to what opened it.
  const searchButton = page.getByRole('button', { name: 'Search', exact: true })
  await searchButton.click()
  await page.getByRole('combobox').fill('stripe')
  await page.keyboard.press('Control+K')
  await expect(palette).toBeHidden()
  await expect(searchButton).toBeFocused()
  await page.keyboard.press('Control+K')
  await expect(page.getByRole('combobox')).toHaveValue('')
  await page.keyboard.press('Escape')
  await expect(searchButton).toBeFocused()

  await page.keyboard.press('Control+K')
  await page.getByRole('combobox').fill('new task')
  await page.keyboard.press('Enter')
  await expect(page.locator('#composer-input')).toBeFocused()
  expect(errors).toEqual([])
})

test('minimum window wraps the right column below the main one', async () => {
  const { page, errors } = await open(1200, 760)
  const needs = await page.getByRole('region', { name: 'Needs you' }).boundingBox()
  const files = await page.getByRole('region', { name: 'Recent files' }).boundingBox()
  expect(needs && files && files.y > needs.y + needs.height).toBe(true)
  const overflowX = await page.evaluate<boolean>('document.documentElement.scrollWidth > window.innerWidth')
  expect(overflowX).toBe(false)
  await page.mouse.move(0, 0)
  await page.screenshot({ path: join(EVIDENCE, 'm1-home-1200.png') })
  expect(errors).toEqual([])
})
