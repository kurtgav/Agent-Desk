import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ALLOW, DENY, Holds, type AuditRow, type HoldInfo } from './holds'

const info = (itemId: string): HoldInfo => ({
  itemId, sessionId: 's1', agentId: null, toolName: 'Bash', title: 'Run `mkdir x`', riskFlags: [], inputHash: 'h', requestedAt: 0
})

describe('Holds (ADR-0006)', () => {
  let rows: AuditRow[]
  let holds: Holds
  beforeEach(() => {
    vi.useFakeTimers()
    rows = []
    holds = new Holds((r) => rows.push(r))
  })
  afterEach(() => vi.useRealTimers())

  it('Approve replies allow, Reject replies deny with "Rejected in AgentDeck"; each request takes one answer', async () => {
    const a = holds.add(info('a'), 60_000, new AbortController().signal)
    const b = holds.add(info('b'), 60_000, new AbortController().signal)
    expect(holds.decide('a', 'approve')).toBe(true)
    expect(holds.decide('a', 'reject')).toBe(false) // approve-once: the second click finds nothing
    expect(holds.decide('b', 'reject')).toBe(true)
    await expect(a).resolves.toEqual(ALLOW)
    await expect(b).resolves.toEqual(DENY)
    expect(DENY.hookSpecificOutput.decision).toEqual({ behavior: 'deny', message: 'Rejected in AgentDeck' })
    expect(rows.map((r) => [r.itemId, r.outcome])).toEqual([['a', 'approved'], ['b', 'rejected']])
  })

  it('no answer in time: an empty reply, so the terminal asks', async () => {
    const p = holds.add(info('a'), 60_000, new AbortController().signal)
    vi.advanceTimersByTime(59_999)
    expect(holds.has('a')).toBe(true)
    vi.advanceTimersByTime(1)
    await expect(p).resolves.toBeUndefined()
    expect(holds.decide('a', 'approve')).toBe(false)
    expect(rows.map((r) => r.outcome)).toEqual(['timed-out'])
  })

  it('a closed connection ends the hold at once, and an already closed one never waits', async () => {
    const ac = new AbortController()
    const p = holds.add(info('a'), 60_000, ac.signal)
    ac.abort()
    await expect(p).resolves.toBeUndefined()
    await expect(holds.add(info('b'), 60_000, ac.signal)).resolves.toBeUndefined()
    expect(holds.has('b')).toBe(false)
    expect(rows.map((r) => [r.itemId, r.outcome])).toEqual([['a', 'abandoned'], ['b', 'abandoned']])
  })

  it('a repeated delivery replaces the older hold of the same item', async () => {
    const first = holds.add(info('a'), 60_000, new AbortController().signal)
    const second = holds.add(info('a'), 60_000, new AbortController().signal)
    await expect(first).resolves.toBeUndefined()
    holds.decide('a', 'approve')
    await expect(second).resolves.toEqual(ALLOW)
    expect(rows.map((r) => r.outcome)).toEqual(['released', 'approved'])
  })

  it('lets go of items closed elsewhere, and of everything on shutdown', async () => {
    const a = holds.add(info('a'), 60_000, new AbortController().signal)
    const b = holds.add(info('b'), 60_000, new AbortController().signal)
    holds.releaseClosed((id) => id === 'b')
    await expect(a).resolves.toBeUndefined()
    expect(holds.has('b')).toBe(true)
    holds.releaseAll()
    await expect(b).resolves.toBeUndefined()
    expect(rows.map((r) => [r.itemId, r.outcome])).toEqual([['a', 'released'], ['b', 'released']])
    vi.advanceTimersByTime(120_000) // their timers were cleared: no second row
    expect(rows).toHaveLength(2)
  })
})
