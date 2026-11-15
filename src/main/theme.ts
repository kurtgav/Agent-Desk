import { nativeTheme, type BrowserWindow } from 'electron'
import { envThemeSeed, type ResolvedTheme } from '@shared/theme'
import type { ThemeChoice } from '@shared/work'
import { WINDOW_CHROME, titleBarOverlay } from './window-options'

/**
 * Light / dark in the main process. `nativeTheme.themeSource` follows the choice, so native menus and dialogs match and the
 * page's own `prefers-color-scheme` agrees; each window's ground and caption strip are repainted whenever the resolved theme changes.
 */

/** AGENTDECK_THEME beats the stored choice until the person changes the theme in this run. */
let seed: ThemeChoice | null = envThemeSeed(process.env)
let started = false
const windows = new Set<BrowserWindow>()

/** What the user should be shown for `stored`: the env seed while it stands, otherwise `stored`. */
export const effectiveChoice = (stored: ThemeChoice): ThemeChoice => seed ?? stored

export const resolvedTheme = (): ResolvedTheme => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')

function paint(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const theme = resolvedTheme()
  win.setBackgroundColor(WINDOW_CHROME[theme].background)
  // macOS has no caption overlay (its traffic lights follow the system), and no setTitleBarOverlay to call.
  if (process.platform !== 'darwin') win.setTitleBarOverlay(titleBarOverlay(theme))
}

/** Before the first window: applies the stored choice and follows the OS when it flips. Later calls change nothing. */
export function startTheme(stored: ThemeChoice): void {
  if (started) return
  started = true
  nativeTheme.themeSource = effectiveChoice(stored)
  nativeTheme.on('updated', () => windows.forEach(paint))
}

/** The person chose a theme (Settings, the top bar's button). */
export function changeTheme(choice: ThemeChoice): void {
  seed = null
  nativeTheme.themeSource = choice
  windows.forEach(paint)
}

/** The window takes the theme's colours now and on every change. */
export function followTheme(win: BrowserWindow): void {
  windows.add(win)
  win.once('closed', () => windows.delete(win))
  paint(win)
}
