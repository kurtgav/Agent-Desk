import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Snapshot } from '@shared/snapshot'
import { startCollector, type Collector } from './app'
import { fixture, s1Deliveries } from './fixtures'
import { normalizeHook } from './normalize'
import { MAX_BODY } from './server'
import { Store } from './store'

const TOKEN = 'a'.repeat(64)
let collector: Collector
let dir: string
const onChange = vi.fn()
const onError = vi.fn()

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'agentdeck-app-'))
  writeFileSync(join(dir, 'reviewer.md'), '---\nname: reviewer\n---')
  writeFileSync(join(dir, 'planner.md'), '---\nname: planner\n---')
  writeFileSync(join(dir, 'notes.txt'), 'not an agent')
  collector = await startCollector({ dbPath: ':memory:', token: TOKEN, ports: [0], agentsDir: dir, claude: false, onChange, onError })
})
afterAll(async () => {
  await collector.close()
  rmSync(dir, { recursive: true, force: true })
})

interface Res {
  status: number
  body: string
}
function send(method: string, path: string, body = '', headers: Record<string, string> = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: collector.port, method, path, headers: { 'x-agentdeck-token': TOKEN, 'content-type': 'application/json', ...headers } },
      (res) => {
        let data = ''
        res.on('data', (c: Buffer) => (data += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
      }
    )
    req.on('error', reject)
    req.end(body)
  })
}
const hook = (body: unknown) => send('POST', '/hooks', typeof body === 'string' ? body : JSON.stringify(body))

describe('endpoint security (ADR-0010)', () => {
  it('rejects a missing or wrong token', async () => {
    expect((await send('GET', '/health', '', { 'x-agentdeck-token': '' })).status).toBe(401)
    expect((await send('GET', '/health', '', { 'x-agentdeck-token': 'b'.repeat(64) })).status).toBe(401)
    expect((await send('GET', '/health', '', { 'x-agentdeck-token': 'short' })).status).toBe(401)
  })

  it('rejects anything carrying a browser Origin, even with the token', async () => {
    expect((await send('POST', '/hooks', '{}', { origin: 'https://evil.example' })).status).toBe(403)
    expect((await send('GET', '/api/snapshot', '', { origin: 'null' })).status).toBe(403)
  })

  it('rejects a Host other than 127.0.0.1:<port> (DNS rebinding)', async () => {
    expect((await send('GET', '/health', '', { host: `localhost:${collector.port}` })).status).toBe(403)
    expect((await send('GET', '/health', '', { host: 'evil.example' })).status).toBe(403)
  })

  it('caps bodies at 1 MB, answering before reading them', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({
        host: '127.0.0.1',
        port: collector.port,
        method: 'POST',
        path: '/hooks',
        headers: { 'x-agentdeck-token': TOKEN, 'content-length': String(MAX_BODY + 1) }
      })
      req.on('response', (res) => resolve(res.statusCode ?? 0))
      req.on('error', reject) // a reset after the response is ignored: the promise has settled
      req.flushHeaders() // headers only; the server must not wait for the body
    })
    expect(status).toBe(413)
  })

  it('answers /health and 404s unknown routes', async () => {
    expect(JSON.parse((await send('GET', '/health')).body)).toEqual({ app: 'agentdeck', pid: process.pid })
    expect((await send('GET', '/nope')).status).toBe(404)
    expect((await send('GET', '/hooks')).status).toBe(404)
  })
})

