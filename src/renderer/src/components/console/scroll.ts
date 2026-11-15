import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

/** How far from the end still counts as "at the end": a few lines of slack, so a small wobble does not unpin the thread. */
export const STICK_SLACK_PX = 48

export interface ScrollMetrics {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

export const isNearBottom = (m: ScrollMetrics, slack = STICK_SLACK_PX): boolean => m.scrollHeight - m.scrollTop - m.clientHeight <= slack

/**
 * Whether the thread follows new content. The user's own scrolling decides: a scroll that ends away from the bottom
 * (they scrolled up) lets go; one that ends at the bottom (they scrolled back, or we did) holds on. Content growing
 * changes nothing by itself, so a long answer that keeps arriving never drags a reader down.
 */
export const stickAfterScroll = (m: ScrollMetrics): boolean => isNearBottom(m)

/**
 * Keeps a scrolling thread at its end while `content` grows, until the user scrolls up. `jump` returns to the end.
 * Reduced motion: the jump is instant either way (nothing here animates).
 */
export function useStickToBottom(scroller: RefObject<HTMLElement | null>, content: RefObject<HTMLElement | null>, resetKey: string): { stuck: boolean; jump(): void } {
  const [stuck, setStuck] = useState(true)
  const follow = useRef(true)

  const toEnd = useCallback((): void => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [scroller])

  const set = useCallback((v: boolean): void => {
    follow.current = v
    setStuck(v)
  }, [])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onScroll = (): void => {
      const near = stickAfterScroll(el)
      if (near !== follow.current) set(near)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [scroller, set])

  useEffect(() => {
    const node = content.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (follow.current) toEnd()
    })
    ro.observe(node)
    return () => ro.disconnect()
  }, [content, toEnd])

  // Another conversation opens at its end.
  useEffect(() => {
    set(true)
    toEnd()
  }, [resetKey, set, toEnd])

  const jump = useCallback((): void => {
    set(true)
    toEnd()
  }, [set, toEnd])

  return { stuck, jump }
}
