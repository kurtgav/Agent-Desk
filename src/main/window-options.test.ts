// ADR-0010: Electron's security checklist is enforced over the BrowserWindow options.
import { expect, test } from 'vitest'
import { APP_TITLE, buildWindowOptions } from './window-options'

const opts = buildWindowOptions({
  bounds: { x: 1, y: 2, width: 1300, height: 800 },
  preload: 'C:/app/out/preload/index.js',
  icon: 'C:/app/resources/icon.png'
})

test('renderer is isolated, sandboxed and has no Node', () => {
  expect(opts.webPreferences).toEqual({
    preload: 'C:/app/out/preload/index.js',
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true
  })
})

test('window starts hidden with the M1 shell look', () => {
  expect(opts).toMatchObject({
    x: 1,
    y: 2,
    width: 1300,
    height: 800,
    minWidth: 1200,
    minHeight: 760,
    show: false,
    backgroundColor: '#F6F6F6',
    title: APP_TITLE,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#FFFFFF', symbolColor: '#18181B', height: 48 }
  })
  expect(APP_TITLE).toBe('AgentDeck (Demo)')
})
