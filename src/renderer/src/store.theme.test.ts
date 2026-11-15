import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentDeckBridge } from '@shared/bridge'
import type { AppSettings, ThemeChoice } from '@shared/work'
import { connect, useUi } from './store'

/** Only what these tests reach; the cast is the test double's price for a 40-method bridge. */
function bridgeWith(parts: { getSettings?: () => Promise<Pick<AppSettings, 'theme'>>; updateSettings?: (patch: { theme: ThemeChoice }) => Promise<unknown> }): void {
  const bridge = {
    getAppInfo: async () => ({ version: '0.1.0', demo: true }),
    getSnapshot: async () => null,
    onSnapshot: () => () => undefined,
    getStatus: async () => null,
    onStatus: () => () => undefined,
    onFocusItem: () => () => undefined,
    getProfile: async () => ({ name: 'Sam', avatar: null }),
    ...parts
  } as unknown as AgentDeckBridge
  vi.stubGlobal('window', { agentdeck: bridge })
}

beforeEach(() => useUi.setState({ theme: 'system', resolvedTheme: 'light' }))
afterEach(() => vi.unstubAllGlobals())

describe('theme in the store', () => {
  it('setTheme applies the choice at once and hands it to main', async () => {
    const updateSettings = vi.fn(async () => ({}))
    bridgeWith({ updateSettings })
    await expect(useUi.getState().setTheme('dark')).resolves.toBeNull()
    expect(useUi.getState()).toMatchObject({ theme: 'dark', resolvedTheme: 'dark' })
    expect(updateSettings).toHaveBeenCalledWith({ theme: 'dark' })
  })

  it('a save main refuses still leaves the theme applied, and says so in a sentence', async () => {
    bridgeWith({
      updateSettings: async () => {
        throw new Error('disk full')
      }
    })
    await expect(useUi.getState().setTheme('light')).resolves.toMatch(/could not save/)
    expect(useUi.getState().theme).toBe('light')
  })

  it('without the bridge (plain browser) the choice is applied and nothing is sent', async () => {
    vi.stubGlobal('window', {})
    await expect(useUi.getState().setTheme('dark')).resolves.toBeNull()
    expect(useUi.getState().resolvedTheme).toBe('dark')
  })

  it('connect takes the choice main stored, system included', async () => {
    useUi.setState({ theme: 'light', resolvedTheme: 'light' })
    bridgeWith({ getSettings: async () => ({ theme: 'dark' }) })
    const stop = connect()
    await vi.waitFor(() => expect(useUi.getState()).toMatchObject({ theme: 'dark', resolvedTheme: 'dark' }))
    stop()
  })

  it('an answer from main that arrives after the person chose does not undo the choice', async () => {
    let answer: (s: Pick<AppSettings, 'theme'>) => void = () => undefined
    bridgeWith({ getSettings: () => new Promise((resolve) => (answer = resolve)), updateSettings: async () => ({}) })
    const stop = connect()
    await useUi.getState().setTheme('light')
    answer({ theme: 'dark' })
    await new Promise((r) => setTimeout(r, 0))
    expect(useUi.getState().theme).toBe('light')
    stop()
  })

  it('a bridge that cannot answer leaves the mirrored choice alone', async () => {
    useUi.setState({ theme: 'dark', resolvedTheme: 'dark' })
    bridgeWith({
      getSettings: async () => {
        throw new Error('not yet')
      }
    })
    const stop = connect()
    await new Promise((r) => setTimeout(r, 0))
    expect(useUi.getState().theme).toBe('dark')
    stop()
  })
})
