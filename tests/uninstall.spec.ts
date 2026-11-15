import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { install } from '../src/main/hooks'
import { MAIN, cleanup, collectorReady, isolatedEnv, launch, profile } from './support'

// `AgentDeck.exe --uninstall-integration` is what the NSIS uninstaller runs (build/installer.nsh, ADR-0005 § 5, ADR-0012):
// it must take only our entries out of settings.json and leave without a window, a lock or a delay. Run against the dev
// build always, and against release/win-unpacked when `npm run pack` has made it. A temp profile is both AGENTDECK_USER_DATA
// and CLAUDE_CONFIG_DIR, so the real %APPDATA%\AgentDeck and ~/.claude are never touched.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ELECTRON_EXE = require('electron') as string
const PACKED = join('release', 'win-unpacked', 'AgentDeck.exe')

const TOKEN = 'ab'.repeat(32)
const PORT = 47999
/** Hand-edited and CRLF: an inline object, a foreign hook on an event we also use, and a foreign http hook shaped almost like ours. */
const USER_SETTINGS =
  '{\r\n  "theme": "dark",\r\n  "env": { "KEEP": "1" },\r\n  "permissions": { "allow": ["Bash(npm test)"] },\r\n  "hooks": {\r\n' +
  '    "Stop": [\r\n      { "hooks": [{ "type": "command", "command": "echo done" }] }\r\n    ],\r\n' +
  '    "PreToolUse": [\r\n      { "matcher": "Bash", "hooks": [{ "type": "http", "url": "http://127.0.0.1:5000/hooks", "headers": { "X-Other": "1" } }] }\r\n    ]\r\n  }\r\n}\r\n'

/**
 * The dev build's main script, started through this wrapper: it notes the single-instance lock, `ready`, and every window
 * or web contents the app makes, then loads the real entry. (A packaged app runs only its own asar, so it gets no spy.)
 */
const SPY = `
const { app } = require('electron')
const { appendFileSync } = require('node:fs')
const log = (line) => appendFileSync(process.env.AGENTDECK_SPY, line + '\\n')
const lock = app.requestSingleInstanceLock.bind(app)
app.requestSingleInstanceLock = (...args) => { log('lock'); return lock(...args) }
app.on('ready', () => log('ready'))
app.on('browser-window-created', () => log('window'))
app.on('web-contents-created', () => log('webcontents'))
require(process.env.AGENTDECK_ENTRY)
`

interface Target {
  name: string
  exe: string
  /** Null for the packaged app, which cannot be wrapped. */
  spied: boolean
}
const TARGETS: Target[] = [{ name: 'dev build', exe: ELECTRON_EXE, spied: true }, ...(existsSync(PACKED) ? [{ name: 'packaged app', exe: PACKED, spied: false }] : [])]

test.afterEach(cleanup)

interface Setup {
  userData: string
  settings: string
  spy: string
  spyLog: string
}

function setup(config: Record<string, unknown> = {}): Setup {
  const userData = profile('uninstall')
  const spy = join(userData, 'spy.cjs')
  writeFileSync(spy, SPY)
  // autostartConfigured: a packaged first run would otherwise register a Windows login item, outside the temp profile.
  writeFileSync(join(userData, 'config.json'), JSON.stringify({ autostartConfigured: true, ...config }))
  return { userData, settings: join(userData, 'settings.json'), spy, spyLog: join(userData, 'spy.log') }
}

const marks = (s: Setup): string[] => (existsSync(s.spyLog) ? readFileSync(s.spyLog, 'utf8').split('\n').filter(Boolean) : [])
const spyEnv = (s: Setup): Record<string, string> => ({ AGENTDECK_SPY: s.spyLog, AGENTDECK_ENTRY: resolve(MAIN) })

/** Adds our entries the way the app does (the real writer), so the test starts from a settings.json the installer really made. */
function installOurs(s: Setup, original: string, endpoint = { port: PORT, token: TOKEN }): void {
  writeFileSync(s.settings, original)
  const r = install({ settings: s.settings, backups: join(s.userData, 'backups') }, endpoint)
  expect(r).toEqual({ ok: true })
  const installed = readFileSync(s.settings, 'utf8')
  expect(installed).toContain(endpoint.token)
  expect(installed).toContain('"Bash(npm test)"')
}

interface Result {
  code: number | null
  ms: number
  stderr: string
}

/** Runs `exe --uninstall-integration` as a child process, as the uninstaller does, and waits for it to exit. */
function uninstall(t: Target, s: Setup): Promise<Result> {
  return new Promise((resolveRun, reject) => {
    const started = Date.now()
    const args = t.spied ? [s.spy, '--uninstall-integration'] : ['--uninstall-integration']
    const child = spawn(t.exe, args, { env: { ...isolatedEnv(s.userData), ...spyEnv(s) }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('--uninstall-integration did not exit within 15 s'))
    }, 15_000)
    child.on('error', reject)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolveRun({ code, ms: Date.now() - started, stderr })
    })
  })
}

