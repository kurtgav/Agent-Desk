import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

/** A stand-in for electron's nativeTheme: setting the source decides `shouldUseDarkColors`, as it does in the real one. */
class FakeNativeTheme extends EventEmitter {
  osDark = false
  private source: 'system' | 'light' | 'dark' = 'system'
  get themeSource(): string {
    return this.source
  }
  set themeSource(value: 'system' | 'light' | 'dark') {
    this.source = value
    this.emit('updated')
  }
  get shouldUseDarkColors(): boolean {
    return this.source === 'system' ? this.osDark : this.source === 'dark'
  }
}

let nativeTheme: FakeNativeTheme
const MAC = process.platform === 'darwin'

vi.mock('electron', () => ({
  get nativeTheme() {
    return nativeTheme
  }
}))

/** A window that records what main paints on it. */
function fakeWindow() {
  const events = new EventEmitter()
  return {
    background: '',
    overlay: undefined as unknown,
    isDestroyed: () => false,
    setBackgroundColor(c: string) {
      this.background = c
    },
    setTitleBarOverlay(o: unknown) {
      this.overlay = o
    },
    once: (name: string, fn: () => void) => events.once(name, fn),
    close: () => events.emit('closed')
  }
}

/** The module keeps its seed and "started" flag at module level, so each test loads a fresh copy under its own environment. */
async function load(seed?: string) {
  vi.resetModules()
  if (seed) process.env.AGENTDECK_THEME = seed
  else delete process.env.AGENTDECK_THEME
  return import('./theme')
}

beforeEach(() => {
  nativeTheme = new FakeNativeTheme()
})
afterEach(() => {
  delete process.env.AGENTDECK_THEME
})

describe('start-up', () => {
  it('follows the stored choice, and resolves system through the OS', async () => {
    const theme = await load()
    nativeTheme.osDark = true
    theme.startTheme('system')
    expect(nativeTheme.themeSource).toBe('system')
    expect(theme.resolvedTheme()).toBe('dark')

    const other = await load()
    nativeTheme = new FakeNativeTheme()
    other.startTheme('light')
    expect(other.resolvedTheme()).toBe('light')
  })

  it('AGENTDECK_THEME beats the stored choice, and what the page is told matches it', async () => {
    const theme = await load('dark')
    theme.startTheme('light')
    expect(nativeTheme.themeSource).toBe('dark')
    expect(theme.effectiveChoice('light')).toBe('dark')
  })

  it('ignores a seed that is not light or dark', async () => {
    const theme = await load('system')
    theme.startTheme('light')
    expect(nativeTheme.themeSource).toBe('light')
  })

  it('starts once: a window created later does not reset the theme', async () => {
    const theme = await load()
    theme.startTheme('light')
    theme.changeTheme('dark')
    theme.startTheme('light')
    expect(nativeTheme.themeSource).toBe('dark')
  })
})

describe('a window', () => {
  it('takes the theme colours when it starts to follow, and again whenever the theme changes', async () => {
    const theme = await load()
    theme.startTheme('light')
    const win = fakeWindow()
    theme.followTheme(win as unknown as BrowserWindow)
    expect(win.background).toBe('#F6F6F6')
    expect(win.overlay).toEqual(MAC ? undefined : { color: '#FFFFFF', symbolColor: '#18181B', height: 48 })

    theme.changeTheme('dark')
    expect(win.background).toBe('#0E0E10')
    expect(win.overlay).toEqual(MAC ? undefined : { color: '#17171A', symbolColor: '#ECECEF', height: 48 })
  })

  it('on macOS paints the ground only: the traffic lights have no caption overlay to set', async () => {
    const real = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    try {
      const theme = await load()
      theme.startTheme('dark')
      const win = fakeWindow()
      theme.followTheme(win as unknown as BrowserWindow)
      expect(win.background).toBe('#0E0E10')
      expect(win.overlay).toBeUndefined()
    } finally {
      Object.defineProperty(process, 'platform', { value: real })
    }
  })

  it('follows the OS flipping while the choice is system', async () => {
    const theme = await load()
    theme.startTheme('system')
    const win = fakeWindow()
    theme.followTheme(win as unknown as BrowserWindow)
    expect(win.background).toBe('#F6F6F6')

    nativeTheme.osDark = true
    nativeTheme.emit('updated')
    expect(win.background).toBe('#0E0E10')
  })

  it('a closed window is no longer painted', async () => {
    const theme = await load()
    theme.startTheme('light')
    const win = fakeWindow()
    theme.followTheme(win as unknown as BrowserWindow)
    win.close()
    theme.changeTheme('dark')
    expect(win.background).toBe('#F6F6F6')
  })
})

describe('the person changes the theme', () => {
  it('ends the seed: from then on the stored choice is what counts', async () => {
    const theme = await load('dark')
    theme.startTheme('light')
    expect(theme.effectiveChoice('light')).toBe('dark')
    theme.changeTheme('light')
    expect(theme.effectiveChoice('light')).toBe('light')
    expect(nativeTheme.themeSource).toBe('light')
  })
})
