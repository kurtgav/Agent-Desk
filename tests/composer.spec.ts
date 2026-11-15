import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { cleanup, launch, profile } from './support'

// The one composer, on the new session screen, in demo mode: fixed data (ADR-0011), nothing is started or sent.

test.afterEach(cleanup)

interface Opened {
  page: Page
  errors: string[]
}

async function open(width = 1440, height = 924, theme: 'light' | 'dark' = 'light'): Promise<Opened> {
  const userData = profile('composer')
  writeFileSync(join(userData, 'config.json'), JSON.stringify({ demo: true }))
  const { app, page, errors } = await launch(userData, { env: { AGENTDECK_THEME: theme } })
  await app.evaluate(({ BrowserWindow }, size) => {
    const w = BrowserWindow.getAllWindows()[0]!
    w.unmaximize()
    w.setSize(size.width, size.height)
    w.center()
  }, { width, height })
  await page.reload()
  await expect(page.locator('#composer-input')).toBeVisible()
  await page.waitForFunction('document.fonts.status === "loaded"')
  return { page, errors }
}

const box = (page: Page) => page.getByLabel('First message for a new conversation')
const agents = (page: Page) => page.getByRole('listbox', { name: 'Agents' })
const axe = async (page: Page): Promise<string[]> =>
  (await new AxeBuilder({ page }).setLegacyMode(true).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()).violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
  )

test('@c shows the CTO first, and Enter writes it into the message as a chip', async () => {
  const { page, errors } = await open()
  await box(page).click()
  await box(page).pressSequentially('@c')
  const list = agents(page)
  await expect(list).toBeVisible()
  const first = list.getByRole('option').first()
  await expect(first).toContainText('CTO')
  await expect(first).toHaveAttribute('aria-selected', 'true')
  // One accessible combobox: the box points at the highlighted option and says the list is open.
  await expect(box(page)).toHaveRole('combobox')
  await expect(box(page)).toHaveAttribute('aria-expanded', 'true')
  await expect(box(page)).toHaveAttribute('aria-activedescendant', /composer-mentions-cto$/)

  await box(page).press('Enter')
  await expect(box(page)).toHaveValue('@cto ')
  await expect(list).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Agents in this message' })).toContainText('CTO')
  await expect(page.locator('[data-mention="cto"]')).toHaveCount(1)
  expect(errors).toEqual([])
})

test('@qa finds the QA agents, and every one of the agents is on the list', async () => {
  const { page, errors } = await open()
  await box(page).click()
  await box(page).pressSequentially('@qa')
  const names = await agents(page).getByRole('option').allTextContents()
  expect(names.some((n) => /Test Automation|Evidence|Accessibility/.test(n))).toBe(true)

  // Nothing typed: the whole catalog is one list (Pinned, Leadership, then every division), drawn a window at a time.
  await box(page).fill('')
  await box(page).pressSequentially('@')
  const options = agents(page).getByRole('option')
  await expect(options.first()).toHaveAttribute('aria-setsize', /^\d+$/)
  const total = Number(await options.first().getAttribute('aria-setsize'))
  expect(total).toBeGreaterThan(30)
  expect(await options.count()).toBeLessThan(total)
  await expect(agents(page)).toContainText('Leadership')
  expect(errors).toEqual([])
})

test('two mentions: the first leads and the second helps, and the chips say so', async () => {
  const { page, errors } = await open()
  await box(page).click()
  await box(page).pressSequentially('@cto @frontend-developer review the checkout page')
  const chips = page.getByRole('group', { name: 'Agents in this message' })
  await expect(chips.getByText('Leading', { exact: true })).toBeVisible()
  await expect(chips.getByText('Also', { exact: true })).toBeVisible()
  await expect(chips.locator('[data-role-chip="cto"]')).toBeVisible()
  await expect(chips.locator('[data-role-chip="frontend-developer"]')).toBeVisible()

  // The chip's menu makes the other one the lead without typing: it is written first.
  await chips.getByRole('button', { name: /^Also: Frontend Developer/ }).click()
  await page.getByRole('menuitem', { name: 'Make Frontend Developer the lead' }).click()
  await expect(box(page)).toHaveValue(/^@frontend-developer @cto review the checkout page$/)
  await expect(chips.getByRole('button', { name: /^Leading: Frontend Developer/ })).toBeVisible()
  expect(errors).toEqual([])
})

