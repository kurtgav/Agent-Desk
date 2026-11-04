import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// `.` launches via package.json "main", so app.getVersion() is ours (0.1.0), not Electron's.
const MAIN = '.'
const EVIDENCE = 'docs/evidence'

let app: ElectronApplication | undefined
let userData = ''

/** Strip CLAUDE* so a dev run inside Claude Code can't leak into the app (F8). */
function appEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('CLAUDE')) env[k] = v
  return { ...env, AGENTDECK_USER_DATA: userData }
}

async function open(width: number, height: number): Promise<{ page: Page; errors: string[] }> {
  userData = mkdtempSync(join(tmpdir(), 'agentdeck-home-'))
  app = await electron.launch({ args: [MAIN], env: appEnv() })
  const page = await app.firstWindow()
  const errors: string[] = []
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

/** Everything a click could change: what's open, where we are, and the Home data on screen. */
async function observable(page: Page) {
  return {
    url: page.url(),
    layers: await page.locator('[role=dialog], [role=menu], [data-radix-popper-content-wrapper] [role=dialog]').count(),
    needs: await page.getByRole('region', { name: 'Needs you' }).innerText(),
    announcement: await page.locator('p[role=status]').innerText()
  }
}

test('later-milestone controls are inert and say when they arrive', async () => {
  const { page, errors } = await open(1440, 924)
  const before = await observable(page)

  // Every pending control on Home, activated by mouse and by keyboard, changes nothing.
  const controls = await page.locator('[data-pending]').all()
  expect(controls.length).toBeGreaterThan(10)
  for (const el of controls) {
    await expect(el).toHaveAttribute('aria-disabled', 'true')
    await el.click({ force: true }) // aria-disabled, so Playwright would refuse a normal click
    await el.focus()
    await page.keyboard.press('Enter')
    expect(await observable(page)).toEqual(before)
  }

  // Keyboard focus shows the explanation too (the loop above leaves focus on another control).
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /Search sessions/ }).focus()
  await expect(page.getByRole('tooltip')).toHaveText('Search: Arrives with live data (M2)')

  // Pending menu rows are reachable by keyboard, explain themselves, and keep the menu as it was.
  await page.getByRole('button', { name: 'More', exact: true }).click()
  const item = page.getByRole('menuitem', { name: /Diagnostics/ })
  await expect(item).toHaveAttribute('data-pending', 'M5')
  await expect(item).toContainText('Arrives with settings and diagnostics (M5)')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')

  // Working controls in M1: New task focuses the composer, effort cycles, sidebar toggles keep focus.
  await page.getByRole('banner').getByRole('button', { name: 'New task' }).click()
  await expect(page.locator('#composer-input')).toBeFocused()
  await page.getByRole('button', { name: /^Effort: High/ }).click()
  await expect(page.getByRole('button', { name: 'Effort: Extra high. Change effort' })).toBeVisible()
  await page.getByRole('button', { name: 'Collapse sidebar' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeFocused()
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
