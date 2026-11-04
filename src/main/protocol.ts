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

/** Serves files under `root` only; anything else (other host, traversal, directories, missing) is a 404. */
export function serveRenderer(root: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    const file = url.host === APP_HOST ? resolveInside(root, url.pathname) : null
    const isFile = file !== null && (await stat(file).then((s) => s.isFile(), () => false))
    return isFile ? net.fetch(pathToFileURL(file).toString()) : new Response('Not found', { status: 404 })
  })
}
