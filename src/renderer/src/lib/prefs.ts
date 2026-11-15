/**
 * Per-viewer conveniences kept in localStorage: whether the sidebar is collapsed, whether Details is open, which agent groups are
 * open. Never data that must survive: a blocked or cleared store only means the window opens in its default layout.
 */

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // a convenience only; ignore storage failures
  }
}

export function readJsonPref<T>(key: string, check: (v: unknown) => v is T, fallback: T): T {
  const raw = readPref(key)
  if (raw === null) return fallback
  try {
    const parsed: unknown = JSON.parse(raw)
    return check(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

export const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
