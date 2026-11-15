import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { cleanup, closeApps, launch, profile } from './support'

/**
 * The right-click menu every session has (UI_MAP § Session menu): demo data on a throwaway profile, so nothing here runs a
 * program or reads the real machine. Notes (pinned, unread, a name, archived, a section) live in the window's memory in demo.
 */

test.afterEach(cleanup)

async function openDemo(theme: 'light' | 'dark' = 'light'): Promise<{ page: Page; errors: string[] }> {
  const userData = profile('session-menu')
  writeFileSync(join(userData, 'config.json'), JSON.stringify({ demo: true }))
  const { page, errors } = await launch(userData, { env: { AGENTDECK_THEME: theme } })
  await page.reload()
  await expect(page.getByTestId('home')).toBeVisible()
  // String expression: this tsconfig has no DOM lib, on purpose (it also types the main process).
  await page.waitForFunction('document.fonts.status === "loaded"')
  return { page, errors }
}

const runningNow = (page: Page): Locator => page.getByRole('region', { name: 'Running now' })
/** A Running now row (its subagents are list items too, so the first match is the row itself). */
const homeRow = (page: Page, name: string): Locator => runningNow(page).getByRole('listitem').filter({ hasText: name }).first()
const sessionsList = (page: Page): Locator => page.getByRole('region', { name: 'Sessions', exact: true })
const sessionRow = (page: Page, name: string): Locator => sessionsList(page).getByRole('listitem').filter({ hasText: name }).first()
const menu = (page: Page, name: string): Locator => page.getByRole('menu', { name: `Actions for ${name}` })
const sidebar = (page: Page): Locator => page.getByRole('complementary', { name: 'Sidebar' })

