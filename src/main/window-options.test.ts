// ADR-0010: Electron's security checklist is enforced over the BrowserWindow options.
import { expect, test } from 'vitest'
import { TRAFFIC_LIGHTS, appTitle, buildWindowOptions, macMenu, titleBarOverlay } from './window-options'

const base = {
  bounds: { x: 1, y: 2, width: 1300, height: 800 },
  preload: 'C:/app/out/preload/index.js',
  icon: 'C:/app/resources/icon.png',
  title: appTitle(false)
}
const opts = buildWindowOptions(base, 'win32')

test('macOS: the same isolated renderer, with the traffic lights inset in the 48 px bar and no caption overlay', () => {
  const mac = buildWindowOptions({ ...base, theme: 'dark' }, 'darwin')
  expect(mac.webPreferences).toEqual(opts.webPreferences)
  expect(mac).toMatchObject({ titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 }, backgroundColor: '#0E0E10', show: false })
  expect(mac.titleBarOverlay).toBeUndefined()
  // The 12 px lights sit centred in the bar, as the window controls do on Windows.
  expect(TRAFFIC_LIGHTS.y * 2 + 12).toBe(48)
})

test('macOS menu bar: the standard app, file, edit, view and window menus, so Cmd-C/V/Q and friends work', () => {
  expect(macMenu().map((m) => m.role ?? m.label)).toEqual(['appMenu', 'fileMenu', 'editMenu', 'View', 'windowMenu'])
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
    title: 'AgentDeck',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#FFFFFF', symbolColor: '#18181B', height: 48 }
  })
  expect(appTitle(true)).toBe('AgentDeck (Demo)')
})

test('the dark window paints a dark ground and a dark caption strip with light symbols', () => {
  const dark = buildWindowOptions({ bounds: { x: 0, y: 0, width: 1300, height: 800 }, preload: 'p', icon: 'i', title: 'AgentDeck', theme: 'dark' }, 'win32')
  expect(dark).toMatchObject({ backgroundColor: '#0E0E10', titleBarOverlay: { color: '#17171A', symbolColor: '#ECECEF', height: 48 } })
  expect(titleBarOverlay('light')).toEqual({ color: '#FFFFFF', symbolColor: '#18181B', height: 48 })
})
