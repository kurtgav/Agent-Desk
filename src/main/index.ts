import { join } from 'node:path'
import { app, ipcMain, session, type BrowserWindow, type Tray } from 'electron'
import { IPC, type AppInfo } from '@shared/bridge'
import { readConfig, updateConfig } from './config'
import { registerAppScheme, serveRenderer } from './protocol'
import { createTray } from './tray'
import { createMainWindow, showWindow } from './window'

// out/main -> project root (dev) or app.asar root (packaged); works for `electron .` and `electron out/main/index.js`.
const RESOURCES = join(__dirname, '../../resources')
const RENDERER_ROOT = join(__dirname, '../renderer')

// Test isolation: must precede anything that reads userData, including the single-instance lock.
const userDataOverride = process.env.AGENTDECK_USER_DATA
if (userDataOverride) app.setPath('userData', userDataOverride)
app.setAppUserModelId('com.thirdcode.agentdeck')

let win: BrowserWindow | undefined
let tray: Tray | undefined // module-level so it is not garbage-collected

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  registerAppScheme()
  app.on('second-instance', () => {
    if (win) showWindow(win)
  })
  app.on('window-all-closed', () => {
    // Keep running in the tray: quitting happens only from the tray menu.
  })
  void app.whenReady().then(start)
}

function start(): void {
  const configFile = join(app.getPath('userData'), 'config.json')

  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  serveRenderer(RENDERER_ROOT)
  ipcMain.handle(IPC.appInfo, (): AppInfo => ({ version: app.getVersion(), demo: true }))
  registerAutostartOnce(configFile)

  const mainWindow = createMainWindow({
    hidden: process.argv.includes('--hidden'),
    icon: join(RESOURCES, 'icon.png'),
    onHiddenToTray: () => showTrayHintOnce(configFile)
  })
  win = mainWindow
  tray = createTray(join(RESOURCES, 'tray.png'), {
    open: () => showWindow(mainWindow),
    quit: () => app.quit()
  })
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
