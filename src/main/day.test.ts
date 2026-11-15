import { afterAll, describe, expect, it } from 'vitest'
import { addDays, dayBounds, dayKey, dayParts, isDay, minutesOfDay } from '@shared/day'

const HOUR = 3_600_000
// `delete process.env.TZ` does not undo a TZ change on Windows, so the machine's own zone is set back by name.
const realZone = Intl.DateTimeFormat().resolvedOptions().timeZone

afterAll(() => {
  process.env.TZ = realZone
})

describe('days', () => {
  it('keys a timestamp by its local day', () => {
    expect(dayKey(new Date(2026, 10, 13, 0, 0, 0).getTime())).toBe('2026-11-13')
    expect(dayKey(new Date(2026, 10, 13, 23, 59, 59, 999).getTime())).toBe('2026-11-13')
    expect(dayKey(new Date(2026, 10, 14, 0, 0, 0).getTime())).toBe('2026-11-14')
  })

  it('accepts real dates only', () => {
    expect(isDay('2026-11-13')).toBe(true)
    expect(isDay('2028-02-29')).toBe(true)
    for (const bad of ['2026-02-31', '2027-02-29', '2026-13-01', '2026-00-10', '2026-1-1', '26-11-13', '', '2026-11-13x', '0050-01-01']) {
      expect(isDay(bad), bad).toBe(false)
    }
    expect(dayParts('2026-11-13')).toEqual([2026, 11, 13])
    expect(dayParts('nope')).toBeNull()
  })

  it('bounds a day by local midnights and throws on a non-day', () => {
    const [from, to] = dayBounds('2026-11-13')
    expect(from).toBe(new Date(2026, 10, 13).getTime())
    expect(to).toBe(new Date(2026, 10, 14).getTime())
    expect(() => dayBounds('2026-02-30')).toThrow(RangeError)
    expect(() => addDays('x', 1)).toThrow(RangeError)
  })

  it('adds days across month and year ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-11-13', -14)).toBe('2026-10-30')
    expect(addDays('2026-11-13', 0)).toBe('2026-11-13')
  })

  it('reads minutes after local midnight', () => {
    expect(minutesOfDay(new Date(2026, 10, 13, 18, 5).getTime())).toBe(18 * 60 + 5)
    expect(minutesOfDay(new Date(2026, 10, 13, 0, 0).getTime())).toBe(0)
  })

  // The machine's own time zone may have no DST, so this pins one that does. It is skipped where the runtime ignores TZ.
  it('keeps a 23 h and a 25 h day whole', ({ skip }) => {
    process.env.TZ = 'America/New_York'
    if (new Date(2026, 2, 8, 12).getTimezoneOffset() === new Date(2026, 0, 8, 12).getTimezoneOffset()) skip()
    const [springFrom, springTo] = dayBounds('2026-03-08') // clocks jump 02:00 -> 03:00
    expect((springTo - springFrom) / HOUR).toBe(23)
    const [fallFrom, fallTo] = dayBounds('2026-11-01') // 01:00 happens twice
    expect((fallTo - fallFrom) / HOUR).toBe(25)
    expect(dayKey(springTo - 1)).toBe('2026-03-08')
    expect(dayKey(springTo)).toBe('2026-03-09')
    expect(dayKey(fallTo - 1)).toBe('2026-11-01')
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08')
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02')
    expect(addDays('2026-11-02', -1)).toBe('2026-11-01')
  })
})
