import { afterEach, describe, expect, it } from 'vitest'
import { EOD_DEFAULTS } from '@shared/work'
import {
  CATCH_UP_DAYS, CHANGE_GAP_MS, IDLE_CHECK_MS, RESUME_GAP_MS, SETTLE_MS, changeDelay, dueAction, inCatchUpWindow, initialState, parseEodSettings, published, rollState,
  timeToMinutes, type EodState
} from './eod-schedule'

const at = (day: number, h = 0, m = 0, month = 10): number => new Date(2026, month, day, h, m).getTime()
const MIN = 60_000
const on = { enabled: true, time: '18:00', folder: null }
const state = (over: Partial<EodState> = {}): EodState => ({ day: '2026-11-13', lastTickAt: at(13, 9), caughtUp: true, refreshedAt: 0, dirty: false, ...over })
// `delete process.env.TZ` does not undo a TZ change on Windows, so the machine's own zone is set back by name.
const realZone = Intl.DateTimeFormat().resolvedOptions().timeZone

afterEach(() => {
  process.env.TZ = realZone
})

describe('parseEodSettings', () => {
  const folder = process.platform === 'win32' ? 'D:\\reports\\eod' : '/reports/eod'

  it('uses the defaults for anything missing or not an object', () => {
    for (const raw of [undefined, null, 'x', 4, [], {}]) expect(parseEodSettings(raw)).toEqual(EOD_DEFAULTS)
  })

  it('takes valid fields as they are', () => {
    expect(parseEodSettings({ enabled: false, time: '07:05', folder })).toEqual({ enabled: false, time: '07:05', folder })
  })

  it('falls back field by field, leaving the good ones alone', () => {
    expect(parseEodSettings({ enabled: 'yes', time: '09:30', folder })).toEqual({ enabled: true, time: '09:30', folder })
    expect(parseEodSettings({ enabled: false, time: '25:00', folder })).toEqual({ enabled: false, time: '18:00', folder })
    expect(parseEodSettings({ enabled: false, time: '7:05', folder: null }).time).toBe('18:00')
    expect(parseEodSettings({ time: '18:60' }).time).toBe('18:00')
    expect(parseEodSettings({ time: 1800 }).time).toBe('18:00')
    expect(parseEodSettings({ time: '23:59' }).time).toBe('23:59')
    expect(parseEodSettings({ time: '00:00' }).time).toBe('00:00')
  })

  it('accepts an absolute folder only', () => {
    // Network and device paths are refused too, as in Settings: a hand-edited config must not stall the writer on SMB.
    for (const bad of ['reports', '.\\eod', '../eod', '', '   ', 7, 'x'.repeat(1_100), '~/eod', '\\\\nas\\share\\eod', '\\\\?\\C:\\eod', '\\eod']) {
      expect(parseEodSettings({ folder: bad }).folder, String(bad)).toBeNull()
    }
    expect(parseEodSettings({ folder: `  ${folder}  ` }).folder).toBe(folder)
  })
})

describe('timeToMinutes', () => {
  it('counts minutes after midnight and reads a bad value as the default', () => {
    expect(timeToMinutes('18:00')).toBe(1080)
    expect(timeToMinutes('00:00')).toBe(0)
    expect(timeToMinutes('23:59')).toBe(1439)
    expect(timeToMinutes('nope')).toBe(1080)
  })
})

