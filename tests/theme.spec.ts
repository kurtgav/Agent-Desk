import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

/**
 * Light and dark: the top bar's button, the Appearance setting, the system choice, the window's own colours, and axe on
 * every page in dark. Demo data on a throwaway profile; AGENTDECK_THEME seeds the theme the way the other specs pin light.
 */

const MAIN = '.'
/** `--ground`, the page colour behind everything, in each theme (styles.css). */
const GROUND = { light: 'rgb(246, 246, 246)', dark: 'rgb(14, 14, 16)' }

let launched: ElectronApplication[] = []
let dirs: string[] = []

/** The isolated environment the other specs use; the theme seed is set only when asked for, so a CI machine's own variable never leaks in. */
function appEnv(userData: string, seed?: 'light' | 'dark'): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !key.startsWith('CLAUDE') && key !== 'AGENTDECK_THEME') env[key] = value
  return { ...env, AGENTDECK_USER_DATA: userData, AGENTDECK_POLL: '0', CLAUDE_CONFIG_DIR: userData, CODEX_HOME: `${userData}/codex`, ...(seed && { AGENTDECK_THEME: seed }) }
}

function freshUserData(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentdeck-theme-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ demo: true, autostartConfigured: true, trayHintShown: true }))
  return dir
}

interface Opened {
  app: ElectronApplication
  page: Page
  userData: string
}

async function open(opts: { userData?: string; seed?: 'light' | 'dark' } = {}): Promise<Opened> {
  const userData = opts.userData ?? freshUserData()
  const app = await electron.launch({ args: [MAIN], env: appEnv(userData, opts.seed) })
  launched.push(app)
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!
    w.unmaximize()
    w.setSize(1440, 924)
    w.center()
  })
  await expect(page.getByTestId('home')).toBeVisible()
  // String expression: this tsconfig has no DOM lib, on purpose (it also types the main process).
  await page.waitForFunction('document.fonts.status === "loaded"')
  return { app, page, userData }
}

const html = (page: Page) => page.locator('html')
const themeButton = (page: Page) => page.getByRole('button', { name: /^Theme: / })
const storedTheme = (userData: string): unknown => (JSON.parse(readFileSync(join(userData, 'config.json'), 'utf8')) as { theme?: unknown }).theme

/** What main says about the window: the native theme, and the colour behind the page. */
const nativeState = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow, nativeTheme }) => ({
    source: nativeTheme.themeSource,
    dark: nativeTheme.shouldUseDarkColors,
    background: BrowserWindow.getAllWindows()[0]!.getBackgroundColor().toLowerCase()
  }))

test.afterEach(async () => {
  await Promise.all(launched.map((app) => app.close().catch(() => undefined)))
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  launched = []
  dirs = []
})

test('AGENTDECK_THEME=dark paints the page, the native theme and the window ground dark', async () => {
  const { app, page } = await open({ seed: 'dark' })
  await expect(html(page)).toHaveAttribute('data-theme', 'dark')
  await expect(html(page)).toHaveCSS('color-scheme', 'dark')
  await expect(page.locator('body')).toHaveCSS('background-color', GROUND.dark)
  await expect(themeButton(page)).toHaveAccessibleName('Theme: dark')
  expect(await nativeState(app)).toEqual({ source: 'dark', dark: true, background: '#0e0e10' })
})

test('the top bar button flips the theme in one click, saves it, and the choice survives a relaunch', async () => {
  const first = await open({ seed: 'dark' })
  await themeButton(first.page).click()
  await expect(html(first.page)).toHaveAttribute('data-theme', 'light')
  await expect(first.page.locator('body')).toHaveCSS('background-color', GROUND.light)
  await expect(themeButton(first.page)).toHaveAccessibleName('Theme: light')
  await expect.poll(() => storedTheme(first.userData)).toBe('light')
  // The window follows: native theme and ground colour are light again.
  expect(await nativeState(first.app)).toEqual({ source: 'light', dark: false, background: '#f6f6f6' })
  await first.app.close()

  // No seed this time: what comes back is what was saved.
  const second = await open({ userData: first.userData })
  await expect(html(second.page)).toHaveAttribute('data-theme', 'light')
  await themeButton(second.page).click()
  await expect(html(second.page)).toHaveAttribute('data-theme', 'dark')
  await expect.poll(() => storedTheme(second.userData)).toBe('dark')
  await second.app.close()

  const third = await open({ userData: first.userData })
  await expect(html(third.page)).toHaveAttribute('data-theme', 'dark')
  expect((await nativeState(third.app)).background).toBe('#0e0e10')
})

