import { THEME_STORAGE_KEY, parseThemeChoice, type ResolvedTheme } from '@shared/theme'
import type { ThemeChoice } from '@shared/work'

/**
 * The page side of light / dark. Each function copes with there being no document, storage or matchMedia (the unit tests
 * run in Node, and storage can be blocked), and none of them throws.
 */

const DARK_QUERY = '(prefers-color-scheme: dark)'

type Store = Pick<Storage, 'getItem' | 'setItem'>

function localStore(): Store | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** The choice last mirrored here, or null when none was (first run, cleared site data, blocked storage). */
export function readStoredChoice(store: Store | null = localStore()): ThemeChoice | null {
  try {
    return parseThemeChoice(store?.getItem(THEME_STORAGE_KEY))
  } catch {
    return null
  }
}

export function writeStoredChoice(choice: ThemeChoice, store: Store | null = localStore()): void {
  try {
    store?.setItem(THEME_STORAGE_KEY, choice)
  } catch {
    // per-viewer convenience only; main's config.json is the record
  }
}

const darkQuery = (): MediaQueryList | null => (typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(DARK_QUERY) : null)

export const systemPrefersDark = (): boolean => darkQuery()?.matches ?? false

/** Calls `onChange` when the OS flips between light and dark. Returns the way to stop. */
export function watchSystemTheme(onChange: () => void): () => void {
  const query = darkQuery()
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}

/** Writes the resolved theme where the stylesheet and the browser's own widgets read it. A change repaints in one frame. */
export function paintTheme(theme: ResolvedTheme, root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement): void {
  if (!root || root.dataset.theme === theme) return
  const first = root.dataset.theme === undefined
  if (!first) {
    root.classList.add('theme-switching')
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')))
  }
  root.dataset.theme = theme
  root.style.colorScheme = theme
}
