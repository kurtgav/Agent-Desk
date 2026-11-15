/** Small numbers said the way the rest of the app says them: short, with units, never false precision. */

/** Claude Code's own estimate (a subscription is not billed per call), so it is shown as one. */
export function formatCost(usd: number | null): string {
  if (usd === null || usd <= 0) return ''
  return usd < 0.005 ? '< $0.01' : `$${usd.toFixed(2)}`
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return ''
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`
  const min = Math.floor(ms / 60_000)
  const sec = Math.round((ms % 60_000) / 1000)
  return sec === 60 ? `${min + 1} min` : `${min} min ${sec} s`
}

export function formatTokens(n: number | null): string {
  if (n === null) return ''
  if (n < 1_000) return String(n)
  return n < 100_000 ? `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k` : `${Math.round(n / 1_000)}k`
}

/** Seconds since `since`, for a running turn ("12 s", "1 min 5 s"). */
export function elapsed(since: number | null, now: number): string {
  return since === null ? '' : formatDuration(Math.max(0, Math.floor((now - since) / 1000)) * 1000)
}

/** `6.7 s · 130k in · 4 out · $0.52`: the quiet line under a finished turn. */
export function turnSummary(t: { durationMs: number | null; inputTokens: number | null; outputTokens: number | null; costUsd: number | null }): string {
  return [
    formatDuration(t.durationMs),
    t.inputTokens === null ? '' : `${formatTokens(t.inputTokens)} in`,
    t.outputTokens === null ? '' : `${formatTokens(t.outputTokens)} out`,
    formatCost(t.costUsd)
  ]
    .filter(Boolean)
    .join(' · ')
}
