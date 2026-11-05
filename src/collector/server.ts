import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/** ADR-0010: bodies above this get 413. */
export const MAX_BODY = 1024 * 1024
const HOST = '127.0.0.1'
/** Hook requests are small and local; a stalled client must not hold a socket open. */
const REQUEST_TIMEOUT_MS = 10_000

export interface Handlers {
  token: string
  /**
   * Must only queue the body (D-029): Claude Code never waits on our processing. The one exception is a request
   * held for remote approvals (ADR-0006): the reply then waits for the promise, whose value is the JSON body
   * (undefined = empty). `gone` aborts when the connection closes first.
   */
  onHook(raw: string, receivedAt: number, gone: AbortSignal): Promise<unknown> | void
  snapshot(): unknown
}

function tokenOk(given: string | string[] | undefined, token: string): boolean {
  if (typeof given !== 'string') return false
  const a = Buffer.from(given)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

const reply = (res: ServerResponse, status: number, json?: unknown): void => {
  if (json === undefined) {
    res.writeHead(status).end()
    return
  }
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json))
}

function tooLarge(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(413, { connection: 'close' }).end()
  res.once('finish', () => req.destroy()) // let the 413 reach the client before the socket goes
}

function readBody(req: IncomingMessage, res: ServerResponse, done: (raw: string) => void): void {
  if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) return tooLarge(req, res)
  const chunks: Buffer[] = []
  let size = 0
  req.on('data', (c: Buffer) => {
    if (size > MAX_BODY) return // already rejected; drop the rest
    size += c.length
    if (size > MAX_BODY) return tooLarge(req, res)
    chunks.push(c)
  })
  req.on('end', () => {
    if (size <= MAX_BODY) done(Buffer.concat(chunks).toString('utf8'))
  })
}

function handler(h: Handlers, port: () => number) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    // DNS rebinding and browsers: only our exact Host, and never a request that carries an Origin (ADR-0010).
    if (req.headers.host !== `${HOST}:${port()}` || req.headers.origin !== undefined) return reply(res, 403)
    if (!tokenOk(req.headers['x-agentdeck-token'], h.token)) return reply(res, 401)
    const url = req.url ?? '/'
    if (req.method === 'POST' && url === '/hooks') {
      return readBody(req, res, (raw) => {
        const gone = new AbortController()
        const held = h.onHook(raw, Date.now(), gone.signal)
        if (!held) return reply(res, 200) // empty body = success, no decision (D-029); the body was only queued
        res.once('close', () => gone.abort()) // also fires after our reply; the hold is settled by then
        void held.then((body) => {
          if (!res.destroyed && !res.writableEnded) reply(res, 200, body)
        })
      })
    }
    if (req.method === 'GET' && url === '/health') return reply(res, 200, { app: 'agentdeck', pid: process.pid })
    if (req.method === 'GET' && url === '/api/snapshot') return reply(res, 200, h.snapshot())
    reply(res, 404)
  }
}

function tryListen(server: Server, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      server.off('listening', onListening)
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') resolve(false)
      else reject(err)
    }
    const onListening = (): void => {
      server.off('error', onError)
      resolve(true)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, HOST)
  })
}

/** Binds 127.0.0.1 on the first free port of `ports` (D-001: 47821, then 47822–47831). */
export async function listen(h: Handlers, ports: readonly number[]): Promise<{ server: Server; port: number }> {
  let bound = 0
  const server = createServer(handler(h, () => bound))
  server.requestTimeout = REQUEST_TIMEOUT_MS
  server.headersTimeout = REQUEST_TIMEOUT_MS
  for (const p of ports) {
    if (await tryListen(server, p)) {
      bound = (server.address() as AddressInfo).port
      return { server, port: bound }
    }
  }
  throw new Error(`No free port in ${ports.join(', ')}`)
}
