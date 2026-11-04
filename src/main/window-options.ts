// BrowserWindow options as a pure function so the ADR-0010 checklist is unit-tested.
import type { BrowserWindowConstructorOptions } from 'electron'
import { MIN_HEIGHT, MIN_WIDTH, type Rect } from './window-state'

/** M1 always runs on demo data (ADR-0011); the renderer may not change it. */
export const APP_TITLE = 'AgentDeck (Demo)'

export function buildWindowOptions(o: { bounds: Rect; preload: string; icon: string }): BrowserWindowConstructorOptions {
  return {
    ...o.bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    backgroundColor: '#F6F6F6',
    title: APP_TITLE,
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
