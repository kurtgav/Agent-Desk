import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

/**
 * The Roles page (UI_MAP § Sidebar › Roles), in demo mode on a throwaway profile: the divisions, search, the detail drawer,
 * creating a role, pinning, the keyboard, and axe in light and dark. Demo roles live in memory, so nothing here touches a file
 * on this PC and no real role, path or name appears.
 */

const MAIN = '.'
let launched: ElectronApplication[] = []
let dirs: string[] = []

function appEnv(userData: string, theme: 'light' | 'dark'): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !key.startsWith('CLAUDE') && key !== 'AGENTDECK_THEME') env[key] = value
  return { ...env, AGENTDECK_USER_DATA: userData, AGENTDECK_POLL: '0', CLAUDE_CONFIG_DIR: userData, AGENTDECK_THEME: theme }
}

async function open(theme: 'light' | 'dark' = 'light', size = { width: 1440, height: 924 }): Promise<Page> {
  const userData = mkdtempSync(join(tmpdir(), 'agentdeck-roles-'))
  dirs.push(userData)
  writeFileSync(join(userData, 'config.json'), JSON.stringify({ demo: true, autostartConfigured: true, trayHintShown: true }))
  const app = await electron.launch({ args: [MAIN], env: appEnv(userData, theme) })
  launched.push(app)
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }, s) => {
    const w = BrowserWindow.getAllWindows()[0]!
    w.unmaximize()
    w.setSize(s.width, s.height)
    w.center()
  }, size)
  await expect(page.getByTestId('home')).toBeVisible()
  await page.waitForFunction('document.fonts.status === "loaded"')
  await page.getByRole('button', { name: /^Roles/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Roles' })).toBeVisible()
  return page
}

test.afterEach(async () => {
  await Promise.all(launched.map((app) => app.close().catch(() => undefined)))
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  launched = []
  dirs = []
})

const axe = async (page: Page): Promise<string[]> =>
  (await new AxeBuilder({ page }).setLegacyMode(true).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()).violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
  )

const cards = (page: Page) => page.locator('[data-role-card]')

