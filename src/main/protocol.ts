// app:// serves the built renderer (ADR-0010): a real origin, no file:// privileges.
import { stat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { APP_HOST, APP_SCHEME, resolveInside } from './app-url'

/** Must run before `app` is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

/**
 * ADR-0010's policy as a response header. index.html repeats it as a <meta> for the dev server;
 * only the header can carry frame-ancestors. font-src allows data: because Vite inlines small fonts.
 */
export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"

/** Serves files under `root` only; anything else (other host, traversal, directories, missing) is a 404. */
export function serveRenderer(root: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    const file = url.host === APP_HOST ? resolveInside(root, url.pathname) : null
    const isFile = file !== null && (await stat(file).then((s) => s.isFile(), () => false))
    if (!isFile) return new Response('Not found', { status: 404 })
    const res = await net.fetch(pathToFileURL(file).toString())
    const headers = new Headers(res.headers)
    headers.set('Content-Security-Policy', CSP)
    headers.set('X-Content-Type-Options', 'nosniff')
    return new Response(res.body, { status: res.status, headers })
  })
}
