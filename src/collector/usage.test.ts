import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COST_METRIC, TOKEN_METRIC, parseUsage, summarizeUsage, type UsagePoint } from './usage'

// Real bodies from Claude Code 2.1.318 (spike), redacted: the identity attributes read "REDACTED".
const body = (n: number): string => readFileSync(join(__dirname, '../../test/fixtures/otel/2.1.318', `metrics-${n}.json`), 'utf8')

const attr = (key: string, stringValue: string) => ({ key, value: { stringValue } })
/** An OTLP/JSON sum metric with the attribute shape of the real bodies. */
function otlp(name: string, points: { attrs: ReturnType<typeof attr>[]; asDouble?: number | string; asInt?: number | string }[], temporality = 1): string {
  return JSON.stringify({
    resourceMetrics: [{ resource: { attributes: [] }, scopeMetrics: [{ scope: { name: 'com.anthropic.claude_code' }, metrics: [{ name, unit: '', sum: { aggregationTemporality: temporality, isMonotonic: true, dataPoints: points.map((p) => ({ attributes: p.attrs, timeUnixNano: '1793822822368000000', ...p, attrs: undefined })) } }] }] }]
  })
}
const byType = (points: UsagePoint[]): Record<string, number> => Object.fromEntries(points.map((p) => [p.type, p.value]))

describe('parseUsage (real Claude Code bodies)', () => {
  it('reads the token and cost deltas of one export', () => {
    const points = parseUsage(body(11))
    expect(points).toHaveLength(5)
    expect(points.every((p) => p.model === 'claude-haiku-5-5')).toBe(true)
    expect(byType(points)).toEqual({ input: 2, output: 181, cacheRead: 34_834, cacheCreation: 4_763, cost: 0.00139164 })
  })

  it('skips metrics it does not use (session.count)', () => {
    expect(parseUsage(body(1))).toEqual([])
  })

  it('never lets an identity attribute out: a point holds a model, a type and a number', () => {
    const points = parseUsage(body(11))
    for (const p of points) expect(Object.keys(p).sort()).toEqual(['model', 'type', 'value'])
    expect(JSON.stringify(points)).not.toMatch(/REDACTED|user\.|organization|@|session/i)
    const hostile = otlp(TOKEN_METRIC, [{ attrs: [attr('user.email', 'someone@example.com'), attr('organization.id', 'org-1'), attr('type', 'input'), attr('model', 'm')], asDouble: 3 }])
    expect(JSON.stringify(parseUsage(hostile))).toBe('[{"model":"m","type":"input","value":3}]')
  })
})

describe('parseUsage (shapes and limits)', () => {
  it('adds the points of one model and type together', () => {
    const points = parseUsage(
      otlp(TOKEN_METRIC, [
        { attrs: [attr('type', 'output'), attr('model', 'm')], asDouble: 5 },
        { attrs: [attr('type', 'output'), attr('model', 'm')], asInt: '7' },
        { attrs: [attr('type', 'output'), attr('model', 'other')], asDouble: 1 }
      ])
    )
    expect(points).toContainEqual({ model: 'm', type: 'output', value: 12 })
    expect(points).toContainEqual({ model: 'other', type: 'output', value: 1 })
  })

  it('reads cost.usage with or without a model', () => {
    expect(parseUsage(otlp(COST_METRIC, [{ attrs: [], asDouble: 0.25 }]))).toEqual([{ model: 'unknown', type: 'cost', value: 0.25 }])
  })

  it('ignores a cumulative series: summing it would count everything twice', () => {
    expect(parseUsage(otlp(TOKEN_METRIC, [{ attrs: [attr('type', 'input')], asDouble: 9 }], 2))).toEqual([])
  })

  it('skips a token type it does not know, and values that are not plain non-negative numbers', () => {
    const points = parseUsage(
      otlp(TOKEN_METRIC, [
        { attrs: [attr('type', 'reasoning'), attr('model', 'm')], asDouble: 4 },
        { attrs: [attr('type', 'input'), attr('model', 'm')], asDouble: -1 },
        { attrs: [attr('type', 'input'), attr('model', 'm')], asDouble: 'many' },
        { attrs: [attr('type', 'input'), attr('model', 'm')] },
        { attrs: [attr('type', 'input'), attr('model', 'm')], asDouble: 6 }
      ])
    )
    expect(points).toEqual([{ model: 'm', type: 'input', value: 6 }])
  })

  it('cleans and shortens a model name', () => {
    const [p] = parseUsage(otlp(COST_METRIC, [{ attrs: [attr('model', `a\tb‮${'x'.repeat(200)}`)], asDouble: 1 }]))
    expect(p!.model).not.toMatch(/[\t‮]/)
    expect(p!.model.length).toBeLessThanOrEqual(64)
  })

  it('answers nothing for JSON that is not OTLP, and throws for text that is not JSON', () => {
    expect(parseUsage('{}')).toEqual([])
    expect(parseUsage('{"resourceMetrics":"no"}')).toEqual([])
    expect(() => parseUsage('not json')).toThrow()
  })
})

describe('summarizeUsage', () => {
  const rows = [
    { day: '2026-11-08', type: 'cost' as const, value: 99 }, // last week
    { day: '2026-11-09', type: 'cost' as const, value: 1.5 },
    { day: '2026-11-09', type: 'input' as const, value: 10 },
    { day: '2026-11-13', type: 'cost' as const, value: 2.25 },
    { day: '2026-11-13', type: 'output' as const, value: 100.4 },
    { day: '2026-11-13', type: 'cacheRead' as const, value: 900 }
  ]

  it('adds today and the week separately, tokens of every kind, cost apart', () => {
    expect(summarizeUsage(rows, '2026-11-13', '2026-11-09', 40)).toEqual({ todayTokens: 1000, weekTokens: 1010, todayCostUsd: 2.25, weekCostUsd: 3.75, weeklyBudgetUsd: 40 })
  })

  it('counts nothing from before the week or after today', () => {
    expect(summarizeUsage(rows, '2026-11-09', '2026-11-09', 10)).toMatchObject({ todayTokens: 10, weekTokens: 10, todayCostUsd: 1.5, weekCostUsd: 1.5 })
  })
})
