/**
 * Local calendar days, `YYYY-MM-DD`. Every function goes through `new Date(y, m, d)` so a day is whatever the local clock
 * says it is: 23 h or 25 h on a DST change, and midnight rolls over on the wall clock, not on a 24 h count.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

/** The local day `ts` falls on. */
export function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Year, month (1-12) and day of a real calendar date; null for `2026-02-31` and anything that is not `YYYY-MM-DD`. */
export function dayParts(day: string): [number, number, number] | null {
  const m = DAY.exec(day)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const check = new Date(y, mo - 1, d)
  return check.getFullYear() === y && check.getMonth() === mo - 1 && check.getDate() === d ? [y, mo, d] : null
}

export const isDay = (day: string): boolean => dayParts(day) !== null

/** [local midnight, next local midnight) of `day`. Throws on a string that is not a real day. */
export function dayBounds(day: string): [number, number] {
  const p = dayParts(day)
  if (!p) throw new RangeError(`Not a calendar day: ${day}`)
  return [new Date(p[0], p[1] - 1, p[2]).getTime(), new Date(p[0], p[1] - 1, p[2] + 1).getTime()]
}

/** `n` calendar days after `day` (negative = before). Noon avoids the hour a DST change may skip at midnight. */
export function addDays(day: string, n: number): string {
  const p = dayParts(day)
  if (!p) throw new RangeError(`Not a calendar day: ${day}`)
  return dayKey(new Date(p[0], p[1] - 1, p[2] + n, 12).getTime())
}

/** Minutes after local midnight. */
export function minutesOfDay(ts: number): number {
  const d = new Date(ts)
  return d.getHours() * 60 + d.getMinutes()
}