describe('hook ingest', () => {
  it('replies 200 with an empty body, even to garbage (D-029)', async () => {
    expect(await hook('not json')).toEqual({ status: 200, body: '' })
    expect(await hook({ nope: true })).toEqual({ status: 200, body: '' })
  })

  it('keeps going after hostile bodies: deep nesting, prototype names (security review LOW-5)', async () => {
    const deep = `{"session_id":"h","hook_event_name":"PreToolUse","tool_input":${'['.repeat(50_000)}${']'.repeat(50_000)}}`
    expect((await hook(deep)).status).toBe(200)
    expect((await hook({ session_id: 'h', hook_event_name: 'constructor' })).status).toBe(200)
    await hook({ ...fixture('UserPromptSubmit-1'), session_id: 'after-hostile' })
    await vi.waitFor(() => expect(collector.snapshot().sessions.some((s) => s.id === 'after-hostile')).toBe(true))
  })

  it('shows a started tool in Running now well inside 1 s', async () => {
    onChange.mockClear()
    const session_id = 'live-1'
    await hook({ ...fixture('UserPromptSubmit-1'), session_id })
    const sent = Date.now()
    await hook({ ...fixture('PreToolUse-5'), session_id })
    await vi.waitFor(() => {
      const s = collector.snapshot().sessions.find((x) => x.id === session_id)
      expect(s).toMatchObject({ status: 'working', activity: 'Running `echo spike-from-shell`', name: 'scratch' })
    })
    expect(Date.now() - sent).toBeLessThan(1_000)
    expect(onChange).toHaveBeenCalled()
  })

  it('replays the whole S1 capture over HTTP into a valid snapshot, answering each hook in < 20 ms p95', async () => {
    const took: number[] = []
    for (const d of s1Deliveries()) {
      const t = performance.now()
      await hook(d.raw)
      took.push(performance.now() - t)
    }
    took.sort((a, b) => a - b)
    expect(took[Math.floor(took.length * 0.95)]).toBeLessThan(20) // ARCHITECTURE § 2 budget, client-side upper bound
    await vi.waitFor(() => expect(collector.snapshot().week.finishedTurns.length).toBeGreaterThanOrEqual(6))
    const snap = Snapshot.parse(JSON.parse((await send('GET', '/api/snapshot')).body))
    expect(snap.files.map((f) => f.path.split('\\').pop())).toEqual(['hello.txt'])
    expect(snap.agentDefinitionCount).toBe(2)
    // Main-thread S1 events carry agent_type "ui-color-palette:uicper" (settings `agent`); only subagents count.
    expect(snap.recentAgentTypes).toEqual(['Explore'])
    expect(onError).not.toHaveBeenCalled()
  })

  it('"while you were away" runs from losing focus to getting it back (D-007, D-060)', () => {
    collector.setFocused(false, 1234)
    expect(collector.snapshot()).toMatchObject({ awaySince: 1234, awayUntil: null })
    collector.setFocused(true, 5678)
    expect(collector.snapshot()).toMatchObject({ awaySince: 1234, awayUntil: 5678 })
    collector.setFocused(true, 9999) // a repeated focus event keeps the first return
    expect(collector.snapshot().awayUntil).toBe(5678)
  })
})

describe('poller wiring, with a stand-in `claude` CLI (code review: app.ts untested with the poller on)', () => {
  let dir2: string
  let live: Collector | null = null

  beforeAll(() => {
    dir2 = mkdtempSync(join(tmpdir(), 'agentdeck-cli-'))
    // Answers `--version` like the real CLI, and `agents --json --all` with rows.json. A .cmd, like the npm shim.
    writeFileSync(
      join(dir2, 'fake-claude.mjs'),
      `import { readFileSync } from 'node:fs'
if (process.argv[2] === '--version') process.stdout.write('2.1.318 (Claude Code)\\n')
else process.stdout.write(readFileSync(new URL('./rows.json', import.meta.url), 'utf8'))`
    )
    writeFileSync(join(dir2, 'claude.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0fake-claude.mjs" %*\r\n`)
  })
  afterAll(async () => {
    await live?.close()
    rmSync(dir2, { recursive: true, force: true })
  })

  it('after a restart, ends sessions that vanished meanwhile and picks up the ones still running (D-057)', async () => {
    const dbPath = join(dir2, 'agentdeck.db')
    const before = Date.now() - 60_000 // a minute ago: outside the hook window
    const store = new Store(dbPath)
    const prompt = (session_id: string) => JSON.stringify({ session_id, hook_event_name: 'UserPromptSubmit', cwd: 'D:\\p', prompt: 'go' })
    store.ingest([normalizeHook(prompt('gone-meanwhile'), before)!, normalizeHook(prompt('still-here'), before)!])
    store.close()
    writeFileSync(join(dir2, 'rows.json'), JSON.stringify([{ sessionId: 'still-here', kind: 'interactive', status: 'busy', cwd: 'D:\\p', name: 'web', startedAt: before }]))

    live = await startCollector({ dbPath, token: TOKEN, ports: [0], agentsDir: null, claude: join(dir2, 'claude.cmd'), onChange: () => undefined, onError })
    await vi.waitFor(
      () => {
        const byId = new Map(live!.snapshot().sessions.map((s) => [s.id, s]))
        expect(byId.get('still-here')).toMatchObject({ status: 'working', activity: 'Working', name: 'web' })
        expect(byId.get('gone-meanwhile')).toMatchObject({ status: 'idle', activity: 'Ended' })
      },
      { timeout: 15_000, interval: 100 }
    )
    expect(onError).not.toHaveBeenCalled()
  }, 30_000)
})
