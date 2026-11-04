import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import type { AgentDeckBridge } from '../src/shared/bridge'

const MAIN = 'out/main/index.js'
const ELECTRON_EXE = join('node_modules/electron/dist', readFileSync('node_modules/electron/path.txt', 'utf8'))

let launched: ElectronApplication[] = []
let dirs: string[] = []

function freshUserData(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentdeck-e2e-'))
  dirs.push(dir)
  return dir
}

/** This machine runs inside Claude Code; none of its CLAUDE* vars may leak into the app. */
function appEnv(userData: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('CLAUDE')) env[key] = value
  }
  return { ...env, AGENTDECK_USER_DATA: userData }
}

async function launch(userData: string, extraArgs: string[] = []): Promise<ElectronApplication> {
  const app = await electron.launch({ args: [MAIN, ...extraArgs], env: appEnv(userData) })
  launched.push(app)
  await app.firstWindow()
  return app
}

function windowState(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows()
    const w = all[0]
    if (!w) return { count: 0, visible: false, minimized: false, focused: false }
    return { count: all.length, visible: w.isVisible(), minimized: w.isMinimized(), focused: w.isFocused() }
  })
}

async function expectVisible(app: ElectronApplication, visible: boolean): Promise<void> {
  await expect.poll(async () => (await windowState(app)).visible, { timeout: 15_000 }).toBe(visible)
}

test.afterEach(async () => {
  // close() quits through app.quit(), which is the path that bypasses hide-to-tray.
  await Promise.all(launched.map((app) => app.close().catch(() => undefined)))
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  launched = []
  dirs = []
})

test('window appears with the demo title, minimum size and locked-down renderer', async () => {
  const app = await launch(freshUserData())
  await expectVisible(app, true)

  const info = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!
    // getLastWebPreferences exists at runtime but is missing from electron.d.ts.
    const wc = w.webContents as unknown as { getLastWebPreferences(): Record<string, unknown>; getURL(): string }
    const p = wc.getLastWebPreferences()
    return {
      title: w.getTitle(),
      bounds: w.getBounds(),
      minimumSize: w.getMinimumSize(),
      url: wc.getURL(),
      prefs: { contextIsolation: p.contextIsolation, sandbox: p.sandbox, nodeIntegration: p.nodeIntegration, webSecurity: p.webSecurity }
    }
  })
  expect(info.title).toBe('AgentDeck (Demo)')
  expect(info.bounds.width).toBeGreaterThanOrEqual(1200)
  expect(info.bounds.height).toBeGreaterThanOrEqual(760)
  expect(info.minimumSize).toEqual([1200, 760])
  expect(info.url).toBe('app://agentdeck/index.html')
  expect(info.prefs).toEqual({ contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true })

  const page = await app.firstWindow()
  const renderer = await page.evaluate(async () => {
    const g = globalThis as { agentdeck?: AgentDeckBridge; require?: unknown; process?: unknown }
    return { appInfo: await g.agentdeck?.getAppInfo(), require: typeof g.require, process: typeof g.process }
  })
  expect(renderer.appInfo?.demo).toBe(true)
  expect(renderer.require).toBe('undefined')
  expect(renderer.process).toBe('undefined')

  // app:// never serves anything outside out/renderer, however the path is spelled.
  const statuses = await page.evaluate(async () => {
    const paths = ['/index.html', '/../../package.json', '/..%2F..%2Fpackage.json', '/..%5C..%5Cpackage.json', '/assets/', '/nope.js']
    return Promise.all(paths.map(async (p) => (await fetch(`app://agentdeck${p}`)).status))
  })
  expect(statuses).toEqual([200, 404, 404, 404, 404, 404])
})

test('closing hides to the tray, keeps running, and the open path shows it again', async () => {
  const userData = freshUserData()
  const app = await launch(userData)
  await expectVisible(app, true)

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
  await expectVisible(app, false)
  expect((await windowState(app)).count).toBe(1)
  // The one-time tray hint is recorded so it is never shown again.
  expect(JSON.parse(readFileSync(join(userData, 'config.json'), 'utf8')).trayHintShown).toBe(true)

  // Tray "Open AgentDeck", tray clicks and second-instance all call the same showWindow().
  await app.evaluate(({ app: electronApp }) => {
    electronApp.emit('second-instance')
  })
  await expectVisible(app, true)
})

test('bounds saved on close are restored on relaunch', async () => {
  const userData = freshUserData()
  const first = await launch(userData)
  await expectVisible(first, true)

  const saved = await first.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0]!
    const area = screen.getPrimaryDisplay().workArea
    w.setBounds({ x: area.x + 37, y: area.y + 23, width: 1250, height: 780 })
    return w.getBounds()
  })
  await first.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
  await expectVisible(first, false)
  await first.close()

  const second = await launch(userData)
  await expectVisible(second, true)
  const restored = await second.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds())
  expect(restored).toEqual(saved)
})

test('a second launch exits on its own and brings the first window back', async () => {
  const userData = freshUserData()
  const first = await launch(userData)
  await expectVisible(first, true)
  await first.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!
    w.minimize()
    w.hide()
  })
  await expectVisible(first, false)

  const second = spawn(ELECTRON_EXE, [MAIN], { env: appEnv(userData), stdio: 'ignore' })
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      second.kill()
      reject(new Error('second instance did not exit within 15 s'))
    }, 15_000)
    second.once('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
  expect(exitCode).toBe(0)

  await expect
    .poll(async () => {
      const s = await windowState(first)
      return { visible: s.visible, minimized: s.minimized, focused: s.focused }
    }, { timeout: 15_000 })
    .toEqual({ visible: true, minimized: false, focused: true })
})

test('--hidden starts in the tray without showing the window', async () => {
  const app = await launch(freshUserData(), ['--hidden'])
  const page = await app.firstWindow()
  await page.waitForLoadState('load')
  // A negative check needs a window of time: ready-to-show fires around first paint after load.
  await page.waitForTimeout(750)
  expect(await windowState(app)).toMatchObject({ count: 1, visible: false })

  await app.evaluate(({ app: electronApp }) => {
    electronApp.emit('second-instance')
  })
  await expectVisible(app, true)
})
