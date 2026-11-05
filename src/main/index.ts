import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, ipcMain, Menu, session, type BrowserWindow, type Tray } from 'electron'
import { z } from 'zod'
import { IPC, type AppInfo } from '@shared/bridge'
import type { FromCollector } from '@shared/collector'
import type { Snapshot } from '@shared/snapshot'
import { superviseCollector, type Supervisor } from './collector'
import { readConfig, updateConfig } from './config'
import { registerAppScheme, serveRenderer } from './protocol'
import { createTray } from './tray'
import { createMainWindow, showWindow } from './window'
import { appTitle } from './window-options'

// out/main -> project root (dev) or app.asar root (packaged); works for `electron .` and `electron out/main/index.js`.
const RESOURCES = join(__dirname, '../../resources')
const RENDERER_ROOT = join(__dirname, '../renderer')
const COLLECTOR_ENTRY = join(__dirname, 'collector.js')
/** D-001 */
const PORTS = Array.from({ length: 11 }, (_, i) => 47821 + i)

// Test isolation: must precede anything that reads userData, including the single-instance lock.
const userDataOverride = process.env.AGENTDECK_USER_DATA
if (userDataOverride) app.setPath('userData', userDataOverride)
app.setAppUserModelId('com.thirdcode.agentdeck')

let win: BrowserWindow | undefined
let tray: Tray | undefined // module-level so it is not garbage-collected
let collector: Supervisor | null = null
let latest: Snapshot | null = null
let demo = false

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  registerAppScheme()
  app.on('second-instance', () => openWindow())
  app.on('window-all-closed', () => {
    // Keep running in the tray: quitting happens only from the tray menu.
  })
  app.on('will-quit', () => collector?.stop())
  void app.whenReady().then(start)
}

function configFile(): string {
  return join(app.getPath('userData'), 'config.json')
}

/** ADR-0010: 32 random bytes, hex, kept in config.json (user profile). Never sent to the renderer. */
function hookToken(): string {
  const saved = readConfig(configFile()).token
  if (typeof saved === 'string' && /^[0-9a-f]{64}$/.test(saved)) return saved
  const token = randomBytes(32).toString('hex')
  updateConfig(configFile(), { token })
  return token
}

function startCollector(): void {
  const config = readConfig(configFile())
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  collector = superviseCollector(
    COLLECTOR_ENTRY,
    {
      type: 'init',
      dbPath: join(app.getPath('userData'), 'agentdeck.db'),
      token: hookToken(),
      ports: PORTS,
      agentsDir: join(configDir, 'agents'),
      // AGENTDECK_POLL=0: smoke tests must not list the real sessions on the machine running them.
      claude: process.env.AGENTDECK_POLL === '0' ? false : typeof config.claudePath === 'string' ? config.claudePath : undefined
    },
    onCollectorMessage,
    onCollectorDown
  )
  if (win && !win.isDestroyed()) sendWindowState(win)
}

/** D-059: until it is back, the renderer shows that it is restarting instead of an empty, "all quiet" Home. */
function onCollectorDown(): void {
  latest = null
  if (win && !win.isDestroyed()) win.webContents.send(IPC.snapshotPush, null)
}

function onCollectorMessage(m: FromCollector): void {
  if (m.type === 'ready') {
    // The scratch-project hook config (npm run scratch:hooks) reads the port from here; M3's installer will too.
    updateConfig(configFile(), { collectorPort: m.port })
  } else if (m.type === 'snapshot') {
    latest = m.snapshot
    if (win && !win.isDestroyed()) win.webContents.send(IPC.snapshotPush, m.snapshot)
  } else {
    console.error(`[collector] ${m.message}`)
  }
}

/** The poll slows down while nobody can see the window (D-005); "while you were away" starts on blur (D-007). */
function sendVisible(w: BrowserWindow): void {
  collector?.post({ type: 'visible', visible: w.isVisible() && !w.isMinimized() })
}
function sendFocus(focused: boolean): void {
  collector?.post({ type: 'focus', focused, at: Date.now() })
}
function sendWindowState(w: BrowserWindow): void {
  sendVisible(w)
  sendFocus(w.isFocused())
}

function watchWindow(w: BrowserWindow): void {
  const visible = (): void => sendVisible(w)
  w.on('show', visible)
  w.on('hide', visible)
  w.on('minimize', visible)
  w.on('restore', visible)
  w.on('focus', () => sendFocus(true))
  w.on('blur', () => sendFocus(false))
  sendWindowState(w)
}

function newWindow(hidden: boolean): BrowserWindow {
  const w = createMainWindow({
    hidden,
    icon: join(RESOURCES, 'icon.png'),
    title: appTitle(demo),
    onHiddenToTray: () => showTrayHintOnce(configFile())
  })
  watchWindow(w)
  return w
}

/** Shows the window, recreating it if something (a crash, a logoff race) destroyed it. */
function openWindow(): void {
  if (!app.isReady()) return
  if (!win || win.isDestroyed()) {
    win = newWindow(false)
    return // createMainWindow reveals it on ready-to-show
  }
  showWindow(win)
}

/** ADR-0011: switching modes restarts against the other source, so nothing is shared between them. */
function setDemo(on: boolean): void {
  if (on === demo) return
  demo = on
  updateConfig(configFile(), { demo: on })
  collector?.stop()
  collector = null
  latest = null
  if (!on) startCollector()
  win?.setTitle(appTitle(on))
  tray?.setToolTip(appTitle(on))
  win?.webContents.reload()
}

function start(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  // Packaged builds drop the default menu, whose accelerators include DevTools and Reload.
  if (app.isPackaged) Menu.setApplicationMenu(null)
  serveRenderer(RENDERER_ROOT)
  demo = readConfig(configFile()).demo === true
  ipcMain.handle(IPC.appInfo, (): AppInfo => ({ version: app.getVersion(), demo }))
  ipcMain.handle(IPC.snapshot, (): Snapshot | null => (demo ? null : latest))
  ipcMain.handle(IPC.setDemo, (_e, on: unknown) => setDemo(z.boolean().parse(on)))
  registerAutostartOnce(configFile())

  win = newWindow(process.argv.includes('--hidden'))
  tray = createTray(join(RESOURCES, 'tray.png'), appTitle(demo), { open: openWindow, quit: () => app.quit() })
  if (!demo) startCollector()
}

/** ADR-0012: register the login item on the first packaged run only; never the dev electron.exe. */
function registerAutostartOnce(configFile: string): void {
  if (!app.isPackaged || readConfig(configFile).autostartConfigured === true) return
  app.setLoginItemSettings({ openAtLogin: true })
  updateConfig(configFile, { autostartConfigured: true })
}

function showTrayHintOnce(configFile: string): void {
  if (!tray || readConfig(configFile).trayHintShown === true) return
  tray.displayBalloon({
    title: 'AgentDeck is still running',
    content: 'It keeps watching your agents from the tray. Quit from the tray menu.'
  })
  updateConfig(configFile, { trayHintShown: true })
}
