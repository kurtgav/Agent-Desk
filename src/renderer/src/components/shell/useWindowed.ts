import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { WINDOW_AFTER, offsetsOf, scrollToShow, visibleRange, type Range } from '@/lib/windowed'

/** What a server render (and the tests) assume the list's height to be, since nothing has been measured. */
const GUESS_VIEWPORT = 640

export interface Windowed {
  /** Rows to draw. The whole list when it is short. */
  range: Range
  /** Space standing in for the rows above and below the range. */
  padTop: number
  padBottom: number
  /** Scrolls the list so row `i` is on screen. */
  reveal(i: number): void
}

/**
 * Keeps only the rows on screen in the tree. `heights[i]` is row i's fixed height; the scroll container is `ref`. A list shorter than
 * `after` rows (WINDOW_AFTER) is drawn whole.
 */
export function useWindowed(ref: RefObject<HTMLElement | null>, heights: readonly number[], after = WINDOW_AFTER): Windowed {
  const [view, setView] = useState({ top: 0, height: GUESS_VIEWPORT })
  const offsets = useMemo(() => offsetsOf(heights), [heights])
  const windowed = heights.length > after
  const raf = useRef(0)

  useEffect(() => {
    const el = ref.current
    if (!el || !windowed) return
    const read = (): void => {
      cancelAnimationFrame(raf.current)
      raf.current = requestAnimationFrame(() => setView({ top: el.scrollTop, height: el.clientHeight || GUESS_VIEWPORT }))
    }
    read()
    el.addEventListener('scroll', read, { passive: true })
    const size = new ResizeObserver(read)
    size.observe(el)
    return () => {
      cancelAnimationFrame(raf.current)
      el.removeEventListener('scroll', read)
      size.disconnect()
    }
  }, [ref, windowed])

  const reveal = useCallback(
    (i: number): void => {
      const el = ref.current
      if (!el) return
      el.scrollTop = scrollToShow(offsets, i, el.scrollTop, el.clientHeight || GUESS_VIEWPORT)
    },
    [ref, offsets]
  )

  if (!windowed) return { range: { start: 0, end: heights.length }, padTop: 0, padBottom: 0, reveal }
  const range = visibleRange(offsets, view.top, view.height)
  return { range, padTop: offsets[range.start] ?? 0, padBottom: (offsets[heights.length] ?? 0) - (offsets[range.end] ?? 0), reveal }
}
