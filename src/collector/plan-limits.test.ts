import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parsePlanLimits, planLimitsReader } from './plan-limits'

const NOW = Date.UTC(2026, 10, 15, 12, 30)
const SEC = (ms: number): number => Math.round(ms / 1000)
const SESSION_RESET = NOW + 100 * 60_000
const WEEK_RESET = NOW + 4 * 86_400_000
const limits = { five_hour: { used_percentage: 16, resets_at: SEC(SESSION_RESET) }, seven_day: { used_percentage: 23.5, resets_at: SEC(WEEK_RESET) } }

describe('parsePlanLimits', () => {
  it('reads both windows, from rate_limits alone (PowerShell) or the whole status line input (sh)', () => {
    const want = { session: { usedPct: 16, resetsAt: SESSION_RESET }, week: { usedPct: 23.5, resetsAt: WEEK_RESET }, at: NOW - 5_000 }
    expect(parsePlanLimits(JSON.stringify(limits), NOW - 5_000, NOW)).toEqual(want)
    const whole = { session_id: 'x', cwd: 'D:\\secret', transcript_path: 'D:\\t.jsonl', model: { id: 'claude-opus-5-5' }, rate_limits: limits }
    expect(parsePlanLimits(JSON.stringify(whole), NOW - 5_000, NOW)).toEqual(want)
    expect(parsePlanLimits(`\uFEFF${JSON.stringify(limits)}`, NOW, NOW)?.session?.usedPct).toBe(16)
  })

  it('keeps a window that is there when the other is absent', () => {
    expect(parsePlanLimits(JSON.stringify({ seven_day: limits.seven_day }), NOW, NOW)).toEqual({ session: null, week: { usedPct: 23.5, resetsAt: WEEK_RESET }, at: NOW })
  })

  it('drops a window whose reset has passed, and says nothing when none is left', () => {
    const past = { five_hour: { used_percentage: 90, resets_at: SEC(NOW - 60_000) }, seven_day: limits.seven_day }
    expect(parsePlanLimits(JSON.stringify(past), NOW, NOW)?.session).toBeNull()
    expect(parsePlanLimits(JSON.stringify({ five_hour: past.five_hour }), NOW, NOW)).toBeNull()
  })

  it('clamps the share to 0-100', () => {
    const odd = { five_hour: { used_percentage: 130, resets_at: SEC(SESSION_RESET) }, seven_day: { used_percentage: -4, resets_at: SEC(WEEK_RESET) } }
    const r = parsePlanLimits(JSON.stringify(odd), NOW, NOW)
    expect([r?.session?.usedPct, r?.week?.usedPct]).toEqual([100, 0])
  })

  it('reads garbage, a half-written file and wrong types as nothing', () => {
    for (const text of ['', '{"five_hour": {"used_perc', 'null', '[]', '42', JSON.stringify({ rate_limits: null }), JSON.stringify({ five_hour: { used_percentage: '16', resets_at: SEC(SESSION_RESET) } }), JSON.stringify({ five_hour: { used_percentage: 16 } })]) {
      expect(parsePlanLimits(text, NOW, NOW)).toBeNull()
    }
  })
})

describe('planLimitsReader', () => {
  let dir: string | null = null
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = null
  })

  it('is null without a file, reads it when it appears and again only when it changes', () => {
    dir = mkdtempSync(join(tmpdir(), 'agentdeck-limits-'))
    const file = join(dir, 'rate-limits.json')
    const read = planLimitsReader(file)
    expect(read(NOW)).toBeNull()
    writeFileSync(file, JSON.stringify(limits))
    utimesSync(file, new Date(NOW - 60_000), new Date(NOW - 60_000))
    expect(read(NOW)).toEqual({ session: { usedPct: 16, resetsAt: SESSION_RESET }, week: { usedPct: 23.5, resetsAt: WEEK_RESET }, at: NOW - 60_000 })
    writeFileSync(file, 'not json')
    utimesSync(file, new Date(NOW), new Date(NOW))
    expect(read(NOW)).toBeNull()
    rmSync(file)
    expect(read(NOW)).toBeNull()
    expect(planLimitsReader(undefined)(NOW)).toBeNull()
  })
})

