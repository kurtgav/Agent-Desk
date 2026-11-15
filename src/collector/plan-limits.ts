// ADR-0009 amendment (status line): the plan's own limits, as AgentDeck's status line script saved them from Claude Code's
// status line input. Only `rate_limits` is read; anything else in the file (the sh script saves its whole input) is ignored.
import { readFileSync, statSync } from 'node:fs'
import type { PlanLimits, PlanWindow } from '@shared/snapshot'

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** `{ used_percentage: 0-100, resets_at: epoch seconds }`; null when it is missing, malformed or already reset. */
function planWindow(v: unknown, now: number): PlanWindow | null {
  if (!isObj(v) || !num(v.used_percentage) || !num(v.resets_at)) return null
  const resetsAt = Math.round(v.resets_at * 1000)
  return resetsAt > now ? { usedPct: Math.min(100, Math.max(0, v.used_percentage)), resetsAt } : null
}

/** `at` is when the file was written. Null unless at least one window is still open. Never throws. */
export function parsePlanLimits(text: string, at: number, now: number): PlanLimits | null {
  let j: unknown
  try {
    j = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    return null // a half-written or foreign file: no figures rather than wrong ones
  }
  if (!isObj(j)) return null
  // The PowerShell script saves `rate_limits` alone; the sh script (no jq) saves the whole status line input.
  const limits = isObj(j.rate_limits) ? j.rate_limits : j
  const session = planWindow(limits.five_hour, now)
  const week = planWindow(limits.seven_day, now)
  return session || week ? { session, week, at: Math.max(0, Math.round(at)) } : null
}

/** Reads the file again only when its modified time or size changed. No file (switch off, nothing saved yet) is null. */
export function planLimitsReader(file: string | undefined): (now: number) => PlanLimits | null {
  let cache: { key: string; text: string; at: number } | null = null
  return (now) => {
    if (!file) return null
    try {
      const st = statSync(file)
      const key = `${st.mtimeMs}:${st.size}`
      if (cache?.key !== key) cache = { key, text: readFileSync(file, 'utf8'), at: st.mtimeMs }
      return parsePlanLimits(cache.text, cache.at, now)
    } catch {
      cache = null
      return null
    }
  }
}