const consent = { hooksConsent: 'timeout-default', hooksConsentPath: 'x', remoteApprovals: { enabled: true, waitSec: 30 }, mystery: 'kept' }
const readConfig = (s: Setup): Record<string, unknown> => JSON.parse(readFileSync(join(s.userData, 'config.json'), 'utf8')) as Record<string, unknown>

for (const t of TARGETS) {
  test.describe(t.name, () => {
    test('removes only our entries, leaves the rest byte for byte, exits 0 fast, opens no window and takes no lock', async () => {
      const s = setup(consent)
      installOurs(s, USER_SETTINGS)

      const r = await uninstall(t, s)
      expect(r.stderr).not.toContain('[hooks]') // Chromium may print cache notices of its own
      expect(r.code).toBe(0)
      expect(r.ms).toBeLessThan(8_000) // the uninstaller gives it 10 s
      expect(readFileSync(s.settings, 'utf8')).toBe(USER_SETTINGS)
      expect(readdirSync(join(s.userData, 'backups')).length).toBeGreaterThanOrEqual(1)

      // The consent goes with the entries (a later install starts from "off" again); keys it does not know stay.
      expect(readConfig(s)).toMatchObject({ hooksConsent: null, mystery: 'kept', remoteApprovals: { enabled: false, waitSec: 30 } })
      if (t.spied) expect(marks(s)).toEqual(['ready']) // no lock, no window, no web contents
    })

    test('a second run changes nothing and still exits 0', async () => {
      const s = setup(consent)
      installOurs(s, USER_SETTINGS)
      expect((await uninstall(t, s)).code).toBe(0)
      const backups = readdirSync(join(s.userData, 'backups'))
      const config = readFileSync(join(s.userData, 'config.json'), 'utf8')

      const again = await uninstall(t, s)
      expect(again.code).toBe(0)
      expect(again.stderr).not.toContain('[hooks]')
      expect(readFileSync(s.settings, 'utf8')).toBe(USER_SETTINGS)
      expect(readdirSync(join(s.userData, 'backups'))).toEqual(backups)
      expect(readFileSync(join(s.userData, 'config.json'), 'utf8')).toBe(config)
    })

    test('no settings.json is a clean no-op; one it cannot read is left alone and reported with exit 1', async () => {
      const none = setup()
      expect((await uninstall(t, none)).code).toBe(0)
      expect(existsSync(none.settings)).toBe(false)

      const broken = setup()
      const text = '{ "hooks": { "Stop": [ '
      writeFileSync(broken.settings, text)
      const r = await uninstall(t, broken)
      expect(r.code).toBe(1)
      expect(r.stderr).toContain('[hooks] uninstall integration')
      expect(readFileSync(broken.settings, 'utf8')).toBe(text)
    })
  })
}

test('it works beside a running AgentDeck: no lock is taken and the running window is not touched', async () => {
  const s = setup(consent)
  const { app, page } = await launch(s.userData)
  await expect(page.getByTestId('home')).toBeVisible()
  const endpoint = await collectorReady(s.userData)
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)

  // The running app's own port and token, as an installed app would have written them.
  installOurs(s, USER_SETTINGS, endpoint)

  const r = await uninstall(TARGETS[0]!, s)
  expect(r.code).toBe(0)
  expect(r.stderr).not.toContain('[hooks]')
  expect(readFileSync(s.settings, 'utf8')).toBe(USER_SETTINGS)
  expect(marks(s)).toEqual(['ready'])

  // The first instance never heard of it: one window, still answering, and it still quits cleanly.
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  await expect(page.getByTestId('home')).toBeVisible()
  await app.close()
  expect(readFileSync(s.settings, 'utf8')).toBe(USER_SETTINGS)
})

test('the spy sees what a normal start does (so "no lock, no window" above means something)', async () => {
  const s = setup()
  const { page } = await launch(s.userData, { main: s.spy, env: spyEnv(s) })
  await expect(page.getByTestId('home')).toBeVisible()
  expect(marks(s)).toEqual(expect.arrayContaining(['ready', 'lock', 'window', 'webcontents']))
})

if (existsSync(PACKED)) {
  test('the packaged app works beside a running packaged AgentDeck too', async () => {
    const s = setup(consent)
    const { app, page } = await launch(s.userData, { executablePath: PACKED })
    await expect(page.getByTestId('home')).toBeVisible()
    const endpoint = await collectorReady(s.userData)
    installOurs(s, USER_SETTINGS, endpoint)

    expect((await uninstall(TARGETS[1]!, s)).code).toBe(0)
    expect(readFileSync(s.settings, 'utf8')).toBe(USER_SETTINGS)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  })
}
