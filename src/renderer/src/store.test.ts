import { beforeEach, describe, expect, it } from 'vitest'
import { demoSnapshot } from './demo/snapshot'
import { useUi } from './store'

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

describe('effort', () => {
  it('cycles through the CLI values and wraps', () => {
    useUi.setState({ effort: 'max' })
    useUi.getState().cycleEffort()
    expect(useUi.getState().effort).toBe('low')
  })
})
