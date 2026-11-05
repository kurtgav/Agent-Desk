import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentDeckBridge, AppStatus } from '@shared/bridge'
import type { Snapshot } from '@shared/snapshot'
import { demoSnapshot } from './demo/snapshot'
import { connect, useUi } from './store'

const NOW = Date.UTC(2026, 10, 5, 14, 0)
const session = (id: string) => useUi.getState().snapshot.sessions.find((s) => s.id === id)!
const hasItem = (id: string) => useUi.getState().snapshot.attention.some((a) => a.id === id)

beforeEach(() => {
  useUi.setState({ snapshot: demoSnapshot(NOW), announcement: '' })
})

describe('resolve (demo answers stay local)', () => {
  it('approving the last open ask resumes the session and names the item', () => {
    useUi.getState().resolve('a-billing-push', 'approved')
    expect(hasItem('a-billing-push')).toBe(false)
    expect(session('s-billing')).toMatchObject({ status: 'working', waitingSince: null, activity: 'Continuing after your answer' })
    expect(useUi.getState().announcement).toBe(
      'Approved in demo: Run git push --force-with-lease origin feat/stripe-webhooks. Nothing was sent.'
    )
  })

  it('rejecting also resumes the session: Claude gets the denial and carries on', () => {
    useUi.getState().resolve('a-billing-push', 'rejected')
    expect(session('s-billing').status).toBe('working')
    expect(useUi.getState().announcement).toMatch(/^Rejected in demo: /)
  })

  it('a session with another open P1 keeps waiting', () => {
    const s = useUi.getState().snapshot
    const second = { ...s.attention.find((a) => a.id === 'a-billing-push')!, id: 'a-billing-second', title: 'Edit `.env`' }
    useUi.setState({ snapshot: { ...s, attention: [...s.attention, second] } })
    useUi.getState().resolve('a-billing-push', 'approved')
    expect(session('s-billing').status).toBe('needs_you')
    expect(hasItem('a-billing-second')).toBe(true)
  })

  it('dismissing never changes the session status', () => {
    const before = session('s-invoice').status
    useUi.getState().resolve('a-invoice-limit', 'dismissed')
    expect(hasItem('a-invoice-limit')).toBe(false)
    expect(session('s-invoice').status).toBe(before)
  })

  it('an unknown id is a no-op', () => {
    const before = useUi.getState().snapshot
    useUi.getState().resolve('nope', 'approved')
    expect(useUi.getState().snapshot).toBe(before)
    expect(useUi.getState().announcement).toBe('')
  })
})

describe('connect (D-059: no collector, no "All quiet")', () => {
  afterEach(() => vi.unstubAllGlobals())

  const STATUS: AppStatus = { hooks: 'missing', hooksError: null, conflicts: [], pausedUntil: null }

  function fakeBridge(demo: boolean) {
    let push: (s: Snapshot | null) => void = () => undefined
    const bridge: AgentDeckBridge = {
      getAppInfo: async () => ({ version: '0.1.0', demo }),
      getSnapshot: async () => null,
      onSnapshot: (l) => {
        push = l
        return () => undefined
      },
      setDemo: async () => undefined,
      getStatus: async () => STATUS,
      onStatus: () => () => undefined,
      onFocusItem: () => () => undefined,
      dismiss: vi.fn(async () => undefined),
      pauseNotifications: async () => undefined,
      previewInstall: async () => ({ ok: false, path: '', error: 'x' }),
      previewUninstall: async () => ({ ok: false, path: '', error: 'x' }),
      installHooks: async () => ({ ok: true }),
      uninstallHooks: async () => ({ ok: true })
    }
    vi.stubGlobal('window', { agentdeck: bridge })
    return Object.assign((s: Snapshot | null) => push(s), { bridge })
  }

  it('live Dismiss goes to main and leaves the item for the next snapshot to drop; P1 never dismisses', async () => {
    const push = fakeBridge(false)
    connect()
    await vi.waitFor(() => expect(useUi.getState().status).toEqual(STATUS))
    const live = { ...demoSnapshot(NOW), mode: 'live' as const }
    push(live)
    const p4 = live.attention.find((i) => i.priority > 1)!
    const p1 = live.attention.find((i) => i.priority === 1)!
    useUi.getState().resolve(p4.id, 'dismissed')
    useUi.getState().resolve(p1.id, 'dismissed')
    expect(push.bridge.dismiss).toHaveBeenCalledTimes(1)
    expect(push.bridge.dismiss).toHaveBeenCalledWith(p4.id)
    expect(useUi.getState().snapshot.attention).toHaveLength(live.attention.length)
  })

  it('is connecting until the first snapshot, down while the collector restarts, up again after', async () => {
    useUi.setState({ link: 'connecting' })
    const push = fakeBridge(false)
    connect()
    await vi.waitFor(() => expect(useUi.getState().version).toBe('0.1.0'))
    expect(useUi.getState().link).toBe('connecting')
    const live = { ...demoSnapshot(NOW), mode: 'live' as const }
    push(live)
    expect(useUi.getState()).toMatchObject({ link: 'up', snapshot: live })
    push(null)
    expect(useUi.getState().link).toBe('down')
    expect(useUi.getState().snapshot.sessions).toEqual([]) // nothing stale stays on screen
    push(live)
    expect(useUi.getState().link).toBe('up')
  })

  it('demo data is always up', async () => {
    useUi.setState({ link: 'connecting' })
    fakeBridge(true)
    connect()
    await vi.waitFor(() => expect(useUi.getState().link).toBe('up'))
    expect(useUi.getState().snapshot.mode).toBe('demo')
  })
})

describe('effort', () => {
  it('cycles through the CLI values and wraps', () => {
    useUi.setState({ effort: 'max' })
    useUi.getState().cycleEffort()
    expect(useUi.getState().effort).toBe('low')
  })
})
