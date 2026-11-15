import { addDays, dayKey, minutesOfDay } from '@shared/day'
import { EOD_DEFAULTS, type EodSettings } from '@shared/work'
import { isLocalFolder } from './settings-model'

/**
 * When the Daily report is written. From the daily time on, today's file is written, and rewritten soon after the day
 * changes (the collector says so with `work-changed`), no more often than every 30 seconds; the day is closed for good
 * once midnight has passed (the catch-up). Pure: the clock and the state come in, a decision goes out, so DST days,
 * midnight and waking from sleep are all unit-testable (eod-scheduler.ts does the I/O).
 */

export const TICK_MS = 60_000
/** After a change, today's file is rewritten no sooner than this after the last rewrite: the file never changes faster than this. */
export const CHANGE_GAP_MS = 30_000
/** A change waits this long for the burst it belongs to to end, so a run of events is one rewrite. */
export const SETTLE_MS = 2_000
/**
 * A check with nothing reported, from the daily time until midnight: the collector may have restarted (so a change went
 * unheard), and agent time moves with the clock alone. A check that finds nothing new writes nothing.
 */
export const IDLE_CHECK_MS = 10 * 60_000
/** On startup, resume and midnight, days this far back that have data but no closed report are closed. */
export const CATCH_UP_DAYS = 14
/** Ticks come every minute: a longer gap means the PC slept, so past days are checked again. */
export const RESUME_GAP_MS = 3 * TICK_MS

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/
const FOLDER_MAX = 1024

/** `config.json` → `eod`, field by field: a bad field falls back to its default and leaves the others alone. */
export function parseEodSettings(raw: unknown): EodSettings {
  const o = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const folder = typeof o.folder === 'string' ? o.folder.trim() : ''
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : EOD_DEFAULTS.enabled,
    time: typeof o.time === 'string' && TIME.test(o.time) ? o.time : EOD_DEFAULTS.time,
    // The rule Settings applies: a hand-edited UNC path would otherwise stall the writer for the whole SMB timeout.
    folder: folder.length > 0 && folder.length <= FOLDER_MAX && isLocalFolder(folder) ? folder : EOD_DEFAULTS.folder
  }
}

/** Minutes after local midnight for a valid `HH:mm`. */
export function timeToMinutes(hhmm: string): number {
  const m = TIME.exec(hhmm) ?? TIME.exec(EOD_DEFAULTS.time)
  return Number(m?.[1] ?? 0) * 60 + Number(m?.[2] ?? 0)
}

/** Whether the daily time has come on the day `now` is in. */
export const published = (now: number, settings: EodSettings): boolean => minutesOfDay(now) >= timeToMinutes(settings.time)

export interface EodState {
  /** The local day the last tick saw; null before the first. */
  day: string | null
  lastTickAt: number
  /** Earlier days were checked since startup, resume or midnight. */
  caughtUp: boolean
  /** When today's file was last refreshed; 0 = not yet today. */
  refreshedAt: number
  /** The day changed since the last refresh began (or that refresh could not be done): the next one is due after the gap. */
  dirty: boolean
}

export const initialState = (): EodState => ({ day: null, lastTickAt: 0, caughtUp: false, refreshedAt: 0, dirty: false })

/** Called at the start of every tick: a new local day starts over, and waking from sleep re-checks the past days. */
export function rollState(state: EodState, now: number): EodState {
  const today = dayKey(now)
  if (state.day !== today) return { day: today, lastTickAt: now, caughtUp: false, refreshedAt: 0, dirty: false }
  const slept = state.lastTickAt > 0 && now - state.lastTickAt > RESUME_GAP_MS
  return { ...state, lastTickAt: now, caughtUp: state.caughtUp && !slept }
}

export type EodAction =
  | { type: 'none' }
  /** Close the days before today that have data and no closed report, writing each one's file for the last time. */
  | { type: 'catch-up' }
  /** Today's file: written when the daily time comes, then rewritten whenever the day has something new. */
  | { type: 'refresh'; day: string }

/**
 * What to do now. Past days first. Then nothing before the daily time; at it, publish; after it, refresh when the day
 * changed and the last refresh is 30 s old, or, with nothing reported, when the last check is 10 minutes old.
 */
export function dueAction(now: number, settings: EodSettings, state: EodState): EodAction {
  if (!settings.enabled) return { type: 'none' }
  if (!state.caughtUp) return { type: 'catch-up' }
  if (!published(now, settings)) return { type: 'none' }
  const age = now - state.refreshedAt
  const due = state.refreshedAt === 0 || (state.dirty ? age >= CHANGE_GAP_MS : age >= IDLE_CHECK_MS)
  return due ? { type: 'refresh', day: dayKey(now) } : { type: 'none' }
}

/** How long until a reported change is due for its refresh; never less than the settle time. */
export const changeDelay = (now: number, state: EodState): number => Math.max(SETTLE_MS, state.refreshedAt + CHANGE_GAP_MS - now)

/** Whether a day is one the catch-up looks at: before today, and no further back than 14 days. */
export function inCatchUpWindow(day: string, now: number): boolean {
  const today = dayKey(now)
  return day < today && day >= addDays(today, -CATCH_UP_DAYS)
}
