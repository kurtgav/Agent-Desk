import { describe, expect, it } from 'vitest'
import { withCost, type LogRec } from './usage-log-store'
import { BLOCK_MS, activeBlock, summarizeLog, type LogSummaryInput } from './usage-log-summary'

const H = 3_600_000
const at = (h: number, m = 0): number => Date.UTC(2026, 10, 13, h, m)

describe("activeBlock (ccusage's rule)", () => {
  it('starts at the hour of the first message and lasts 5 hours', () => {
    expect(activeBlock([at(9, 12)], at(10))).toEqual({ startedAt: at(9), endsAt: at(14), lastAt: at(9, 12) })
  })

  it('is closed once its 5 hours are over, and when nothing has been said', () => {
    expect(activeBlock([at(9, 12)], at(13, 59))).not.toBeNull()
    expect(activeBlock([at(9, 12)], at(14))).toBeNull()
    expect(activeBlock([], at(10))).toBeNull()
  })

  it('keeps messages inside the 5 hours in one block', () => {
    expect(activeBlock([at(9, 12), at(11), at(13, 59)], at(13, 59))).toMatchObject({ startedAt: at(9), endsAt: at(14) })
  })

  it('starts a new block with the first message after the old one ended, even after a short gap', () => {
    expect(activeBlock([at(9, 12), at(13, 30), at(14, 10)], at(14, 30))).toMatchObject({ startedAt: at(14), endsAt: at(19) })
    // exactly 5 hours after the start belongs to the next block
    expect(activeBlock([at(9), at(14)], at(14, 5))).toMatchObject({ startedAt: at(14) })
  })

  it('starts a new block after a gap of 5 hours or more', () => {
    expect(activeBlock([at(1), at(2), at(7, 30)], at(8))).toMatchObject({ startedAt: at(7), endsAt: at(12) })
    expect(activeBlock([at(9), at(11)], at(11, 30))).toMatchObject({ startedAt: at(9) })
  })

  it('is not thrown by input that is not in time order', () => {
    expect(activeBlock([at(13, 30), at(9, 12), at(11)], at(14))).toEqual(activeBlock([at(9, 12), at(11), at(13, 30)], at(14)))
  })

  it('floors to the UTC hour and uses the 5-hour constant', () => {
    expect(BLOCK_MS).toBe(5 * H)
    expect(activeBlock([at(9, 59)], at(10))?.startedAt).toBe(at(9))
  })
})

const rec = (ts: number, model = 'claude-sonnet-5-5', tokens = 100): LogRec =>
  withCost({ key: `${model}:${ts}`, ts, model, input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, odd: false })
const summary = (records: LogRec[], over: Partial<LogSummaryInput> = {}) =>
  summarizeLog({ records, now: at(12), todayFrom: at(0), weekFrom: at(0) - 4 * 24 * H, weeklyBudgetUsd: 40, scan: null, files: 3, lastAt: at(11, 59), ...over })

describe('summarizeLog', () => {
  it('says zero when there is nothing: zero is a figure', () => {
    expect(summary([])).toMatchObject({
      todayTokens: 0,
      weekTokens: 0,
      todayCostUsd: 0,
      weekCostUsd: 0,
      weeklyBudgetUsd: 40,
      source: 'logs',
      costPartial: false,
      block: null,
      topModels: [],
      logs: { files: 3, lastAt: at(11, 59), scan: null }
    })
  })

  it('splits today from the week and leaves what is before the week out', () => {
    const u = summary([rec(at(0) - 5 * 24 * H, 'claude-sonnet-5-5', 9_999), rec(at(0) - 2 * 24 * H, 'claude-sonnet-5-5', 200), rec(at(10), 'claude-sonnet-5-5', 300)])
    expect(u).toMatchObject({ todayTokens: 300, weekTokens: 500 })
    expect(u.weekCostUsd).toBeGreaterThan(u.todayCostUsd)
  })

  it("sums the open block's tokens and reports when it began and about when it ends", () => {
    const u = summary([rec(at(2), 'claude-sonnet-5-5', 1_000), rec(at(8, 20), 'claude-sonnet-5-5', 40), rec(at(11), 'claude-sonnet-5-5', 60)])
    expect(u.block).toEqual({ startedAt: at(8), endsAt: at(13), tokens: 100 })
  })

  it('has no block when the last message is old, and keeps counting the day and week', () => {
    const u = summary([rec(at(3), 'claude-sonnet-5-5', 70)], { now: at(12) })
    expect(u.block).toBeNull()
    expect(u.todayTokens).toBe(70)
  })

  it('names the three busiest models of the week', () => {
    const u = summary([rec(at(9), 'claude-opus-5-5', 500), rec(at(9), 'claude-sonnet-5-5', 300), rec(at(9), 'claude-haiku-5-5', 200), rec(at(9), 'claude-fable-5-2', 100)])
    expect(u.topModels).toEqual([
      { model: 'claude-opus-5-5', tokens: 500 },
      { model: 'claude-sonnet-5-5', tokens: 300 },
      { model: 'claude-haiku-5-5', tokens: 200 }
    ])
  })

  it('says the cost is partial when a model has no price, and counts its tokens anyway', () => {
    const u = summary([rec(at(9), 'claude-sonnet-5-5', 1_000_000), rec(at(9), 'claude-unreleased-9', 1_000_000)])
    expect(u.costPartial).toBe(true)
    expect(u.weekTokens).toBe(2_000_000)
    expect(u.weekCostUsd).toBeCloseTo(2, 9) // only the priced one
  })

  it("passes the first scan's progress through", () => {
    expect(summary([], { scan: { done: 120, total: 280 } }).logs?.scan).toEqual({ done: 120, total: 280 })
  })
})
