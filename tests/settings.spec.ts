import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import AxeBuilder from '@axe-core/playwright'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

const MAIN = 'out/main/index.js'

let launched: ElectronApplication[] = []
let dirs: string[] = []

function freshUserData(config: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentdeck-settings-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config))
  return dir
}

/** Live mode on a throwaway profile: no CLAUDE* variables, no polling of the real sessions, hooks files in the temp folder. */
function appEnv(userData: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !key.startsWith('CLAUDE')) env[key] = value
  return { ...env, AGENTDECK_USER_DATA: userData, AGENTDECK_POLL: '0', AGENTDECK_THEME: 'light', CLAUDE_CONFIG_DIR: userData }
}

async function open(config: Record<string, unknown> = {}): Promise<{ app: ElectronApplication; page: Page; userData: string }> {
  const userData = freshUserData(config)
  const app = await electron.launch({ args: [MAIN], env: appEnv(userData) })
  launched.push(app)
  const page = await app.firstWindow()
  await page.waitForLoadState('load')
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!
    w.unmaximize()
    w.setSize(1440, 924)
    w.center()
  })
  return { app, page, userData }
}

/** The parts of config.json these tests look at. */
interface Config {
  mystery?: string
  profile?: { name?: string }
  notifications?: { pausedUntil?: number; kinds?: Record<string, boolean>; quietHours?: { from: number; to: number } | null }
  eod?: { enabled?: boolean; time?: string; folder?: string | null }
  startAtLogin?: boolean
  startMinimized?: boolean
}
const readConfig = (userData: string): Config => JSON.parse(readFileSync(join(userData, 'config.json'), 'utf8')) as Config

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Profile' })).toBeVisible()
}

/** A valid RGB PNG, so the avatar code has a real picture to crop and shrink. */
function png(width: number, height: number): Buffer {
  const stride = width * 3 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set([x % 256, y % 256, 128], y * stride + 1 + x * 3)
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type), data])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const head = Buffer.alloc(13)
  head.writeUInt32BE(width, 0)
  head.writeUInt32BE(height, 4)
  head.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const pictureSize = (app: ElectronApplication, file: string) => app.evaluate(({ nativeImage }, f) => nativeImage.createFromPath(f).getSize(), file)

test.afterEach(async () => {
  await Promise.all(launched.map((app) => app.close().catch(() => undefined)))
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  launched = []
  dirs = []
})

test('the name reaches the sidebar, the greeting and config.json; empty goes back to the account name', async () => {
  const { page, userData } = await open({ mystery: 'kept' })
  await openSettings(page)

  const name = page.getByRole('textbox', { name: 'Name', exact: true })
  await name.fill('Sam Rivera')
  await name.press('Enter')
  await expect(page.getByRole('button', { name: /^Sam Rivera, AgentDeck .*Your profile$/ })).toBeVisible()
  await expect.poll(() => readConfig(userData).profile?.name).toBe('Sam Rivera')
  await expect(page.locator('#settings-profile').getByText('Saved', { exact: true })).toBeVisible()

  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Home' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Good (morning|afternoon|evening), Sam Rivera$/, { timeout: 15_000 })

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('')
  await page.getByRole('textbox', { name: 'Name', exact: true }).press('Enter')
  await expect.poll(() => readConfig(userData).profile?.name).toBeUndefined()
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).not.toHaveValue('')
  expect(readConfig(userData).mystery).toBe('kept')
})

test('a photo is cropped to a square of at most 256 px, shown as an image with alt text, and removed again', async () => {
  const { app, page, userData } = await open()
  const source = join(userData, 'holiday.png')
  writeFileSync(source, png(600, 300))
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, source)
  await openSettings(page)

  await page.getByRole('button', { name: 'Add photo' }).click()
  await expect(page.getByRole('img', { name: /^Photo of / })).toHaveCount(2) // the Profile card and the sidebar
  const saved = join(userData, 'profile', 'avatar.png')
  expect(await pictureSize(app, saved)).toEqual({ width: 256, height: 256 })
  await expect(page.getByRole('img', { name: /^Photo of / }).first()).toHaveJSProperty('complete', true)

  await page.getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByRole('img', { name: /^Photo of / })).toHaveCount(0)
  await expect.poll(() => existsSync(saved)).toBe(false)
})

test('a large photo someone copied into the profile folder is shrunk when read, and a damaged one never fails', async () => {
  const userData = freshUserData()
  mkdirSync(join(userData, 'profile'))
  writeFileSync(join(userData, 'profile', 'avatar.png'), png(900, 700))
  const app = await electron.launch({ args: [MAIN], env: appEnv(userData) })
  launched.push(app)
  const page = await app.firstWindow()
  await page.waitForLoadState('load')
  const shown = await page.evaluate(async () => {
    const profile = await (globalThis as { agentdeck?: { getProfile(): Promise<{ avatar: string | null }> } }).agentdeck!.getProfile()
    return profile.avatar
  })
  expect(shown).toMatch(/^data:image\/png;base64,/)
  // The file on disk is left as it was; only the copy handed to the window is small.
  expect(await pictureSize(app, join(userData, 'profile', 'avatar.png'))).toEqual({ width: 900, height: 700 })
  const side = await page.evaluate(
    (url) =>
      new Promise<number>((resolve) => {
        const img = new (globalThis as unknown as { Image: new () => { onload(): void; src: string; naturalWidth: number } }).Image()
        img.onload = () => resolve(img.naturalWidth)
        img.src = url!
      }),
    shown
  )
  expect(side).toBe(256)

  writeFileSync(join(userData, 'profile', 'avatar.png'), 'this is not a picture')
  const damaged = await page.evaluate(() => (globalThis as { agentdeck?: { getProfile(): Promise<{ avatar: string | null }> } }).agentdeck!.getProfile())
  expect(damaged.avatar).toBeNull()
})

