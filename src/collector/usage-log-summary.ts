// The Usage card's numbers from the token counts read out of Claude Code's logs. No electron import: unit-testable.
import type { Usage } from '@shared/snapshot'
import type { LogRec } from './usage-log-store'

/** Claude's rolling usage window as people know it: 5 hours. */
export const BLOCK_MS = 5 * 3_600_000
const HOUR_MS = 3_600_000
const TOP_MODELS = 3

const tokensOf = (r: LogRec): number => r.input + r.output + r.cacheRead + r.cacheWrite

export interface Block {
  startedAt: number
  endsAt: number
  /** The time of its last message. */
  lastAt: number
}

/**
 * The block that is open at `now`, found the way ccusage finds it: a block starts at the hour of the first message after a gap
 * of 5 hours, and the next message more than 5 hours after that start (or after the previous message) starts a new one.
 * It is open while `now` is before its end and the last message is less than 5 hours old. This is a guess at Claude's
 * rolling window, not a reading of it: the plan's real limit is not readable from this PC. `times` need not be sorted.
 */
export function activeBlock(times: Float64Array | readonly number[], now: number): Block | null {
  const sorted = Float64Array.from(times).sort()
  let start = Number.NEGATIVE_INFINITY
  let last = Number.NEGATIVE_INFINITY
  for (const t of sorted) {
    if (t >= start + BLOCK_MS || t - last >= BLOCK_MS) start = Math.floor(t / HOUR_MS) * HOUR_MS // UTC hours, as ccusage floors them
    last = t
  }
  if (last === Number.NEGATIVE_INFINITY || now >= start + BLOCK_MS || now - last >= BLOCK_MS) return null
  return { startedAt: start, endsAt: start + BLOCK_MS, lastAt: last }
}

export interface LogSummaryInput {
  records: readonly LogRec[]
  now: number
  /** Local midnight today, and Monday 00:00 local (D-008). */
  todayFrom: number
  weekFrom: number
  weeklyBudgetUsd: number
  /** The first pass is still running: `done` of `total` files. Null when it is over. */
  scan: { done: number; total: number } | null
  files: number
  lastAt: number | null
}

/**
 * Tokens are all four kinds, as `claude_code.token.usage` counts them. Cost is the API-equivalent estimate of the requests whose
 * model has a known price; `costPartial` says some had none, so the sum is a floor, not a total.
 */
export function summarizeLog(i: LogSummaryInput): Usage {
  const u = { todayTokens: 0, weekTokens: 0, todayCostUsd: 0, weekCostUsd: 0 }
  const byModel = new Map<string, number>()
  const times: number[] = []
  let costPartial = false
  for (const r of i.records) {
    times.push(r.ts)
    if (r.ts < i.weekFrom || r.ts > i.now) continue
    const n = tokensOf(r)
    u.weekTokens += n
    byModel.set(r.model, (byModel.get(r.model) ?? 0) + n)
    if (r.cost === null) costPartial = true
    else u.weekCostUsd += r.cost
    if (r.ts >= i.todayFrom) {
      u.todayTokens += n
      u.todayCostUsd += r.cost ?? 0
    }
  }
  const open = activeBlock(times, i.now)
  let block: Usage['block'] = null
  if (open) {
    let tokens = 0
    for (const r of i.records) if (r.ts >= open.startedAt && r.ts < open.endsAt) tokens += tokensOf(r)
    block = { startedAt: open.startedAt, endsAt: open.endsAt, tokens }
  }
  return {
    ...u,
    weeklyBudgetUsd: i.weeklyBudgetUsd,
    source: 'logs',
    costPartial,
    block,
    topModels: [...byModel.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_MODELS)
      .map(([model, tokens]) => ({ model, tokens })),
    logs: { files: i.files, lastAt: i.lastAt, scan: i.scan }
  }
}
