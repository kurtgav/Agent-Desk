/**
 * Back and forward (Alt+Left, Alt+Right) over the places the window has been. Pure: the store holds one of these and
 * `go` pushes onto it. Going somewhere new drops what was forward of the current place, as a browser does.
 */

export interface NavHistory<T> {
  entries: T[]
  index: number
}

export const HISTORY_MAX = 50

export function startHistory<T>(first: T): NavHistory<T> {
  return { entries: [first], index: 0 }
}

export function pushNav<T>(h: NavHistory<T>, next: T, same: (a: T, b: T) => boolean): NavHistory<T> {
  const here = h.entries[h.index]
  if (here !== undefined && same(here, next)) return h
  const entries = [...h.entries.slice(0, h.index + 1), next].slice(-HISTORY_MAX)
  return { entries, index: entries.length - 1 }
}

/** One step back (-1) or forward (+1); null when there is nowhere to go. */
export function stepNav<T>(h: NavHistory<T>, delta: -1 | 1): NavHistory<T> | null {
  const index = h.index + delta
  return index < 0 || index >= h.entries.length ? null : { entries: h.entries, index }
}

export const canGoBack = <T,>(h: NavHistory<T>): boolean => h.index > 0
export const canGoForward = <T,>(h: NavHistory<T>): boolean => h.index < h.entries.length - 1
