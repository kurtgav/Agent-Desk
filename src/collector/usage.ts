// ADR-0007: Claude Code's OTLP/HTTP JSON metrics → per-model usage points. No electron import: unit-testable.
// Identity attributes (user.email, user.account_uuid, user.account_id, organization.id, user.id, R12) are never read:
// only `model` and `type` leave a data point, so there is nothing to drop and nothing downstream can come to depend on them.
import { z } from 'zod'
import type { Usage } from '@shared/snapshot'

/** `type` of claude_code.token.usage (monitoring-usage § Metrics), plus `cost` for claude_code.cost.usage. */
export const TOKEN_TYPES = ['input', 'output', 'cacheRead', 'cacheCreation'] as const
export type UsageType = (typeof TOKEN_TYPES)[number] | 'cost'

export const TOKEN_METRIC = 'claude_code.token.usage'
export const COST_METRIC = 'claude_code.cost.usage'
/** OTLP AggregationTemporality: DELTA = 1. A cumulative series would be counted twice if it were summed. */
const DELTA = 1
const MODEL_MAX = 64

export interface UsagePoint {
  model: string
  type: UsageType
  value: number
}

const Attribute = z.object({ key: z.string(), value: z.object({ stringValue: z.string().optional() }) })
// asInt arrives as a string in OTLP/JSON (int64), asDouble as a number; Claude Code sends token counts as asDouble (spike).
const Amount = z.union([z.number(), z.string()])
const DataPoint = z.object({ attributes: z.array(Attribute).default([]), asInt: Amount.optional(), asDouble: Amount.optional() })
const Metric = z.object({ name: z.string(), sum: z.object({ aggregationTemporality: z.number().optional(), dataPoints: z.array(DataPoint).default([]) }).optional() })
const Body = z.object({ resourceMetrics: z.array(z.object({ scopeMetrics: z.array(z.object({ metrics: z.array(Metric).default([]) })).default([]) })).default([]) })

const isType = (t: string | undefined): t is (typeof TOKEN_TYPES)[number] => (TOKEN_TYPES as readonly string[]).includes(t ?? '')

/** One line, no control or direction characters, short: the model name is shown nowhere yet, but it is stored. */
const cleanModel = (m: string | undefined): string => (m ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim().slice(0, MODEL_MAX) || 'unknown'

/**
 * The token and cost deltas in one OTLP body, merged per model and type. Anything else (session.count, active_time,
 * a cumulative series, a value that is not a plain non-negative number) is skipped. Throws on a body that is not JSON.
 */
export function parseUsage(raw: string): UsagePoint[] {
  const body = Body.safeParse(JSON.parse(raw))
  if (!body.success) return []
  const sums = new Map<string, UsagePoint>()
  for (const rm of body.data.resourceMetrics) {
    for (const sm of rm.scopeMetrics) {
      for (const m of sm.metrics) {
        if ((m.name !== TOKEN_METRIC && m.name !== COST_METRIC) || m.sum?.aggregationTemporality !== DELTA) continue
        for (const dp of m.sum.dataPoints) {
          const attr = (key: string): string | undefined => dp.attributes.find((a) => a.key === key)?.value.stringValue
          const type: UsageType | undefined = m.name === COST_METRIC ? 'cost' : isType(attr('type')) ? (attr('type') as UsageType) : undefined
          const value = Number(dp.asDouble ?? dp.asInt)
          if (!type || !Number.isFinite(value) || value < 0) continue
          const model = cleanModel(attr('model'))
          const key = `${model}\n${type}`
          const prev = sums.get(key)
          sums.set(key, { model, type, value: (prev?.value ?? 0) + value })
        }
      }
    }
  }
  return [...sums.values()]
}

export interface UsageRow {
  day: string
  type: UsageType
  value: number
}

/**
 * The Usage card's numbers (ADR-0007). Tokens are all four kinds, cached reads included, as `claude_code.token.usage`
 * counts them; the cost is the API-equivalent estimate Claude Code reports, not what a subscription is billed.
 * `today` and `weekFrom` are local day keys (`YYYY-MM-DD`, which sort as text).
 */
export function summarizeUsage(rows: Iterable<UsageRow>, today: string, weekFrom: string, weeklyBudgetUsd: number): Usage {
  const u: Usage = { todayTokens: 0, weekTokens: 0, todayCostUsd: 0, weekCostUsd: 0, weeklyBudgetUsd }
  for (const r of rows) {
    if (r.day < weekFrom || r.day > today) continue
    if (r.type === 'cost') {
      u.weekCostUsd += r.value
      if (r.day === today) u.todayCostUsd += r.value
    } else {
      const n = Math.round(r.value)
      u.weekTokens += n
      if (r.day === today) u.todayTokens += n
    }
  }
  return u
}
