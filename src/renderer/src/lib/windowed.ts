/**
 * Windowing for long lists (the sidebar's sessions past ~200 rows, the Agents panel's ~350): which rows are on screen, from the
 * rows' heights and the scroll position. Pure; shell/useWindowed.ts feeds it the scroll position.
 */

/** Below this many rows a list is drawn whole: cheaper than the bookkeeping, and every row is findable by find-in-page and tests. */
export const WINDOW_AFTER = 200

/** Where each row starts, plus the total at the end: `offsets[i]` is the top of row i and `offsets[n]` the list's height. */
export function offsetsOf(heights: readonly number[]): number[] {
  const out = [0]
  for (const h of heights) out.push(out[out.length - 1]! + h)
  return out
}

export interface Range {
  start: number
  /** Exclusive. */
  end: number
}

/** The first row whose bottom is below `y`. */
function rowAt(offsets: readonly number[], y: number): number {
  let lo = 0
  let hi = offsets.length - 2
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (offsets[mid + 1]! <= y) lo = mid + 1
    else hi = mid
  }
  return Math.max(0, lo)
}

/** The rows that cross [top, top + viewport), plus `overscan` rows each side so a fast scroll never shows a gap. */
export function visibleRange(offsets: readonly number[], top: number, viewport: number, overscan = 8): Range {
  const n = offsets.length - 1
  if (n <= 0) return { start: 0, end: 0 }
  const first = rowAt(offsets, Math.max(0, top))
  const last = rowAt(offsets, Math.max(0, top) + Math.max(1, viewport))
  return { start: Math.max(0, first - overscan), end: Math.min(n, last + 1 + overscan) }
}

/** The scroll position that brings row `i` into view with the least movement. */
export function scrollToShow(offsets: readonly number[], i: number, top: number, viewport: number): number {
  const rowTop = offsets[i] ?? 0
  const rowBottom = offsets[i + 1] ?? rowTop
  if (rowTop < top) return rowTop
  if (rowBottom > top + viewport) return rowBottom - viewport
  return top
}
