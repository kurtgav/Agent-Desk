import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentDeckBridge, AppStatus } from '@shared/bridge'
import { DEFAULT_PROFILE_NAME, type Profile } from '@shared/work'
import { DEMO_PROFILE, connect, useUi } from './store'

const STATUS: AppStatus = { hooks: 'missing', hooksError: null, conflicts: [], pausedUntil: null, remoteApprovals: { enabled: false, waitSec: 60 } }

/** Only what `connect` calls; the cast is the test double's price for a 40-method bridge. */
function bridgeWith(getProfile: () => Promise<Profile>, demo = false): void {
  const bridge = {
    getAppInfo: async () => ({ version: '0.1.0', demo }),
    getSnapshot: async () => null,
    onSnapshot: () => () => undefined,
    getStatus: async () => STATUS,
    onStatus: () => () => undefined,
    onFocusItem: () => () => undefined,
    getProfile
  } as unknown as AgentDeckBridge
  vi.stubGlobal('window', { agentdeck: bridge })
}

beforeEach(() => useUi.setState({ profile: { name: DEFAULT_PROFILE_NAME, avatar: null }, status: null, version: 'dev' }))
afterEach(() => vi.unstubAllGlobals())

describe('profile in the store', () => {
  it('connect loads the name and photo main stores', async () => {
    bridgeWith(async () => ({ name: 'Sam', avatar: 'data:image/png;base64,AAAA' }))
    connect()
    await vi.waitFor(() => expect(useUi.getState().profile).toEqual({ name: 'Sam', avatar: 'data:image/png;base64,AAAA' }))
  })

  it('a profile that can not be read keeps the stand-in and does not hold up the rest of start-up', async () => {
    bridgeWith(async () => {
      throw new Error('no profile')
    })
    connect()
    await vi.waitFor(() => expect(useUi.getState().status).toEqual(STATUS))
    expect(useUi.getState().profile).toEqual({ name: DEFAULT_PROFILE_NAME, avatar: null })
  })

  it('demo data greets the sample user, as main does', async () => {
    bridgeWith(async () => DEMO_PROFILE, true)
    connect()
    await vi.waitFor(() => expect(useUi.getState().profile.name).toBe('Kurt'))
  })

  it('without the bridge (a plain browser) the sample data brings its sample user', () => {
    vi.stubGlobal('window', {})
    connect()
    expect(useUi.getState().profile).toEqual(DEMO_PROFILE)
  })

  it('setProfile replaces both fields at once', () => {
    useUi.getState().setProfile({ name: 'Al', avatar: null })
    expect(useUi.getState().profile).toEqual({ name: 'Al', avatar: null })
  })
})
