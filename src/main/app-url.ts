// Pure app:// URL helpers (ADR-0010). No electron import: unit-testable.
import { isAbsolute, relative, resolve, sep } from 'node:path'

export const APP_SCHEME = 'app'
export const APP_HOST = 'agentdeck'
export const APP_ENTRY = `${APP_SCHEME}://${APP_HOST}/index.html`

/** Maps an app:// URL pathname to a file inside `root`, or null if it would escape `root`. */
export function resolveInside(root: string, urlPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const file = resolve(root, decoded.replace(/^[/\\]+/, ''))
  const rel = relative(root, file)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null
  return file
}

/** True for our own origin (and the electron-vite dev server origin when one is in use). */
export function isAppUrl(url: string, devUrl?: string): boolean {
  try {
    const u = new URL(url)
    // Node's URL gives non-special schemes an opaque "null" origin, so compare scheme + host.
    if (u.protocol === `${APP_SCHEME}:` && u.host === APP_HOST) return true
    return devUrl !== undefined && u.origin === new URL(devUrl).origin
  } catch {
    return false
  }
}