test('switches save at once, keep keys Settings does not know, and the dependent ones wait for their parent', async () => {
  const { page, userData } = await open({ mystery: 'kept', notifications: { pausedUntil: 4_102_444_800_000, kinds: { stuck: false } } })
  await openSettings(page)

  await page.getByRole('switch', { name: 'When a session needs your approval' }).click()
  await expect.poll(() => readConfig(userData).notifications?.kinds?.approval).toBe(false)
  const n = readConfig(userData).notifications
  expect(n).toMatchObject({ pausedUntil: 4_102_444_800_000, kinds: { approval: false, stuck: false } })
  // Two more switches in a row, faster than main answers: neither click undoes the other.
  await page.getByRole('switch', { name: 'When a session asks you a question' }).click()
  await page.getByRole('switch', { name: 'When a session fails or hits a limit' }).click()
  await expect.poll(() => readConfig(userData).notifications?.kinds).toMatchObject({ approval: false, question: false, failed: false, stuck: false })
  expect(readConfig(userData).mystery).toBe('kept')

  await page.getByRole('switch', { name: 'Quiet hours' }).click()
  await expect.poll(() => readConfig(userData).notifications?.quietHours).toEqual({ from: 1320, to: 420 })
  const from = page.getByRole('group', { name: 'Quiet hours' }).getByLabel('From')
  await from.fill('21:30')
  await from.press('Enter')
  await expect.poll(() => readConfig(userData).notifications?.quietHours).toEqual({ from: 1290, to: 420 })

  await page.getByRole('switch', { name: 'Write a daily report' }).click()
  await expect.poll(() => readConfig(userData).eod?.enabled).toBe(false)
  await expect(page.getByLabel('Publish at')).toBeDisabled()
  await page.getByRole('switch', { name: 'Write a daily report' }).click()
  const time = page.getByLabel('Publish at')
  await time.fill('17:45')
  await time.press('Enter')
  await expect.poll(() => readConfig(userData).eod).toMatchObject({ enabled: true, time: '17:45', folder: null })

  const minimized = page.getByRole('switch', { name: 'Start minimized to the tray' })
  await expect(minimized).toBeDisabled()
  await page.getByRole('switch', { name: /^Start AgentDeck when I sign in/ }).click()
  await minimized.click()
  await expect.poll(() => readConfig(userData)).toMatchObject({ startAtLogin: true, startMinimized: true })
})

test('Diagnostics: Ctrl+K jumps to it, every check has a verdict, and the copied report hides the home folder', async () => {
  const { app, page } = await open()
  await page.keyboard.press('Control+K')
  await page.getByRole('combobox').fill('Diagnostics')
  await page.keyboard.press('Enter')
  const heading = page.getByRole('heading', { level: 2, name: 'Diagnostics' })
  await expect(heading).toBeInViewport()
  await expect(page.getByText('Checking your setup…')).toHaveCount(0, { timeout: 45_000 })

  const checks = page.locator('#settings-diagnostics li')
  await expect(checks.first()).toBeVisible()
  expect(await checks.count()).toBeGreaterThanOrEqual(5)
  for (const check of await checks.all()) await expect(check).toHaveText(/(OK|Needs attention)$/)
  await expect(page.locator('#settings-diagnostics').getByText('Collector running')).toBeVisible()

  await page.getByRole('button', { name: 'Copy diagnostics' }).click()
  await expect(page.getByTestId('notice')).toContainText('Copied')
  const text = await app.evaluate(({ clipboard }) => clipboard.readText())
  expect(text).toContain('AgentDeck diagnostics')
  expect(text).toContain('[ok] Collector running')
  expect(text.toLowerCase()).not.toContain(homedir().toLowerCase())
  expect(text).not.toMatch(/\b[0-9a-f]{64}\b/i)
})

test('Integration shows the hooks state read-only and opens the install dialog', async () => {
  const { page } = await open()
  await openSettings(page)
  const integration = page.locator('#settings-integration')
  await expect(integration.getByText('Claude Code hooks')).toBeVisible()
  await integration.getByRole('button', { name: 'Manage hooks…' }).click()
  await expect(page.getByRole('dialog', { name: 'Connect AgentDeck to Claude Code' })).toBeVisible()
  await page.keyboard.press('Escape')
})

test('Settings has no axe violations (WCAG 2.x A/AA) and no console errors', async () => {
  const { page } = await open()
  const errors: string[] = []
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`${m.type()}: ${m.text()}`))
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  await openSettings(page)
  await expect(page.getByText('Checking your setup…')).toHaveCount(0, { timeout: 45_000 })
  const results = await new AxeBuilder({ page }).setLegacyMode(true).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  expect(errors).toEqual([])
})
