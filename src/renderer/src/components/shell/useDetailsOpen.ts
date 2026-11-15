import { useSyncExternalStore } from 'react'
import { DETAILS_AUTO_MIN_WIDTH, detailsOpenAt, useUi } from '@/store'

const subscribe = (notify: () => void): (() => void) => {
  window.addEventListener('resize', notify)
  return () => window.removeEventListener('resize', notify)
}

/** The window's width; a server render (the tests) has none and reads as wide enough for everything. */
export function useViewportWidth(): number {
  return useSyncExternalStore(subscribe, () => window.innerWidth, () => DETAILS_AUTO_MIN_WIDTH)
}

/** Whether the Details panel is open: what you chose last, else open on a wide window and closed on a narrow one. */
export function useDetailsOpen(): boolean {
  const pref = useUi((s) => s.detailsPref)
  return detailsOpenAt(pref, useViewportWidth())
}

/** Ctrl+Alt+D and the header's Details button. */
export function toggleDetails(): void {
  const ui = useUi.getState()
  ui.setDetails(!detailsOpenAt(ui.detailsPref, window.innerWidth))
}