test('Backspace takes a chip out as one unit, and undo brings it back', async () => {
  const { page, errors } = await open()
  await box(page).click()
  await box(page).pressSequentially('@cto')
  await box(page).press('Enter')
  await expect(box(page)).toHaveValue('@cto ')
  await box(page).press('Backspace') // the space
  await expect(box(page)).toHaveValue('@cto')
  await box(page).press('Backspace') // the whole mention
  await expect(box(page)).toHaveValue('')
  await expect(page.locator('[data-role-chip]')).toHaveCount(0)
  await box(page).press('Control+z')
  await expect(box(page)).toHaveValue(/^@cto/)
  expect(errors).toEqual([])
})

test('Esc closes the menu for that word only, and typing on opens it again', async () => {
  const { page } = await open()
  await box(page).click()
  await box(page).pressSequentially('@qa')
  await expect(agents(page)).toBeVisible()
  await box(page).press('Escape')
  await expect(agents(page)).toHaveCount(0)
  await box(page).press('a')
  await expect(page.getByText('No agent matches').first()).toBeVisible()
})

test('suggested agents appear as you describe the work, and one click writes the mention', async () => {
  const { page, errors } = await open()
  await box(page).click()
  await box(page).pressSequentially('our postgres queries are slow')
  const suggested = page.getByRole('group', { name: 'Suggested agents' })
  await expect(suggested).toBeVisible()
  const pick = suggested.getByRole('button', { name: /Database Optimizer/ })
  await expect(pick).toBeVisible()
  // The reason is a hover away: the words that matched.
  await expect(pick).toHaveAccessibleName(/matched:/)
  await pick.click()
  await expect(box(page)).toHaveValue(/^@database-optimizer our postgres queries are slow$/)
  await expect(suggested.getByRole('button', { name: /Database Optimizer/ })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('a message with only a mention says what is missing, and Run in the background explains an agent it cannot use', async () => {
  const { page } = await open()
  await box(page).click()
  await box(page).pressSequentially('@cto')
  await box(page).press('Enter')
  await box(page).press('Enter')
  await expect(page.getByRole('status').filter({ hasText: 'Say what you want from @CTO' })).toBeVisible()
  // The CTO ships with AgentDeck and is not an agent installed in Claude Code, so it can lead a conversation but not a --bg run.
  await box(page).pressSequentially('plan the launch')
  const bg = page.getByRole('button', { name: 'Run in the background' })
  await expect(bg).toHaveAttribute('aria-disabled', 'true')
  await bg.hover()
  await expect(page.getByRole('tooltip').first()).toContainText('not installed in Claude Code')
})

test('the / menu still works beside @, and the two never fight', async () => {
  const { page, errors } = await open()
  await box(page).click()
  await box(page).pressSequentially('/as')
  const commands = page.getByRole('listbox', { name: 'Commands and skills' })
  await expect(commands).toBeVisible()
  await expect(agents(page)).toHaveCount(0)
  await box(page).press('Tab')
  await expect(box(page)).toHaveValue('/aside ')
  await box(page).pressSequentially('and ask @cto')
  await expect(commands).toHaveCount(0)
  await expect(agents(page)).toBeVisible()
  expect(errors).toEqual([])
})

test('Shift+Enter adds a line and a long message scrolls inside its box, with the caret in view', async () => {
  const { page } = await open()
  await box(page).click()
  await box(page).fill(Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n'))
  await box(page).press('Control+End')
  await box(page).pressSequentially('last')
  const field = page.locator('#composer-input').locator('..')
  const { visible, total } = await field.evaluate((el) => ({ visible: el.clientHeight, total: el.scrollHeight }))
  expect(visible).toBeLessThan(260)
  expect(total).toBeGreaterThan(visible)
  await expect(box(page)).toBeFocused()
})

for (const [width, height] of [[1440, 924], [1200, 760]] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`axe is clean with the composer idle, with its menus open and with chips, ${theme} at ${width}`, async () => {
      const { page, errors } = await open(width, height, theme)
      expect(await axe(page)).toEqual([])
      await box(page).click()
      await box(page).pressSequentially('@')
      await expect(agents(page)).toBeVisible()
      expect(await axe(page)).toEqual([])
      await box(page).fill('')
      await box(page).pressSequentially('/')
      expect(await axe(page)).toEqual([])
      await box(page).fill('')
      await box(page).pressSequentially('@cto @frontend-developer our postgres queries are slow')
      await expect(page.getByRole('group', { name: 'Suggested agents' })).toBeVisible()
      expect(await axe(page)).toEqual([])
      await page.getByRole('button', { name: /^Advanced/ }).click()
      expect(await axe(page)).toEqual([])
      await page.screenshot({ path: `test-results/composer-${theme}-${width}.png` })
      expect(errors).toEqual([])
    })
  }
}