test('the menu offers Light, Dark and Use system settings, with a check on the current one', async () => {
  const { page, userData } = await open({ seed: 'light' })
  const options = page.getByRole('button', { name: 'Theme options' })

  await options.click()
  await expect(page.getByRole('menuitemradio')).toHaveText(['Light', 'Dark', 'Use system settings'])
  // The seed stands in for a stored choice until the person changes the theme.
  await expect(page.getByRole('menuitemradio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('menuitemradio', { name: 'Dark' }).click()
  await expect(html(page)).toHaveAttribute('data-theme', 'dark')

  await options.click()
  await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('menuitemradio', { name: 'Use system settings' }).click()
  await expect(themeButton(page)).toHaveAccessibleName('Theme: system')
  await expect.poll(() => storedTheme(userData)).toBe('system')

  await options.click()
  await expect(page.getByRole('menuitemradio', { name: 'Use system settings' })).toHaveAttribute('aria-checked', 'true')
})

test('the button and the menu work from the keyboard', async () => {
  const { page } = await open({ seed: 'light' })
  await themeButton(page).focus()
  await page.keyboard.press('Enter')
  await expect(html(page)).toHaveAttribute('data-theme', 'dark')

  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Theme options' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitemradio', { name: 'Light' })).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitemradio')).toHaveCount(0) // choosing closes the menu
  await expect(themeButton(page)).toBeVisible()
})

test('system follows the operating system as it flips, live', async () => {
  const { page, userData } = await open() // no seed, nothing stored: system
  await expect(themeButton(page)).toHaveAccessibleName('Theme: system')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(html(page)).toHaveAttribute('data-theme', 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(html(page)).toHaveAttribute('data-theme', 'dark')
  await expect(html(page)).toHaveCSS('color-scheme', 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(html(page)).toHaveAttribute('data-theme', 'light')
  // Following the OS is not a stored choice of light or dark.
  expect(storedTheme(userData)).toBeUndefined()
})

test('Settings › Appearance and the top bar change the same setting', async () => {
  const { page, userData } = await open({ seed: 'dark' })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const appearance = page.locator('#settings-appearance')
  await expect(appearance.getByRole('heading', { level: 2, name: 'Appearance' })).toBeVisible()
  await expect(appearance.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true')

  await appearance.getByRole('button', { name: 'Light', exact: true }).click()
  await expect(html(page)).toHaveAttribute('data-theme', 'light')
  await expect(themeButton(page)).toHaveAccessibleName('Theme: light')
  await expect(appearance.getByText('Saved', { exact: true })).toBeVisible()
  await expect.poll(() => storedTheme(userData)).toBe('light')

  // The button moves the setting too, and the section shows it.
  await themeButton(page).click()
  await expect(appearance.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

const axe = async (page: Page): Promise<string[]> =>
  (await new AxeBuilder({ page }).setLegacyMode(true).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()).violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
  )

test('every page passes axe in dark (contrast included)', async () => {
  const { page } = await open({ seed: 'dark' })
  const nav = page.getByRole('navigation', { name: 'Main' })
  const title = page.getByRole('heading', { level: 1 })
  await expect(html(page)).toHaveAttribute('data-theme', 'dark')

  expect(await axe(page), 'Home').toEqual([])

  for (const [button, heading] of [
    [/^Tasks/, 'Tasks'],
    [/^Sessions/, 'Sessions'],
    [/^Approvals/, 'Approvals'],
    [/^Files/, 'Files'],
    [/^Activity/, 'Activity'],
    [/^Daily report/, 'Daily report']
  ] as const) {
    await nav.getByRole('button', { name: button }).click()
    await expect(title).toHaveText(heading)
    expect(await axe(page), heading).toEqual([])
  }

  await page.getByRole('button', { name: /^Roles/ }).click()
  await expect(title).toHaveText('Roles')
  expect(await axe(page), 'Roles').toEqual([])

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(title).toHaveText('Settings')
  await expect(page.getByRole('heading', { level: 2, name: 'Appearance' })).toBeVisible()
  expect(await axe(page), 'Settings').toEqual([])
})
