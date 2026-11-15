/**
 * The window's keyboard shortcuts (IA § 8) as a pure map from a key event to an action, so the table is testable and the one
 * listener in the frame only runs what this returns.
 *
 *   Ctrl+N new session · Ctrl+K search · Ctrl+Shift+A Agents · Ctrl+1..9 nth session · Ctrl+B sidebar ·
 *   Ctrl+Alt+D details · Alt+Left / Alt+Right back / forward
 */

export type ShortcutAction =
  | { kind: 'new' }
  | { kind: 'palette' }
  | { kind: 'agents' }
  | { kind: 'nth'; n: number }
  | { kind: 'sidebar' }
  | { kind: 'details' }
  | { kind: 'back' }
  | { kind: 'forward' }

export interface KeyLike {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export function shortcutFor(e: KeyLike): ShortcutAction | null {
  const mod = e.ctrlKey || e.metaKey
  const key = e.key.toLowerCase()
  if (!mod && e.altKey && !e.shiftKey) {
    if (e.key === 'ArrowLeft') return { kind: 'back' }
    if (e.key === 'ArrowRight') return { kind: 'forward' }
    return null
  }
  if (!mod) return null
  if (e.altKey) return !e.shiftKey && (key === 'd' || e.code === 'KeyD') ? { kind: 'details' } : null
  if (e.shiftKey) return key === 'a' ? { kind: 'agents' } : null
  if (key === 'n') return { kind: 'new' }
  if (key === 'k') return { kind: 'palette' }
  if (key === 'b') return { kind: 'sidebar' }
  return /^[1-9]$/.test(e.key) ? { kind: 'nth', n: Number(e.key) } : null
}
