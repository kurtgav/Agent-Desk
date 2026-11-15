import { describe, expect, it } from 'vitest'
import { PRICE_TABLE_DATE, costOf, modelKey, priceFor, type Tokens } from './usage-price'

const t = (over: Partial<Tokens> = {}): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, ...over })
const M = 1_000_000

describe('modelKey', () => {
  it('reads the family and version, with or without a date', () => {
    expect(modelKey('claude-opus-5-5')).toBe('opus-5-5')
    expect(modelKey('claude-sonnet-5')).toBe('sonnet-5')
    expect(modelKey('claude-haiku-5-5-20260101')).toBe('haiku-5-5')
    expect(modelKey('claude-fable-5-2')).toBe('fable-5-2')
  })

  it('never reads a date as a minor version', () => {
    expect(modelKey('claude-opus-4-20250514')).toBe('opus-4')
    expect(modelKey('claude-opus-4-1-20250805')).toBe('opus-4-1')
  })

  it('has no key for names it does not know', () => {
    for (const n of ['claude-3-5-sonnet-20241022', 'gpt-4', '<synthetic>', '', 'claude-opus', 'claude-opus-5-5-fast', 'claude-newfamily-5']) expect(modelKey(n)).toBeNull()
  })
})

describe('costOf (prices from platform.claude.com/docs/en/about-claude/pricing)', () => {
  it('has every model of the pricing page at its listed input and output price', () => {
    const listed: [string, number, number][] = [
      ['claude-fable-5-2', 8, 40],
      ['claude-mythos-5-2', 8, 40],
      ['claude-fable-5-1', 10, 50],
      ['claude-mythos-5-1', 10, 50],
      ['claude-fable-5', 10, 50],
      ['claude-mythos-5', 10, 50],
      ['claude-opus-5-5', 4, 20],
      ['claude-opus-5', 5, 25],
      ['claude-opus-4-8', 5, 25],
      ['claude-opus-4-7', 5, 25],
      ['claude-opus-4-6', 5, 25],
      ['claude-opus-4-5', 5, 25],
      ['claude-opus-4-1', 15, 75],
      ['claude-opus-4', 15, 75],
      ['claude-sonnet-5-5', 2, 10],
      ['claude-sonnet-5', 2, 10],
      ['claude-sonnet-4-6', 3, 15],
      ['claude-sonnet-4-5', 3, 15],
      ['claude-sonnet-4', 3, 15],
      ['claude-haiku-4-5', 1, 5]
    ]
    for (const [model, input, output] of listed) {
      expect(costOf(model, t({ input: M })), `${model} input`).toBeCloseTo(input, 9)
      expect(costOf(model, t({ output: M })), `${model} output`).toBeCloseTo(output, 9)
    }
  })

  it('prices the cache by kind: reads, 5-minute writes and 1-hour writes', () => {
    expect(costOf('claude-opus-5-5', t({ cacheRead: M }))).toBeCloseTo(0.2, 9)
    expect(costOf('claude-opus-5-5', t({ cacheWrite: M }))).toBeCloseTo(5, 9)
    expect(costOf('claude-opus-5-5', t({ cacheWrite: M, cacheWrite1h: M }))).toBeCloseTo(8, 9)
    expect(costOf('claude-opus-5-5', t({ cacheWrite: M, cacheWrite1h: M / 2 }))).toBeCloseTo(6.5, 9)
    expect(costOf('claude-sonnet-5', t({ cacheRead: M }))).toBeCloseTo(0.2, 9) // Sonnet 5.5 reads at 0.1: the two differ
    expect(costOf('claude-sonnet-5-5', t({ cacheRead: M }))).toBeCloseTo(0.1, 9)
    expect(costOf('claude-fable-5-2', t({ cacheRead: M }))).toBeCloseTo(0.2, 9)
    expect(costOf('claude-fable-5', t({ cacheRead: M }))).toBeCloseTo(1, 9)
  })

  it('matches what Claude Code itself reported for a real haiku-5-5 request (OTel cost.usage $0.00139164)', () => {
    const cost = costOf('claude-haiku-5-5', t({ input: 2, output: 181, cacheRead: 34_834, cacheWrite: 4_763, cacheWrite1h: 4_763 }))
    expect(cost).toBeCloseTo(0.00139164, 8)
  })

  it('prices Haiku 5.5 by the size of the prompt: up to 100,000 tokens, or over', () => {
    expect(costOf('claude-haiku-5-5', t({ input: 100_000 }))).toBeCloseTo(0.01, 9)
    expect(costOf('claude-haiku-5-5', t({ output: 100_000 }))).toBeCloseTo(0.05, 9)
    expect(costOf('claude-haiku-5-5', t({ input: 100_001 }))).toBeCloseTo(0.0500005, 9)
    expect(priceFor('claude-haiku-5-5', t({ input: 60_000, cacheRead: 40_000 }))?.input).toBe(0.1)
    expect(priceFor('claude-haiku-5-5', t({ input: 60_000, cacheRead: 40_001 }))?.input).toBe(0.5)
    expect(priceFor('claude-haiku-5-5', t({ input: 1, cacheWrite: 100_000 }))?.input).toBe(0.5)
  })

  it('gives no cost, rather than a guess, for an unknown model or a non-standard rate', () => {
    expect(costOf('claude-unreleased-9', t({ input: M }))).toBeNull()
    expect(costOf('claude-3-5-sonnet-20241022', t({ input: M }))).toBeNull()
    expect(costOf('claude-opus-5-5', t({ input: M }), true)).toBeNull()
  })

  it('is dated', () => {
    expect(PRICE_TABLE_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
