/**
 * What a key does in the composer, decided in one place so it can be tested without a browser. The box asks with the key and the
 * state it is in; it gets back one action (or null: the key is the box's own, a letter or an arrow inside the text).
 */

export type KeyAction = 'send' | 'menu-down' | 'menu-up' | 'menu-page-down' | 'menu-page-up' | 'menu-pick' | 'menu-dismiss' | 'stop' | 'delete-back' | 'delete-forward'

export interface KeyEvent {
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  /** An input method (IME) is composing: its keys are never ours. */
  composing: boolean
}

export interface KeyState {
  /** `listed`: a menu with entries is open. `note`: a menu is open with only a note in it (nothing matches, nothing loaded yet). */
  menu: 'none' | 'listed' | 'note'
  /** The whole name of the highlighted `/` entry is already typed: Enter sends it instead of choosing it. */
  whole: boolean
  /** A task title: one line, so Enter always sends. */
  singleLine: boolean
  /** A turn is running, so Esc and Ctrl+. stop it. */
  running: boolean
}

export function composerKey(e: KeyEvent, s: KeyState): KeyAction | null {
  if (e.composing) return null
  const mod = e.ctrlKey || e.metaKey
  // Ctrl+Enter sends whatever else is going on, a menu included.
  if (e.key === 'Enter' && mod) return 'send'
  if (s.menu !== 'none') {
    if (e.key === 'Escape') return 'menu-dismiss'
    if (s.menu === 'listed' && !mod && !e.altKey) {
      if (e.key === 'ArrowDown') return 'menu-down'
      if (e.key === 'ArrowUp') return 'menu-up'
      if (e.key === 'PageDown') return 'menu-page-down'
      if (e.key === 'PageUp') return 'menu-page-up'
      if (e.key === 'Tab' && !e.shiftKey) return 'menu-pick'
      if (e.key === 'Enter' && !e.shiftKey && !s.whole) return 'menu-pick'
    }
  }
  if (s.running && ((e.key === 'Escape' && !mod && !e.altKey && !e.shiftKey) || (mod && !e.altKey && e.key === '.'))) return 'stop'
  if (e.key === 'Enter' && !mod && !e.altKey && (!e.shiftKey || s.singleLine)) return 'send'
  if (!mod && !e.altKey && !e.shiftKey) {
    if (e.key === 'Backspace') return 'delete-back'
    if (e.key === 'Delete') return 'delete-forward'
  }
  return null
}
