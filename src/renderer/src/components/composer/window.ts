/**
 * Windowing for the `@` list: about 350 roles are in the list, a few more than a screen holds are in the page. Rows have fixed
 * heights (a header is shorter than a role), so where a row is, and which rows are in view, is arithmetic.
 */

export const ROLE_ROW_H = 48
export const HEADER_ROW_H = 30

export interface Layout {
  tops: number[]
  heights: number[]
  total: number
}

export function layoutOf(rows: readonly { kind: 'header' | 'role' }[]): Layout {
  const tops: number[] = []
  const heights: number[] = []
  let at = 0
  for (const r of rows) {
    const h = r.kind === 'header' ? HEADER_ROW_H : ROLE_ROW_H
    tops.push(at)
    heights.push(h)
    at += h
  }
  return { tops, heights, total: at }
}

/** The rows `[from, to)` that touch the viewport, plus `overscan` rows each side. */
export function rangeAt(l: Layout, scrollTop: number, viewport: number, overscan = 3): [number, number] {
  const n = l.tops.length
  if (n === 0) return [0, 0]
  // First row whose bottom is below the top edge.
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (l.tops[mid]! + l.heights[mid]! <= scrollTop) lo = mid + 1
    else hi = mid
  }
  let end = lo
  while (end < n && l.tops[end]! < scrollTop + viewport) end++
  return [Math.max(0, lo - overscan), Math.min(n, end + overscan)]
}

/** The scroll position that brings `[top, top + height]` into view with the least movement (unchanged when it already is). */
export function scrollToShow(top: number, height: number, scrollTop: number, viewport: number): number {
  if (top < scrollTop) return top
  if (top + height > scrollTop + viewport) return top + height - viewport
  return scrollTop
}

/** When the active role is the first of its group, its header scrolls into view with it, so the group's name is never cut off. */
export function topFor(l: Layout, rowIndex: number, rows: readonly { kind: 'header' | 'role' }[]): { top: number; height: number } {
  const header = rows[rowIndex - 1]?.kind === 'header' ? HEADER_ROW_H : 0
  return { top: l.tops[rowIndex]! - header, height: l.heights[rowIndex]! + header }
}
