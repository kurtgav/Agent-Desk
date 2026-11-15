import type { ActionResult } from '@shared/bridge'

export type HeldBack = 'paused' | 'quiet'

export interface TestLine {
  tone: 'ok' | 'error'
  text: string
}

/** Why a real notification would not pop up right now. The same rule as `isPaused` and `inQuietHours` in main/notify.ts. */
export function heldBack(now: Date, pausedUntil: number | null, quiet: { from: number; to: number } | null): HeldBack | null {
  if (pausedUntil !== null && now.getTime() < pausedUntil) return 'paused'
  if (!quiet) return null
  const m = now.getHours() * 60 + now.getMinutes()
  const inside = quiet.from < quiet.to ? m >= quiet.from && m < quiet.to : m >= quiet.from || m < quiet.to
  return inside ? 'quiet' : null
}

const NOTE: Record<HeldBack, string> = {
  paused: 'Notifications are paused right now, so real ones would not pop up. This test ignores the pause.',
  quiet: 'It is quiet hours right now, so real ones would not pop up. This test ignores them.'
}

/** The line under the button: what Windows did with the test, in plain words. */
export function testLine(result: ActionResult, held: HeldBack | null): TestLine {
  if (!result.ok) return { tone: 'error', text: result.error }
  const sent = 'Sent. Look for it at the corner of your screen. If you cannot see it, Focus assist or Do not disturb may be hiding it.'
  return { tone: 'ok', text: held ? `${sent} ${NOTE[held]}` : sent }
}
