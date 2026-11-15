import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type RefObject } from 'react'
import type { Windowed } from './useWindowed'

/**
 * One tab stop for a long list, arrow keys inside it (WAI-ARIA APG roving tabindex): 350 agents or 100 sessions must not be 350 or 100
 * presses of Tab. Rows carry `data-row={index}` and their main button `data-focus`; `targets` are the row indexes that can take focus
 * (headings that are not buttons are left out). A row that is not drawn yet (the list is windowed) is scrolled to first, then focused.
 */
export interface Roving {
  tabIndexFor(row: number): 0 | -1
  containerProps: { onKeyDown(e: KeyboardEvent<HTMLElement>): void; onFocusCapture(e: FocusEvent<HTMLElement>): void }
}

const rowOf = (el: EventTarget | null): number | null => {
  const row = (el as HTMLElement | null)?.closest<HTMLElement>('[data-row]')?.dataset.row
  return row === undefined ? null : Number(row)
}

export function useRoving(container: RefObject<HTMLElement | null>, targets: readonly number[], win: Windowed): Roving {
  const [active, setActive] = useState<number | null>(null)
  const pending = useRef<number | null>(null)
  const current = active !== null && targets.includes(active) ? active : (targets[0] ?? -1)

  useEffect(() => {
    const row = pending.current
    if (row === null) return
    const el = container.current?.querySelector<HTMLElement>(`[data-row="${row}"] [data-focus]`)
    if (!el) return // not drawn yet: the range changes and this runs again
    pending.current = null
    el.focus()
  }, [container, active, win.range.start, win.range.end])

  const move = (to: number): void => {
    pending.current = to
    setActive(to)
    win.reveal(to)
  }

  return {
    tabIndexFor: (row) => (row === current ? 0 : -1),
    containerProps: {
      onFocusCapture: (e) => {
        const row = rowOf(e.target)
        if (row !== null && targets.includes(row)) setActive(row)
      },
      onKeyDown: (e) => {
        if (e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing || targets.length === 0) return
        const from = rowOf(e.target)
        const at = from === null ? -1 : targets.indexOf(from)
        // Only the row's main button drives the list: a menu or the filter box keeps its own arrow keys.
        if (at < 0 || !(e.target as HTMLElement).hasAttribute('data-focus')) return
        const last = targets.length - 1
        const to = e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? last : e.key === 'PageDown' ? at + 8 : e.key === 'PageUp' ? at - 8 : null
        if (to === null) return
        e.preventDefault()
        move(targets[Math.min(last, Math.max(0, to))]!)
      }
    }
  }
}
