import { describe, expect, it } from 'vitest'
import { elapsed, formatCost, formatDuration, formatTokens, turnSummary } from './format'

describe('console number formats', () => {
  it.each([
    [null, ''], [0, ''], [0.001, '< $0.01'], [0.0049, '< $0.01'], [0.005, '$0.01'], [0.5194, '$0.52'], [1.2, '$1.20'], [23.8, '$23.80']
  ])('cost %s', (usd, text) => {
    expect(formatCost(usd)).toBe(text)
  })

  it.each([
    [null, ''], [0, '0.0 s'], [650, '0.7 s'], [6_653, '6.7 s'], [14_500, '15 s'], [59_999, '60 s'], [60_000, '1 min 0 s'], [72_000, '1 min 12 s'], [125_400, '2 min 5 s']
  ])('duration %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text)
  })

  it.each([
    [null, ''], [0, '0'], [842, '842'], [1_000, '1k'], [1_460, '1.5k'], [48_200, '48.2k'], [129_846, '130k']
  ])('tokens %s', (n, text) => {
    expect(formatTokens(n)).toBe(text)
  })

  it('counts a running turn in whole seconds, and says nothing before it starts', () => {
    expect(elapsed(null, 5_000)).toBe('')
    expect(elapsed(1_000, 13_900)).toBe('12 s')
    expect(elapsed(10_000, 5_000)).toBe('0.0 s')
  })

  it('puts a turn on one quiet line, leaving out what is unknown', () => {
    expect(turnSummary({ durationMs: 6_653, inputTokens: 129_846, outputTokens: 4, costUsd: 0.51942 })).toBe('6.7 s · 130k in · 4 out · $0.52')
    expect(turnSummary({ durationMs: 800, inputTokens: null, outputTokens: null, costUsd: null })).toBe('0.8 s')
    expect(turnSummary({ durationMs: null, inputTokens: null, outputTokens: null, costUsd: null })).toBe('')
  })
})
