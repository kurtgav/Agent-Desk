import { useCallback, useEffect, useRef, useState } from 'react'

/** A card never gets narrower than this; the grid fits as many as the width allows (3 at 1440 px, 2 at 1200 px). */
export const MIN_CARD = 264
export const GAP = 12

/** How many cards fit across the element the returned ref is put on. Starts at 3 (a server render has no width), then follows its width. */
export function useColumns(): [(el: HTMLElement | null) => void, number] {
  const [columns, setColumns] = useState(3)
  const observer = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = (): void => setColumns(Math.max(1, Math.floor((el.clientWidth + GAP) / (MIN_CARD + GAP))))
    measure()
    observer.current = new ResizeObserver(measure)
    observer.current.observe(el)
  }, [])
  useEffect(() => () => observer.current?.disconnect(), [])
  return [ref, columns]
}
