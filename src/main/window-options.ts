// BrowserWindow options as a pure function so the ADR-0010 checklist is unit-tested.
import type { BrowserWindowConstructorOptions } from 'electron'
import { MIN_HEIGHT, MIN_WIDTH, type Rect } from './window-state'

/** ADR-0011: demo mode says so in the window title and the tray tooltip. */
export const appTitle = (demo: boolean): string => (demo ? 'AgentDeck (Demo)' : 'AgentDeck')

export function buildWindowOptions(o: { bounds: Rect; preload: string; icon: string; title: string }): BrowserWindowConstructorOptions {
  return {
    ...o.bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    backgroundColor: '#F6F6F6',
    title: o.title,
    icon: o.icon,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#FFFFFF', symbolColor: '#18181B', height: 48 },
    webPreferences: {
      preload: o.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  }
}
