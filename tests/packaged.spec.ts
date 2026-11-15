import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { dayKey } from '../src/shared/day'
import { SESSION_CWD, bridge, cleanup, clearOfMidnight, collectorReady, launch, playSession, postHook, profile, readEndpoint, taskOf } from './support'
import { fixture } from '../src/collector/fixtures'

// The app as `npm run pack` makes it (release/win-unpacked): the collector is forked from inside app.asar, the icons and
// licences must be where the code looks for them. Skipped when nothing has been packed. Temp profile, polling off.
const EXE = resolve('release', 'win-unpacked', 'AgentDeck.exe')

test.skip(!existsSync(EXE), 'run `npm run pack` first: release/win-unpacked/AgentDeck.exe does not exist')
test.afterEach(cleanup)

const today = (): string => dayKey(Date.now())

function get(port: number, token: string | null): Promise<{ status: number; body: string }> {
  return new Promise((done, fail) => {
    const headers = token ? { 'x-agentdeck-token': token } : {}
    const req = request({ host: '127.0.0.1', port, path: '/health', headers }, (res) => {
      let body = ''
      res.on('data', (d: Buffer) => (body += d.toString()))
      res.on('end', () => done({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', fail)
    req.end()
  })
}

const dirBytes = (dir: string): number => readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? dirBytes(join(dir, e.name)) : statSync(join(dir, e.name)).size), 0)

test('the packaged app starts its collector from the asar, opens its pages and keeps its data in the profile', async () => {
  await clearOfMidnight()
  const userData = profile('packaged')
  // A packaged first run registers a Windows login item (ADR-0012), a change outside the temp profile: say it is done already.
  writeFileSync(join(userData, 'config.json'), JSON.stringify({ autostartConfigured: true }))
  const { app, page, errors } = await launch(userData, { executablePath: EXE })
  expect(await app.evaluate(({ app: a }) => a.isPackaged)).toBe(true)
  await expect(page.getByTestId('home')).toBeVisible()

  // The collector (a utility process forked from out/main/collector.js inside app.asar) answers /health, with the token only.
  const endpoint = await collectorReady(userData)
  expect(JSON.parse((await get(endpoint.port, endpoint.token)).body)).toMatchObject({ app: 'agentdeck', pid: expect.any(Number) })
  expect((await get(endpoint.port, null)).status).toBe(401)
  await expect(page.getByText('Starting the collector…')).toHaveCount(0)
  await expect(page.getByText('All quiet.')).toBeVisible()

  // Resources: the licence files beside app.asar, the icons inside it; the window and tray icons loaded.
  const res = await app.evaluate(async ({ app: a, nativeImage }) => ({
    resourcesPath: process.resourcesPath,
    appPath: a.getAppPath(),
    icon: nativeImage.createFromPath(`${a.getAppPath()}/resources/icon.png`).getSize().width,
    tray: nativeImage.createFromPath(`${a.getAppPath()}/resources/tray.png`).isEmpty()
  }))
  expect(res.appPath.endsWith('app.asar')).toBe(true)
  expect(res.icon).toBeGreaterThanOrEqual(256)
  expect(res.tray).toBe(false)
  for (const f of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) expect(statSync(join(res.resourcesPath, f)).size).toBeGreaterThan(500)
  expect(readFileSync(join(res.resourcesPath, 'LICENSE'), 'utf8')).toContain('MIT License')
  expect(readFileSync(join(res.resourcesPath, 'THIRD_PARTY_NOTICES.md'), 'utf8')).toContain('Inter')
  test.info().annotations.push({ type: 'unpacked size', description: `${Math.round(dirBytes(resolve('release', 'win-unpacked')) / 1024 / 1024)} MB; app.asar ${(statSync(join(res.resourcesPath, 'app.asar')).size / 1024 / 1024).toFixed(1)} MB` })

  // Hooks reach the packaged collector and the screen.
  expect(await postHook(endpoint, { ...fixture('UserPromptSubmit-1'), session_id: 'packaged-1' })).toBe(200)
  await expect(page.getByRole('region', { name: 'Running now' })).toContainText('Thinking')

  // Tasks, Daily report and Settings open and work against the packaged collector.
  const nav = page.getByRole('navigation', { name: 'Main' })
  await nav.getByRole('button', { name: /^Tasks/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tasks')
  const input = page.getByRole('combobox', { name: 'Add a task' })
  await input.fill('Packaged task')
  await input.press('Enter')
  await expect(page.getByRole('region', { name: 'To do' }).getByRole('listitem').filter({ hasText: 'Packaged task' })).toHaveCount(1)
  const [task] = (await bridge(page, 'listTasks'))!
  taskOf(await bridge(page, 'updateTask', task!.id, { status: 'done' }))

  await playSession(endpoint, 1, 'packaged-2', SESSION_CWD)
  await nav.getByRole('button', { name: /^Daily report/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Daily report')
  await expect(page.locator('dl > div').filter({ has: page.getByText('Tasks done', { exact: true }) }).locator('dd')).toHaveText('1')
  await page.getByRole('textbox', { name: 'Notes' }).fill('Packaged notes')
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 5_000 })
  await page.getByRole('button', { name: 'Write file now' }).click()
  await expect(page.getByTestId('notice')).toHaveText('Wrote the report file.')
  const md = join(userData, 'eod', `${today()}.md`)
  expect(readFileSync(md, 'utf8')).toContain('Packaged notes')
  expect(readFileSync(md, 'utf8')).toContain('Packaged task')

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Profile' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Daily report' })).toBeVisible()
  await expect(page.getByText('Checking your setup…')).toHaveCount(0, { timeout: 45_000 })
  expect(errors).toEqual([])

  // Nothing but the profile folder was used: the profile has the database and config, and it is the temp folder.
  expect(existsSync(join(userData, 'agentdeck.db'))).toBe(true)
  expect(readEndpoint(userData)).not.toBeNull()
})
