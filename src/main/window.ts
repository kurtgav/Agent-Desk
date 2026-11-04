import { join } from 'node:path'
import { app, BrowserWindow, screen } from 'electron'
import { APP_ENTRY, isAppUrl } from './app-url'
import { readJson, writeJson } from './config'
import { buildWindowOptions } from './window-options'
import { resolveWindowState } from './window-state'

const SAVE_DELAY_MS = 500

export function showWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

export interface MainWindowOptions {
  /** `--hidden`: start in the tray without showing the window. */
  hidden: boolean
  icon: string
  /** Called each time a close is turned into hide-to-tray. */
  onHiddenToTray: () => void
}

export function createMainWindow(opts: MainWindowOptions): BrowserWindow {
  const stateFile = join(app.getPath('userData'), 'window-state.json')
  const state = resolveWindowState(
    readJson(stateFile),
    screen.getAllDisplays().map((d) => d.workArea),
    screen.getPrimaryDisplay().workArea
  )
  const win = new BrowserWindow(
    buildWindowOptions({ bounds: state.bounds, preload: join(__dirname, '../preload/index.js'), icon: opts.icon })
  )

  lockDown(win)
  persistState(win, stateFile)
  closeToTray(win, opts.onHiddenToTray)

  if (opts.hidden) {
    // Restore the maximized state the first time the tray brings the window up.
    win.once('show', () => {
      if (state.maximized) win.maximize()
    })
  } else {
    // maximize() also shows the window, so it doubles as the reveal.
    win.once('ready-to-show', () => (state.maximized ? win.maximize() : win.show()))
  }

  void win.loadURL(devUrl() ?? APP_ENTRY)
  return win
}

/** electron-vite's dev server; never honoured in a packaged build (no remote content in a privileged window). */
function devUrl(): string | undefined {
  return app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
}

function lockDown(win: BrowserWindow): void {
  const allowedDevUrl = devUrl()
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => {
    if (!isAppUrl(event.url, allowedDevUrl)) event.preventDefault()
  })
  // The title is fixed for M1 (demo); the page's <title> must not replace it.
  win.on('page-title-updated', (event) => event.preventDefault())
}

function persistState(win: BrowserWindow, stateFile: string): void {
  let timer: NodeJS.Timeout | undefined
  const save = (): void => {
    clearTimeout(timer)
    if (win.isDestroyed()) return
    writeJson(stateFile, { bounds: win.getNormalBounds(), maximized: win.isMaximized() })
  }
  const saveSoon = (): void => {
    clearTimeout(timer)
    timer = setTimeout(save, SAVE_DELAY_MS)
  }
  win.on('move', saveSoon)
  win.on('resize', saveSoon)
  win.on('hide', save)
  win.on('close', save)
}

function closeToTray(win: BrowserWindow, onHiddenToTray: () => void): void {
  let quitting = false
  const allowClose = (): void => {
    quitting = true
  }
  app.on('before-quit', allowClose)
  // Windows logoff/shutdown must never be blocked by our hide-on-close.
  win.on('query-session-end', allowClose)
  win.on('session-end', allowClose)

  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    win.hide()
    onHiddenToTray()
  })
}