test('the page shows the divisions with Leadership first, and the front page groups the cards', async () => {
  const page = await open()
  const rail = page.getByRole('navigation', { name: 'Divisions' })
  await expect(rail.getByRole('button').first()).toContainText('All roles')
  await expect(rail.getByRole('button', { name: /^Pinned/ })).toBeVisible()
  const labels = await rail.getByRole('button').allInnerTexts()
  expect(labels.findIndex((l) => l.startsWith('Leadership'))).toBeLessThan(labels.findIndex((l) => l.startsWith('Engineering')))
  expect(labels.some((l) => l.startsWith('Custom'))).toBe(true)
  expect(labels.some((l) => l.startsWith('Your agents'))).toBe(true)

  await expect(page.getByRole('region', { name: 'Leadership' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Pinned' })).toBeVisible()
  // Every id is on the page once, so the keyboard and the descriptions are sound.
  const ids = await Promise.all((await cards(page).all()).map((c) => c.getAttribute('data-role-card')))
  expect(ids.length).toBeGreaterThan(10)
  expect(new Set(ids).size).toBe(ids.length)
})

test('a division opens in full, and Show all does the same', async () => {
  const page = await open()
  await page.getByRole('navigation', { name: 'Divisions' }).getByRole('button', { name: /^Engineering/ }).click()
  await expect(cards(page)).toHaveCount(8)
  await expect(page.getByText('8 roles').first()).toBeVisible()
  await page.getByRole('navigation', { name: 'Divisions' }).getByRole('button', { name: /^All roles/ }).click()
  await page.getByRole('button', { name: /^Show all \d+ Marketing roles$/ }).click()
  await expect(cards(page).first()).toBeVisible()
  expect(await cards(page).count()).toBeGreaterThan(3)
})

test('search finds a role by name, by title and by the task you describe, and says why', async () => {
  const page = await open()
  const box = page.getByRole('searchbox', { name: 'Search roles' })
  await box.fill('cto')
  await expect(cards(page).first()).toHaveAttribute('data-role-card', 'cto')
  await box.fill('fronted developr')
  await expect(cards(page).first()).toHaveAttribute('data-role-card', 'frontend-developer')
  await box.fill('our postgres queries are slow')
  await expect(cards(page).first()).toHaveAttribute('data-role-card', 'database-optimizer')
  await expect(page.getByText(/matched: .*queries/).first()).toBeVisible()
  await expect(page.getByText('Ranked by fit for the task you described')).toBeVisible()
  await box.fill('zzzzqqqq')
  await expect(page.getByText(/No role matches/)).toBeVisible()
  await page.getByRole('button', { name: 'Clear search and filters' }).click()
  await expect(box).toHaveValue('')
  await expect(page.getByRole('region', { name: 'Leadership' })).toBeVisible()
})

test('the Installed filter keeps only installed roles, and "/" jumps to the search', async () => {
  const page = await open()
  await page.getByRole('button', { name: 'Installed in Claude Code' }).click()
  await expect(page.getByRole('button', { name: 'Installed in Claude Code' })).toHaveAttribute('aria-pressed', 'true')
  const texts = await cards(page).allInnerTexts()
  expect(texts.length).toBeGreaterThan(5)
  for (const t of texts) expect(t).toMatch(/Installed/)
  await page.getByRole('button', { name: 'Installed in Claude Code' }).click()
  await page.getByRole('main').click({ position: { x: 4, y: 4 } })
  await page.keyboard.press('/')
  await expect(page.getByRole('searchbox', { name: 'Search roles' })).toBeFocused()
})

test('a role opens in a drawer with what it is good for, whether it is installed, and its text', async () => {
  const page = await open()
  await cards(page).filter({ has: page.getByText('Founding Engineer') }).first().click()
  const drawer = page.getByRole('dialog')
  await expect(drawer.getByRole('heading', { name: 'Founding Engineer' })).toBeVisible()
  await expect(drawer.getByRole('button', { name: 'Start a conversation' })).toBeVisible()
  await expect(drawer.getByRole('button', { name: 'Send as a task' })).toBeVisible()
  await expect(drawer.getByRole('region', { name: 'Installed in Claude Code' })).toContainText('No')
  await expect(drawer.getByRole('region', { name: 'Role text' })).toContainText('Identity and memory')
  // The text is shown as text: nothing in it is a link, an image or a script.
  await expect(drawer.locator('[role="region"][aria-label="Role text"] a, [role="region"][aria-label="Role text"] img')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
})

test('Start a conversation goes to the Console with the role chosen', async () => {
  const page = await open()
  await cards(page).filter({ has: page.getByText('Founding Engineer') }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Start a conversation' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Console' })).toBeVisible()
})

test('Ctrl+K finds a role and opens its detail', async () => {
  const page = await open()
  await page.keyboard.press('Control+K')
  await page.getByRole('combobox', { name: /Search sessions/ }).fill('head of design')
  await expect(page.getByRole('option', { name: /Head of Design/ })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Head of Design' })).toBeVisible()
})

test('create a role: validation, a live preview, and the new role shows under Custom', async () => {
  const page = await open()
  await page.getByRole('button', { name: 'Create a role' }).click()
  const form = page.getByRole('dialog')
  await form.getByRole('button', { name: 'Create role' }).click()
  await expect(form.getByRole('alert').first()).toBeVisible()
  await form.getByLabel('Name').fill('Support Triage Lead')
  await form.getByLabel('Description').fill('Sorts incoming tickets by urgency.')
  await form.getByLabel('Role text').fill('# Support Triage Lead\n\nYou sort tickets.')
  await expect(form.getByText('Support Triage Lead').first()).toBeVisible() // the live preview card
  await form.getByRole('button', { name: 'Create role' }).click()
  await expect(page.getByRole('button', { name: 'Create role', exact: true })).toBeHidden() // the form closed; the new role's drawer is a dialog too
  // The new role's detail opens, and it is editable.
  const drawer = page.getByRole('dialog')
  await expect(drawer.getByRole('heading', { name: 'Support Triage Lead' })).toBeVisible()
  await expect(drawer.getByRole('button', { name: 'Edit' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('navigation', { name: 'Divisions' }).getByRole('button', { name: /^Custom/ }).click()
  await expect(cards(page).filter({ hasText: 'Support Triage Lead' })).toHaveCount(1)
})

test('a name another role has is refused, in words, next to the field', async () => {
  const page = await open()
  await page.getByRole('button', { name: 'Create a role' }).click()
  const form = page.getByRole('dialog')
  await form.getByLabel('Name').fill('CTO')
  await form.getByLabel('Description').fill('x')
  await form.getByLabel('Role text').fill('x')
  await form.getByRole('button', { name: 'Create role' }).click()
  await expect(form.getByRole('alert')).toContainText('already a role called')
})

test('duplicate a role to edit it, then delete the copy', async () => {
  const page = await open()
  await cards(page).filter({ has: page.getByText('Brand Guardian') }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Duplicate to edit' }).click()
  const drawer = page.getByRole('dialog')
  await expect(drawer.getByRole('heading', { name: 'Brand Guardian (copy)' })).toBeVisible()
  await drawer.getByRole('button', { name: 'Delete' }).click()
  await drawer.getByRole('button', { name: 'Delete', exact: true }).last().click()
  await expect(drawer).toBeHidden()
})

test('pin from the card, and the keyboard moves between cards: arrows, Home, End, P', async () => {
  const page = await open()
  const first = cards(page).first()
  await first.focus()
  await page.keyboard.press('ArrowRight')
  await expect(cards(page).nth(1)).toBeFocused()
  await page.keyboard.press('ArrowDown')
  expect(await page.locator(':focus').getAttribute('data-role-card')).toBeTruthy()
  await page.keyboard.press('Home')
  await expect(first).toBeFocused()
  await page.keyboard.press('End')
  expect(await page.locator(':focus').getAttribute('data-role-card')).not.toBe(await first.getAttribute('data-role-card'))
  // P pins the focused card: the Pinned count in the rail goes up by one.
  const rail = page.getByRole('navigation', { name: 'Divisions' }).getByRole('button', { name: /^Pinned/ })
  const before = Number((await rail.innerText()).match(/\d+/)![0])
  await page.keyboard.press('p')
  await expect(rail).toContainText(String(before + 1))
})

test('only one card is a tab stop, so Tab does not walk 50 cards', async () => {
  const page = await open()
  expect(await page.locator('[data-role-card][tabindex="0"]').count()).toBe(1)
})

test('Sources and updates says where roles come from and how to update them, with Copy', async () => {
  const page = await open()
  await page.getByRole('button', { name: 'Sources and updates' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Where roles come from' })).toBeVisible()
  await expect(dialog.getByText(/git -C ".*" pull/)).toBeVisible()
  await expect(dialog.getByText('AgentDeck itself never fetches anything.')).toBeVisible()
  await expect(dialog.getByRole('button', { name: /^Copy: update command/ })).toBeVisible()
  await page.keyboard.press('Escape')
})

test('at 1200 x 760 the page has no sideways scroll and keeps two columns of cards', async () => {
  const page = await open('light', { width: 1200, height: 760 })
  // String expression: this tsconfig has no DOM lib, on purpose (it also types the main process).
  const overflow = (await page.evaluate('(() => { const el = document.querySelector("main"); return el.scrollWidth - el.clientWidth })()')) as number
  expect(overflow).toBeLessThanOrEqual(0)
  const boxes = await Promise.all((await cards(page).all()).slice(0, 8).map((c) => c.boundingBox()))
  expect(new Set(boxes.map((b) => Math.round(b!.x))).size).toBe(2)
})

for (const theme of ['light', 'dark'] as const) {
  test(`axe is clean in ${theme}: the page, the drawer, the form and the sources dialog`, async () => {
    const page = await open(theme)
    expect(await axe(page), 'page').toEqual([])
    await page.getByRole('searchbox', { name: 'Search roles' }).fill('marketing')
    expect(await axe(page), 'search').toEqual([])
    await page.getByRole('searchbox', { name: 'Search roles' }).fill('')

    await cards(page).first().click()
    expect(await axe(page), 'drawer').toEqual([])
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Create a role' }).click()
    expect(await axe(page), 'form').toEqual([])
    await page.getByLabel('Name').fill('x')
    await page.getByRole('button', { name: 'Create role' }).click()
    expect(await axe(page), 'form with errors').toEqual([])
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Sources and updates' }).click()
    expect(await axe(page), 'sources').toEqual([])
  })
}