describe('rollState', () => {
  it('starts over on the first tick', () => {
    expect(rollState(initialState(), at(13, 9))).toEqual({ day: '2026-11-13', lastTickAt: at(13, 9), caughtUp: false, refreshedAt: 0, dirty: false })
  })

  it('keeps the day going from tick to tick', () => {
    const s = state({ caughtUp: true, refreshedAt: at(13, 9) })
    expect(rollState(s, at(13, 9, 1))).toEqual({ ...s, lastTickAt: at(13, 9, 1) })
  })

  it('starts a new day at midnight: the finished day is caught up, and today has not been refreshed yet', () => {
    const s = state({ lastTickAt: at(13, 23, 59), caughtUp: true, refreshedAt: at(13, 23, 50), dirty: true })
    expect(rollState(s, at(14, 0, 1))).toEqual({ day: '2026-11-14', lastTickAt: at(14, 0, 1), caughtUp: false, refreshedAt: 0, dirty: false })
    // Month and year ends are days like any other.
    expect(rollState(state({ day: '2026-12-31' }), new Date(2027, 0, 1, 0, 0).getTime()).day).toBe('2027-01-01')
  })

  it('checks past days again after the PC slept, without forgetting when today was refreshed', () => {
    const s = state({ lastTickAt: at(13, 12), refreshedAt: at(13, 11) })
    const woke = rollState(s, at(13, 12) + RESUME_GAP_MS + 1)
    expect(woke).toMatchObject({ day: '2026-11-13', caughtUp: false, refreshedAt: at(13, 11) })
    expect(rollState(s, at(13, 12) + RESUME_GAP_MS).caughtUp).toBe(true) // a slow tick is not a sleep
  })

  it('follows the wall clock over a DST change', () => {
    process.env.TZ = 'America/New_York'
    if (new Date(2026, 2, 8, 12).getTimezoneOffset() === new Date(2026, 0, 8, 12).getTimezoneOffset()) return // TZ not honoured here
    // 23:59 on the 7th, then 03:00 on the 8th: that is 61 minutes of real time but a new day.
    const before = new Date(2026, 2, 7, 23, 59).getTime()
    const s = { ...state({ day: '2026-03-07' }), lastTickAt: before }
    expect(rollState(s, new Date(2026, 2, 8, 3, 0).getTime()).day).toBe('2026-03-08')
    // The same day on both sides of the jump is still one day.
    const early = new Date(2026, 2, 8, 1, 59).getTime()
    expect(rollState({ ...state({ day: '2026-03-08' }), lastTickAt: early }, new Date(2026, 2, 8, 3, 0).getTime()).day).toBe('2026-03-08')
    // The 25 hour day: 23:59 on 1 November is still the 1st, and 00:01 is the 2nd.
    expect(rollState({ ...state({ day: '2026-11-01' }), lastTickAt: at(1, 23, 58) }, at(1, 23, 59)).day).toBe('2026-11-01')
    expect(rollState({ ...state({ day: '2026-11-01' }), lastTickAt: at(1, 23, 59) }, at(2, 0, 1)).day).toBe('2026-11-02')
  })
})

