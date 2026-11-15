import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fixtureRoles } from './fixture'
import { createSuggester, longEnough } from './suggest'
import { suggestRoles } from '@shared/role-search'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0)
}

function setup(run: (text: string) => Promise<string[]> = async (t) => [t]) {
  const results: (string[] | null)[] = []
  const runner = vi.fn(run)
  const s = createSuggester<string[]>({ delayMs: 250, eligible: longEnough, run: runner, onResult: (v) => results.push(v) })
  return { s, results, runner }
}

describe('suggesting while typing', () => {
  it('waits for the typing to pause, then ranks once', async () => {
    const { s, results, runner } = setup()
    s.push('our postgres')
    s.push('our postgres queries')
    s.push('our postgres queries are slow')
    await vi.advanceTimersByTimeAsync(249)
    expect(runner).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await flush()
    expect(runner).toHaveBeenCalledTimes(1)
    expect(runner).toHaveBeenCalledWith('our postgres queries are slow')
    expect(results).toEqual([['our postgres queries are slow']])
  })

  it('drops an answer that arrives after newer text', async () => {
    let release: (v: string[]) => void = () => undefined
    const { s, results } = setup(() => new Promise<string[]>((r) => (release = r)))
    s.push('first words here')
    await vi.advanceTimersByTimeAsync(250)
    s.push('first words here and more')
    release(['stale'])
    await flush()
    expect(results).toEqual([])
  })

  it('drops a pending run when it is cancelled, and an answer in flight too', async () => {
    const { s, results, runner } = setup()
    s.push('one two three')
    s.cancel()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(runner).not.toHaveBeenCalled()
    let release: (v: string[]) => void = () => undefined
    const slow = setup(() => new Promise<string[]>((r) => (release = r)))
    slow.s.push('one two three four')
    await vi.advanceTimersByTimeAsync(250)
    slow.s.cancel()
    release(['late'])
    await flush()
    expect(slow.results).toEqual([])
    expect(results).toEqual([])
  })

  it('clears the suggestions after the pause once the text is too short, and not before', async () => {
    const { s, results, runner } = setup()
    s.push('hi')
    expect(results).toEqual([])
    await vi.advanceTimersByTimeAsync(250)
    expect(results).toEqual([null])
    expect(runner).not.toHaveBeenCalled()
  })

  it('shows nothing rather than an error when ranking fails', async () => {
    const { s, results } = setup(async () => {
      throw new Error('no')
    })
    s.push('one two three')
    await vi.advanceTimersByTimeAsync(250)
    await flush()
    expect(results).toEqual([null])
  })
})

describe('when a message is long enough to suggest from', () => {
  it('needs three words or a sentence, and never a command', () => {
    expect(longEnough('fix it')).toBe(false)
    expect(longEnough('fix the bug')).toBe(true)
    expect(longEnough('refactoring-the-payment-service')).toBe(true)
    expect(longEnough('/review some pull request')).toBe(false)
  })
})

describe('the ranking behind it', () => {
  const roles = fixtureRoles()
  it('suggests the database roles for slow postgres queries, with the words that matched', () => {
    const hits = suggestRoles(roles, 'our postgres queries are slow', 3)
    expect(hits[0]!.id).toBe('database-optimizer')
    expect(hits[0]!.matched.join(' ')).toMatch(/postgres|queries/)
  })
})
