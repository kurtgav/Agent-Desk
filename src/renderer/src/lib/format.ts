const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function timeOfDay(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  return 'evening'
}

export function dateLabel(now: number, locale?: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', timeZone }).format(now)
}

/** Compact elapsed time: "<1m", "12m", "1h 12m", "2d 3h". */
export function duration(ms: number): string {
  if (ms < MINUTE) return '<1m'
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`
  if (ms < DAY) {
    const m = Math.floor((ms % HOUR) / MINUTE)
    return m ? `${Math.floor(ms / HOUR)}h ${m}m` : `${Math.floor(ms / HOUR)}h`
  }
  const h = Math.floor((ms % DAY) / HOUR)
  return h ? `${Math.floor(ms / DAY)}d ${h}h` : `${Math.floor(ms / DAY)}d`
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** An age in words: "2 minutes", "1 hour", "3 days". */
export function ageWords(ms: number): string {
  if (ms < MINUTE) return 'under a minute'
  if (ms < HOUR) return plural(Math.floor(ms / MINUTE), 'minute')
  if (ms < DAY) return plural(Math.floor(ms / HOUR), 'hour')
  return plural(Math.floor(ms / DAY), 'day')
}

/** Recency for lists: "just now", "2 min ago", "3 hours ago", "Yesterday", "4 days ago". */
export function ago(ms: number): string {
  if (ms < MINUTE) return 'just now'
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`
  if (ms < DAY) return `${plural(Math.floor(ms / HOUR), 'hour')} ago`
  if (ms < 2 * DAY) return 'Yesterday'
  return `${Math.floor(ms / DAY)} days ago`
}

/** "2h 35m more than last week", "40m less than last week", "Same as last week". */
export function weekDelta(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? 'Nothing measured yet' : 'Nothing to compare with last week'
  const diff = current - previous
  if (Math.abs(diff) < MINUTE) return 'Same as last week'
  return `${duration(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than last week`
}

/** A timeline renders up to 200 rows; building three formatters per row each render adds up. */
const clockFormats = new Map<string, { day: Intl.DateTimeFormat; time: Intl.DateTimeFormat; date: Intl.DateTimeFormat }>()

/** Clock time for timelines: "14:02:07" today, "Nov 3, 14:02" before. */
export function clock(ts: number, now: number, locale?: string, timeZone?: string): string {
  const key = `${locale ?? ''}|${timeZone ?? ''}`
  let f = clockFormats.get(key)
  if (!f) {
    f = {
      day: new Intl.DateTimeFormat('en-CA', { timeZone }),
      time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone }),
      date: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone })
    }
    clockFormats.set(key, f)
  }
  return (f.day.format(ts) === f.day.format(now) ? f.time : f.date).format(ts)
}

export function usd(n: number): string {
  return `$${n.toFixed(2)}`
}

export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}
