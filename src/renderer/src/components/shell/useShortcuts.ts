import { useEffect } from 'react'
import { NEW_SESSION, useUi, type Nav } from '@/store'
import { shortcutFor, type ShortcutAction } from '@/lib/shortcuts'
import { findEntry, sidebarOrder } from '@/lib/sessionList'
import { isRunning, stopConversation, useConsole } from '../console/store'
import { newSession } from './actions'
import { currentEntries } from './useEntries'
import { toggleDetails } from './useDetailsOpen'

const CHORD_MS = 1_000
/** `g` then a letter, when no field or dialog has focus: go to the new session screen (home), Overview, Tasks, Sessions or Approvals. */
const CHORD: Record<string, Nav> = { h: NEW_SESSION, o: { page: 'overview' }, t: { page: 'tasks' }, s: { page: 'sessions' }, a: { page: 'approvals' } }

const inOverlay = (t: EventTarget | null): boolean => !!(t as HTMLElement | null)?.closest?.('[role="dialog"], [role="menu"], [role="listbox"]')
const inField = (t: EventTarget | null): boolean => !!(t as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]')

function run(action: ShortcutAction): void {
  const ui = useUi.getState()
  switch (action.kind) {
    case 'new':
      return newSession()
    case 'palette':
      return ui.setPalette(!ui.palette)
    case 'agents':
      return ui.go({ page: 'roles' })
    case 'nth': {
      const order = sidebarOrder(currentEntries(), ui.sessionMeta, ui.now)
      const target = order[action.n - 1]
      return target ? ui.openSession(target.key) : undefined
    }
    case 'sidebar':
      return ui.toggleSidebar()
    case 'details':
      return ui.nav.page === 'session' ? toggleDetails() : undefined
    case 'back':
      return ui.back()
    case 'forward':
      return ui.forward()
  }
}

/** Esc or Ctrl+. stops the turn that is running in the open session (a menu or dialog keeps its own Esc). */
function stopRunningTurn(e: KeyboardEvent): boolean {
  const mod = e.ctrlKey || e.metaKey
  if (!((mod && e.key === '.') || (e.key === 'Escape' && !mod && !e.altKey && !e.shiftKey))) return false
  if (e.defaultPrevented || inOverlay(e.target)) return false
  const { nav } = useUi.getState()
  const { selected, convs } = useConsole.getState()
  if (nav.page !== 'session' || !selected || !isRunning(convs[selected]) || !findEntry(currentEntries(), nav.session)) return false
  e.preventDefault()
  void stopConversation(selected)
  return true
}

/**
 * The window's keyboard shortcuts (IA § 8; the table is lib/shortcuts.ts): Ctrl+N, Ctrl+K, Ctrl+Shift+A, Ctrl+1..9, Ctrl+B, Ctrl+Alt+D,
 * Alt+Left and Alt+Right, plus Esc to stop a turn and the `g` chords. Ctrl+K works anywhere; the others leave a menu or dialog alone.
 */
export function useShortcuts(): void {
  useEffect(() => {
    let g = 0
    const onKey = (e: KeyboardEvent): void => {
      if (e.isComposing) return
      const action = shortcutFor(e)
      if (action) {
        if (action.kind !== 'palette' && inOverlay(e.target)) return
        e.preventDefault()
        run(action)
        return
      }
      if (stopRunningTurn(e)) return
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || inField(e.target)) return
      const key = e.key.toLowerCase()
      const to = g && Date.now() - g < CHORD_MS ? CHORD[key] : undefined
      if (to) {
        e.preventDefault()
        g = 0
        useUi.getState().go(to)
        return
      }
      g = key === 'g' ? Date.now() : 0
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
