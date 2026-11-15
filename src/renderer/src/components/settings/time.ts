/** `HH:mm` (what `<input type="time">` holds) ↔ minutes after local midnight (what notifications.quietHours holds). */
export function toMinutes(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

export function fromMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  return `${String(h).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** Quiet hours start at 22:00 and end at 07:00 when first switched on. */
export const QUIET_DEFAULT = { from: 22 * 60, to: 7 * 60 } as const

/** `2026-11-13` → "Friday, November 13", in the person's own language. */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(y!, m! - 1, d!))
}
