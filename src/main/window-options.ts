// BrowserWindow options as a pure function so the ADR-0010 checklist is unit-tested.
import type { BrowserWindowConstructorOptions, MenuItemConstructorOptions } from 'electron'
import type { ResolvedTheme } from '@shared/theme'
import { MIN_HEIGHT, MIN_WIDTH, type Rect } from './window-state'

/**
 * The window's own colours, which show where the page does not: the ground behind it before it paints, and the strip the caption
 * buttons sit on (the top bar's surface). The same values as `--ground` and `--surface` in styles.css; theme.test.ts keeps them equal.
 */
export const WINDOW_CHROME = {
  light: { background: '#F6F6F6', overlay: { color: '#FFFFFF', symbolColor: '#18181B' } },
  dark: { background: '#0E0E10', overlay: { color: '#17171A', symbolColor: '#ECECEF' } }
} as const

/** The top bar's height, which is also the caption strip's. */
const TITLE_BAR_HEIGHT = 48

export const titleBarOverlay = (theme: ResolvedTheme): { color: string; symbolColor: string; height: number } => ({
  ...WINDOW_CHROME[theme].overlay,
  height: TITLE_BAR_HEIGHT
})

/**
 * macOS: without an application menu Cmd+C, Cmd+V, Cmd+Q and Cmd+W do nothing. Standard roles only (File holds Close Window);
 * View has no Reload, DevTools or zoom, as a packaged Windows build has none of them (index.ts drops its menu).
 */
export const macMenu = (): MenuItemConstructorOptions[] => [
  { role: 'appMenu' },
  { role: 'fileMenu' },
  { role: 'editMenu' },
  { label: 'View', submenu: [{ role: 'togglefullscreen' }] },
  { role: 'windowMenu' }
]

/** ADR-0011: demo mode says so in the window title and the tray tooltip. */
export const appTitle = (demo: boolean): string => (demo ? 'AgentDeck (Demo)' : 'AgentDeck')

/**
 * macOS draws its own traffic lights over the sidebar's top-left corner, centred in the 48 px top bar (12 px buttons). The
 * renderer keeps that corner clear (`html[data-platform='darwin'] .traffic-inset` in styles.css).
 */
export const TRAFFIC_LIGHTS = { x: 16, y: (TITLE_BAR_HEIGHT - 12) / 2 }

/** Windows: our own top bar with the system caption buttons over its right end. macOS: the traffic lights, inset. */
const chrome = (theme: ResolvedTheme, platform: NodeJS.Platform): BrowserWindowConstructorOptions =>
  platform === 'darwin'
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: TRAFFIC_LIGHTS }
    : { titleBarStyle: 'hidden', titleBarOverlay: titleBarOverlay(theme) }

export function buildWindowOptions(
  o: { bounds: Rect; preload: string; icon: string; title: string; theme?: ResolvedTheme },
  platform: NodeJS.Platform = process.platform
): BrowserWindowConstructorOptions {
  const theme = o.theme ?? 'light'
  return {
    ...o.bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    backgroundColor: WINDOW_CHROME[theme].background,
    title: o.title,
    icon: o.icon,
    ...chrome(theme, platform),
    webPreferences: {
      preload: o.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  }
}