describe('dueAction', () => {
  it('does nothing while the report is off', () => {
    expect(dueAction(at(13, 19), { ...on, enabled: false }, state({ caughtUp: false }))).toEqual({ type: 'none' })
  })

  it('catches up on past days before anything else', () => {
    expect(dueAction(at(13, 19), on, state({ caughtUp: false }))).toEqual({ type: 'catch-up' })
    expect(dueAction(at(13, 9), on, state({ caughtUp: false }))).toEqual({ type: 'catch-up' })
  })

  it('writes nothing for today before the daily time', () => {
    expect(dueAction(at(13, 9), on, state({ refreshedAt: 0 }))).toEqual({ type: 'none' })
    expect(dueAction(at(13, 17, 59), on, state({ refreshedAt: 0 }))).toEqual({ type: 'none' })
  })

  it('publishes today at the daily time, and after it rewrites only when the day changed, 30 s after the last rewrite', () => {
    const last = at(13, 18)
    const sec = (n: number): number => last + n * 1_000
    expect(dueAction(at(13, 18), on, state({ refreshedAt: 0 }))).toEqual({ type: 'refresh', day: '2026-11-13' })
    // Nothing reported: quiet, whatever the time since.
    expect(dueAction(sec(31), on, state({ refreshedAt: last }))).toEqual({ type: 'none' })
    expect(dueAction(sec(9 * 60), on, state({ refreshedAt: last }))).toEqual({ type: 'none' })
    // Changed: due once the last rewrite is 30 s old, not before.
    expect(dueAction(sec(29), on, state({ refreshedAt: last, dirty: true }))).toEqual({ type: 'none' })
    expect(dueAction(sec(30), on, state({ refreshedAt: last, dirty: true }))).toEqual({ type: 'refresh', day: '2026-11-13' })
    expect(dueAction(at(13, 23, 59), on, state({ refreshedAt: at(13, 23, 58), dirty: true }))).toEqual({ type: 'refresh', day: '2026-11-13' })
    expect(CHANGE_GAP_MS).toBe(30_000)
  })

  it('checks once in a while with nothing reported (the collector may have restarted), every 10 minutes', () => {
    const last = at(13, 18)
    expect(dueAction(last + IDLE_CHECK_MS - 1, on, state({ refreshedAt: last }))).toEqual({ type: 'none' })
    expect(dueAction(last + IDLE_CHECK_MS, on, state({ refreshedAt: last }))).toEqual({ type: 'refresh', day: '2026-11-13' })
    expect(IDLE_CHECK_MS).toBe(10 * MIN)
  })

  it('writes nothing before the daily time, changed or not', () => {
    expect(dueAction(at(13, 17, 59), on, state({ refreshedAt: 0, dirty: true }))).toEqual({ type: 'none' })
    expect(dueAction(at(13, 17, 59), on, state({ refreshedAt: at(13, 17), dirty: true }))).toEqual({ type: 'none' })
  })

  it('starts at the daily time even when the app was not running at 18:00', () => {
    expect(dueAction(at(13, 21, 30), on, state({ refreshedAt: 0 }))).toEqual({ type: 'refresh', day: '2026-11-13' })
  })

  it('reads the time from the settings it is given, so a change applies on the next tick', () => {
    const s = state({ refreshedAt: 0 })
    expect(dueAction(at(13, 9, 5), { ...on, time: '09:05' }, s)).toEqual({ type: 'refresh', day: '2026-11-13' })
    expect(dueAction(at(13, 9, 5), { ...on, time: '09:06' }, s)).toEqual({ type: 'none' })
  })

  it('publishes a day whose daily time falls in the hour the clocks skip', () => {
    process.env.TZ = 'America/New_York'
    if (new Date(2026, 2, 8, 12).getTimezoneOffset() === new Date(2026, 0, 8, 12).getTimezoneOffset()) return
    const s = state({ day: '2026-03-08', refreshedAt: 0 })
    const after = new Date(2026, 2, 8, 3, 0).getTime() // 02:30 never happened today
    expect(dueAction(after, { ...on, time: '02:30' }, s)).toEqual({ type: 'refresh', day: '2026-03-08' })
    expect(dueAction(new Date(2026, 2, 8, 1, 59).getTime(), { ...on, time: '02:30' }, s)).toEqual({ type: 'none' })
  })

  it('walks a whole day from midnight', () => {
    let s = rollState(state({ day: '2026-11-12', lastTickAt: at(12, 23, 59), refreshedAt: at(12, 23, 50) }), at(13, 0, 1))
    expect(dueAction(at(13, 0, 1), on, s)).toEqual({ type: 'catch-up' }) // the 12th is closed first
    s = { ...s, caughtUp: true }
    expect(dueAction(at(13, 0, 1), on, s)).toEqual({ type: 'none' }) // and today waits for 18:00
    expect(dueAction(at(13, 18), on, s)).toEqual({ type: 'refresh', day: '2026-11-13' })
  })
})

describe('changeDelay', () => {
  it('waits for the burst to settle, and never lets the file change faster than every 30 s', () => {
    const last = at(13, 18)
    expect(changeDelay(last + 60_000, state({ refreshedAt: last, dirty: true }))).toBe(SETTLE_MS) // long since: only the settle
    expect(changeDelay(last + 5_000, state({ refreshedAt: last, dirty: true }))).toBe(25_000)
    expect(changeDelay(last + 29_500, state({ refreshedAt: last, dirty: true }))).toBe(SETTLE_MS) // never under the settle time
    expect(changeDelay(last, state({ refreshedAt: 0, dirty: true }))).toBe(SETTLE_MS)
  })
})

describe('published', () => {
  it('is true from the daily time on, in the day it is asked about', () => {
    expect(published(at(13, 17, 59), on)).toBe(false)
    expect(published(at(13, 18), on)).toBe(true)
    expect(published(at(13, 23, 59), on)).toBe(true)
  })
})

describe('inCatchUpWindow', () => {
  const now = at(13, 9)

  it('covers the 14 days before today, not today and not the days before them', () => {
    expect(inCatchUpWindow('2026-11-12', now)).toBe(true)
    expect(inCatchUpWindow('2026-10-30', now)).toBe(true) // 14 days back
    expect(inCatchUpWindow('2026-10-29', now)).toBe(false)
    expect(inCatchUpWindow('2026-11-13', now)).toBe(false)
    expect(inCatchUpWindow('2026-11-14', now)).toBe(false)
    expect(CATCH_UP_DAYS).toBe(14)
  })

  it('counts calendar days across a year end', () => {
    const jan = new Date(2027, 0, 5, 9).getTime()
    expect(inCatchUpWindow('2026-12-22', jan)).toBe(true)
    expect(inCatchUpWindow('2026-12-21', jan)).toBe(false)
  })
})