async function openSessions(page: Page): Promise<void> {
  await sidebar(page).getByRole('button', { name: 'Sessions', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Sessions' })).toBeVisible()
}

const NOT_DELETABLE = "Claude Code keeps this session's history. AgentDeck can archive it, but it never deletes Claude Code's files."

test('right-click a Running now row: the menu has the items in order, each with its key, and the ones out of reach say why', async () => {
  const { page, errors } = await openDemo()
  await homeRow(page, 'auth-tests').click({ button: 'right' })
  const m = menu(page, 'auth-tests')
  await expect(m).toBeVisible()
  await expect(m).toContainText('auth-tests')
  await expect(m).toContainText('Working')

  const main: [string, string | null][] = [
    ['Open in', null],
    ['Pin', 'P'],
    ['Mark as unread', 'U'],
    ['Rename', 'R'],
    ['Fork', 'F'],
    ['Move to section', null],
    ['Archive', 'A'],
    ['Delete', 'D'],
    ['Copy resume command', 'C']
  ]
  await expect(m.getByRole('menuitem')).toHaveCount(main.length)
  for (const [name, key] of main) {
    const item = m.getByRole('menuitem', { name, exact: true })
    await expect(item).toBeVisible()
    if (key) await expect(item).toHaveAttribute('aria-keyshortcuts', key)
  }

  // Out of reach, and said: Delete, because Claude Code keeps this session's history. Fork is not: the Console can copy a session.
  const del = m.getByRole('menuitem', { name: 'Delete', exact: true })
  await expect(del).toHaveAttribute('aria-disabled', 'true')
  await expect(m.getByRole('menuitem', { name: 'Fork', exact: true })).not.toHaveAttribute('aria-disabled', 'true')
  await del.hover()
  await expect(page.getByRole('tooltip').first()).toContainText(NOT_DELETABLE)

  // Open in ▸ opens on hover: two groups, numbered.
  await m.getByRole('menuitem', { name: 'Open in', exact: true }).hover()
  const numbered: [string, string][] = [
    ['Details panel', '1'],
    ['VS Code', '2'],
    ['Cursor', '3'],
    ['Explorer', '4'],
    ['Terminal here', '5'],
    ['Claude Desktop', '6'],
    ["The session's terminal", '7']
  ]
  for (const [name, key] of numbered) await expect(page.getByRole('menuitem', { name, exact: true })).toHaveAttribute('aria-keyshortcuts', key)
  await expect(page.getByText('Continue in', { exact: true })).toBeVisible()

  // Opening a folder in an app runs nothing in demo, and says so.
  await page.keyboard.press('2')
  await expect(page.getByText('Demo data: nothing was run.').first()).toBeVisible()
  await expect(page.getByRole('menu')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('P pins it: it floats to the top of Running now and appears under Pinned in the sidebar; the menu then offers Unpin', async () => {
  const { page, errors } = await openDemo()
  await expect(runningNow(page).getByRole('listitem').first()).not.toContainText('auth-tests')
  await homeRow(page, 'auth-tests').click({ button: 'right' })
  await expect(menu(page, 'auth-tests')).toBeVisible()
  await page.keyboard.press('p')
  await expect(menu(page, 'auth-tests')).toHaveCount(0)

  await expect(runningNow(page).getByRole('listitem').first()).toContainText('auth-tests')
  await expect(sidebar(page).getByRole('heading', { name: 'Pinned' })).toBeVisible()
  await expect(sidebar(page).getByRole('button', { name: 'auth-tests' })).toBeVisible()
  await expect(homeRow(page, 'auth-tests').getByRole('img', { name: 'Pinned' })).toBeVisible()

  // The sidebar entry opens the drawer and has the same menu.
  await sidebar(page).getByRole('button', { name: 'auth-tests' }).click()
  await expect(page.getByRole('dialog')).toContainText('auth-tests')
  await page.keyboard.press('Escape')
  await sidebar(page).getByRole('button', { name: 'auth-tests' }).click({ button: 'right' })
  await expect(menu(page, 'auth-tests').getByRole('menuitem', { name: 'Unpin', exact: true })).toBeVisible()
  await page.keyboard.press('p')
  await expect(sidebar(page).getByRole('heading', { name: 'Pinned' })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('R renames it: the new name is used everywhere and Reset name brings the original back', async () => {
  const { page, errors } = await openDemo()
  await homeRow(page, 'auth-tests').click({ button: 'right' })
  await expect(menu(page, 'auth-tests')).toBeVisible()
  await page.keyboard.press('r')
  const dialog = page.getByRole('dialog', { name: 'Rename session' })
  await expect(dialog).toContainText('Claude Code keeps its own')
  await dialog.getByLabel('Name').fill('  Login flow   tests  ')
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)

  await expect(runningNow(page).getByRole('button', { name: 'Login flow tests', exact: true })).toBeVisible()
  await expect(runningNow(page).getByRole('button', { name: 'auth-tests', exact: true })).toHaveCount(0)
  await openSessions(page)
  await expect(sessionRow(page, 'Login flow tests')).toBeVisible()
  // Search finds it by either name.
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox').fill('auth-tests')
  await expect(page.getByRole('option', { name: /Login flow tests/ })).toBeVisible()
  await page.keyboard.press('Escape')

  await sessionRow(page, 'Login flow tests').click({ button: 'right' })
  await page.keyboard.press('r')
  await page.getByRole('dialog', { name: 'Rename session' }).getByRole('button', { name: 'Reset name' }).click()
  await expect(sessionRow(page, 'auth-tests')).toBeVisible()
  await expect(page.getByText('Login flow tests')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('sections: New section from the menu, the group on Sessions, the filter, rename, delete (its sessions only leave it)', async () => {
  const { page, errors } = await openDemo()
  await openSessions(page)
  await sessionRow(page, 'stripe-webhooks').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Move to section', exact: true }).hover()
  // No sections yet: it says so and offers a new one.
  await expect(page.getByText('No sections yet')).toBeVisible()
  await page.getByRole('menuitem', { name: 'New section…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New section' })
  await dialog.getByLabel('Section name').fill('Client work')
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)

  const group = page.getByRole('region', { name: 'Client work' })
  await expect(group).toContainText('stripe-webhooks')
  await expect(page.getByRole('region', { name: 'Not in a section' })).toContainText('agentdeck-ui')

  // A name that is taken is refused where you typed it.
  await page.getByRole('button', { name: 'New section' }).click()
  await page.getByLabel('Section name').fill('client WORK')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alert')).toContainText('There is already a section called client WORK.')
  await page.keyboard.press('Escape')

  // The section filter, and the section's own menu.
  await page.getByRole('button', { name: /^Section/ }).click()
  await page.getByRole('menuitemradio', { name: 'No section' }).click()
  await expect(sessionRow(page, 'stripe-webhooks')).toHaveCount(0)
  await page.getByRole('button', { name: /^Section/ }).click()
  await page.getByRole('menuitemradio', { name: 'All' }).click()
  await expect(sessionRow(page, 'stripe-webhooks')).toBeVisible()

  await page.getByRole('button', { name: 'Actions for section Client work' }).click()
  await page.getByRole('menuitem', { name: 'Rename section…' }).click()
  await page.getByLabel('Section name').fill('Clients')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: 'Clients' })).toContainText('stripe-webhooks')

  await page.getByRole('button', { name: 'Actions for section Clients' }).click()
  await page.getByRole('menuitem', { name: 'Delete section…' }).click()
  await page.getByRole('dialog', { name: /^Delete Clients/ }).getByRole('button', { name: 'Delete section' }).click()
  await expect(page.getByRole('region', { name: 'Clients' })).toHaveCount(0)
  await expect(sessionRow(page, 'stripe-webhooks')).toBeVisible()
  expect(errors).toEqual([])
})

test('A archives: it leaves Sessions, a running one keeps running and still shows in Needs you, and the Archived filter brings it back', async () => {
  const { page, errors } = await openDemo()
  // A session that is waiting on you: archived with no confirmation, still in Running now and in Needs you.
  await homeRow(page, 'booking-form').click({ button: 'right' })
  await expect(menu(page, 'booking-form')).toBeVisible()
  await page.keyboard.press('a')
  await expect(page.getByText('Archived. It keeps running and still shows in Needs you when it needs you.').first()).toBeVisible()
  await expect(homeRow(page, 'booking-form')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Needs you' })).toContainText('booking-form')

  // A session that ended: gone from Your agents and from Sessions.
  await openSessions(page)
  await expect(sessionRow(page, 'booking-form')).toHaveCount(0)
  await sessionRow(page, 'seo-audit').click({ button: 'right' })
  await page.keyboard.press('a')
  await expect(sessionRow(page, 'seo-audit')).toHaveCount(0)

  await page.getByRole('button', { name: /^Archived/ }).click()
  await page.getByRole('menuitemradio', { name: 'Only archived' }).click()
  await expect(sessionRow(page, 'seo-audit')).toBeVisible()
  await expect(sessionRow(page, 'booking-form')).toBeVisible()
  await expect(sessionRow(page, 'auth-tests')).toHaveCount(0)

  await sessionRow(page, 'seo-audit').click({ button: 'right' })
  await expect(menu(page, 'seo-audit').getByRole('menuitem', { name: 'Unarchive', exact: true })).toBeVisible()
  await page.keyboard.press('a')
  await page.getByRole('button', { name: /^Archived/ }).click()
  await page.getByRole('menuitemradio', { name: 'Hidden' }).click()
  await expect(sessionRow(page, 'seo-audit')).toBeVisible()
  expect(errors).toEqual([])
})

test('U marks it unread (a dot on the row) and opening the details panel reads it', async () => {
  const { page, errors } = await openDemo()
  await homeRow(page, 'auth-tests').click({ button: 'right' })
  await expect(menu(page, 'auth-tests')).toBeVisible()
  await page.keyboard.press('u')
  await expect(homeRow(page, 'auth-tests').getByText('Unread')).toBeAttached()
  await homeRow(page, 'auth-tests').getByRole('button', { name: 'auth-tests', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('auth-tests')
  await page.keyboard.press('Escape')
  await expect(homeRow(page, 'auth-tests').getByText('Unread')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('F forks it: the Console opens on a new conversation that says it is a copy, and in demo the reply is scripted', async () => {
  const { page, errors } = await openDemo()
  await homeRow(page, 'auth-tests').click({ button: 'right' })
  await expect(menu(page, 'auth-tests')).toBeVisible()
  await page.keyboard.press('f')
  await expect(menu(page, 'auth-tests')).toHaveCount(0)

  await expect(page.getByRole('heading', { level: 1, name: 'Console' })).toBeVisible()
  await expect(page.getByText('Forking', { exact: true })).toBeVisible()
  await expect(page.getByText('as a copy. The original stays as it is.')).toBeVisible()
  const box = page.getByLabel('First message for a new conversation')
  await box.fill('Try the other approach')
  await box.press('Enter')

  await expect(page.getByRole('log', { name: 'Conversation with Claude Code' })).toContainText('This is demo data, so nothing was sent to Claude')
  await expect(page.getByRole('heading', { level: 2, name: 'Fork of auth-tests' })).toBeVisible()
  await expect(page.getByText('Fork', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('Delete: out of reach for an interactive session; a background one asks first, says what happens, and in demo runs nothing', async () => {
  const { page, errors } = await openDemo()
  await homeRow(page, 'auth-tests').click({ button: 'right' })
  await expect(menu(page, 'auth-tests')).toBeVisible()
  await page.keyboard.press('d')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText(NOT_DELETABLE).first()).toBeVisible()
  await page.keyboard.press('Escape')

  await openSessions(page)
  await sessionRow(page, 'stripe-webhooks').click({ button: 'right' })
  await expect(menu(page, 'stripe-webhooks').getByRole('menuitem', { name: 'Delete', exact: true })).not.toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('d')
  const dialog = page.getByRole('dialog', { name: 'Delete stripe-webhooks?' })
  await expect(dialog).toContainText('This removes the background session from Claude Code.')
  await expect(dialog).toContainText('claude rm a3f09c1e')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(sessionRow(page, 'stripe-webhooks')).toBeVisible()

  await sessionRow(page, 'stripe-webhooks').click({ button: 'right' })
  await page.keyboard.press('d')
  await page.getByRole('dialog', { name: 'Delete stripe-webhooks?' }).getByRole('button', { name: 'Delete session' }).click()
  await expect(page.getByText('Demo data: nothing was run.').first()).toBeVisible()
  await expect(sessionRow(page, 'stripe-webhooks')).toBeVisible()
  expect(errors).toEqual([])
})

test('keyboard: Shift+F10 and the Menu key open it on the focused row, ArrowRight opens the submenu, Escape gives focus back, and the ⋯ button works too', async () => {
  const { page, errors } = await openDemo()
  const name = homeRow(page, 'auth-tests').getByRole('button', { name: 'auth-tests', exact: true })
  await name.focus()
  await page.keyboard.press('Shift+F10')
  await expect(menu(page, 'auth-tests')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu(page, 'auth-tests')).toHaveCount(0)
  await expect(name).toBeFocused()

  await page.keyboard.press('ContextMenu')
  await expect(menu(page, 'auth-tests')).toBeVisible()
  await page.getByRole('menuitem', { name: 'Open in', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('menuitem', { name: 'Details panel', exact: true })).toBeVisible()
  await page.keyboard.press('1')
  await expect(page.getByRole('dialog')).toContainText('auth-tests')
  await page.keyboard.press('Escape')

  // The visible way in: ⋯ on the row, which gets focus back too.
  // A CSS locator: while a menu is open the page behind it is hidden from the accessibility tree, which role locators go through.
  const more = page.locator('section[aria-labelledby="running-now"] li', { hasText: 'auth-tests' }).first().locator('button[aria-label="Actions for auth-tests"]')
  await more.click()
  await expect(menu(page, 'auth-tests')).toBeVisible()
  await expect(more).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(more).toBeFocused()
  expect(errors).toEqual([])
})

test('the menu follows every place a session is listed: Your agents tiles, Needs you rows, Sessions rows and the drawer', async () => {
  const { page, errors } = await openDemo()
  await page.getByRole('region', { name: 'Your agents' }).getByRole('listitem').filter({ hasText: 'booking-form' }).click({ button: 'right' })
  await expect(menu(page, 'booking-form')).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByRole('region', { name: 'Needs you' }).getByRole('listitem').filter({ hasText: 'booking-form' }).first().click({ button: 'right' })
  await expect(menu(page, 'booking-form')).toBeVisible()
  await expect(menu(page, 'booking-form').getByRole('menuitem', { name: 'Answer in terminal', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')

  await openSessions(page)
  await sessionRow(page, 'portal-migration').click({ button: 'right' })
  await expect(menu(page, 'portal-migration').getByRole('menuitem', { name: 'Stop', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')

  await sessionRow(page, 'auth-tests').getByRole('button', { name: 'auth-tests', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Actions for auth-tests' }).click()
  await expect(menu(page, 'auth-tests')).toBeVisible()
  expect(errors).toEqual([])
})

for (const theme of ['light', 'dark'] as const) {
  test(`axe: the rows with their ⋯ buttons, the open menu and its dialogs pass in ${theme}`, async () => {
    await closeApps()
    const { page, errors } = await openDemo(theme)
    const axe = async (rules: string[] = []): Promise<string[]> =>
      (await new AxeBuilder({ page }).setLegacyMode(true).disableRules(rules).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()).violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
      )
    expect(await axe()).toEqual([])

    // An open menu hides the page behind it from screen readers (Radix's modal menus do, so every menu in the app is scanned
    // without aria-hidden-focus); everything else about it, and its submenu, must pass.
    await homeRow(page, 'auth-tests').click({ button: 'right' })
    await expect(menu(page, 'auth-tests')).toBeVisible()
    expect(await axe(['aria-hidden-focus'])).toEqual([])
    await page.getByRole('menuitem', { name: 'Open in', exact: true }).hover()
    await expect(page.getByRole('menuitem', { name: 'Details panel', exact: true })).toBeVisible()
    expect(await axe(['aria-hidden-focus'])).toEqual([])
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    await openSessions(page)
    expect(await axe()).toEqual([])
    await sessionRow(page, 'stripe-webhooks').click({ button: 'right' })
    await page.keyboard.press('d')
    await expect(page.getByRole('dialog', { name: 'Delete stripe-webhooks?' })).toBeVisible()
    await page.waitForTimeout(400) // the dialog eases in over 180 ms; contrast is measured on the finished colours
    expect(await axe()).toEqual([])
    await page.keyboard.press('Escape')
    await sessionRow(page, 'booking-form').click({ button: 'right' })
    await page.keyboard.press('r')
    await expect(page.getByRole('dialog', { name: 'Rename session' })).toBeVisible()
    await page.waitForTimeout(400)
    expect(await axe()).toEqual([])
    expect(errors).toEqual([])
  })
}
