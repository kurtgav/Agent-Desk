import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

interface Placed {
  left: number
  width: number
  top?: number
  bottom?: number
  maxHeight: number
}

const GAP = 8
const EDGE = 12
const MIN_ROOM = 220

/**
 * A menu that floats at the edge of the composer without being clipped by anything around it (it is told how much room it has, in pixels): it is drawn on the body and placed from
 * the composer's own rectangle, above it or below it (whichever has room, `prefer` first), and follows it while the page scrolls or resizes.
 */
export function Anchored({ anchor, prefer = 'top', maxHeight = 420, children }: { anchor: RefObject<HTMLElement | null>; prefer?: 'top' | 'bottom'; maxHeight?: number; children(room: number): ReactNode }) {
  const [placed, setPlaced] = useState<Placed | null>(null)
  useLayoutEffect(() => {
    const place = (): void => {
      const el = anchor.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const above = r.top - GAP - EDGE
      const below = window.innerHeight - r.bottom - GAP - EDGE
      const up = prefer === 'top' ? above >= MIN_ROOM || above >= below : below < MIN_ROOM && above > below
      const width = Math.min(Math.max(r.width, 360), window.innerWidth - 2 * EDGE)
      setPlaced({
        left: Math.max(EDGE, Math.min(r.left, window.innerWidth - width - EDGE)),
        width,
        ...(up ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP }),
        maxHeight: Math.max(120, Math.min(maxHeight, up ? above : below))
      })
    }
    place()
    // The composer grows as you type, and a menu above it has to move with its top edge.
    const watch = new ResizeObserver(place)
    if (anchor.current) watch.observe(anchor.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      watch.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor, prefer, maxHeight])
  if (!placed || typeof document === 'undefined') return null
  const { maxHeight: max, ...pos } = placed
  return createPortal(
    <div style={{ position: 'fixed', zIndex: 50, ...pos }} data-composer-menu>
      {children(max)}
    </div>,
    document.body
  )
}
