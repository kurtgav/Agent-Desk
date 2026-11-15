import { readFileSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Snapshot } from '@shared/snapshot'
import { startCollector, type Collector } from './app'
import type { AgentEvent } from './events'
import { normalizeHook, type HookOrigin } from './normalize'
import { vanished } from './poll'
import { reduceSession, toSession, type SessionState } from './reduce'
import { Store } from './store'

// Codex 0.162.1 bodies in the shape it sent them (spike S0, ADR-0014); every value is a sentinel.
const DIR = join('test', 'fixtures', 'hooks', 'codex-0.162.1')
const raw = (name: string): string => readFileSync(join(DIR, `${name}.json`), 'utf8')
const ORDER = readFileSync(join(DIR, '_order.txt'), 'utf8').trim().split(/\r?\n/)
const CODEX: HookOrigin = { provider: 'codex', pid: null }
const SID = 'codex:019a7c2e-5b1d-7f20-9c4e-2d8f6a1b3c50'

let t = 1_000_000
const ev = (name: string, origin: HookOrigin = CODEX): AgentEvent => normalizeHook(raw(name), (t += 1000), origin)!
const run = (names: string[], origin?: HookOrigin): SessionState => names.reduce<SessionState | undefined>((s, n) => reduceSession(s, ev(n, origin)).session, undefined)!

describe('Codex hook bodies (normalize)', () => {
  it('maps every captured event to its kind, under a prefixed session id', () => {
    const kinds = [...ORDER, 'PermissionRequest-1', 'Interrupt-1'].map((n) => [n, ev(n).kind, ev(n).sessionId])
    expect(kinds).toEqual([
      ['SessionStart-1', 'session.meta', SID],
      ['UserPromptSubmit-1', 'session.prompt', SID],
      ['PreToolUse-1', 'tool.started', SID],
      ['PostToolUse-1', 'tool.finished', SID],
      ['PreToolUse-2', 'tool.started', SID],
      ['PostToolUse-2', 'tool.finished', SID],
      ['Stop-1', 'turn.stopped', SID],
      ['SessionEnd-1', 'session.ended', SID],
      ['PermissionRequest-1', 'permission.requested', SID],
      ['Interrupt-1', 'turn.interrupted', SID]
    ])
  })

  it('drops the transcript path and keeps no file body from apply_patch, only the files it names', () => {
    for (const n of ORDER) expect(ev(n).payload).not.toHaveProperty('transcript_path')
    const pre = ev('PreToolUse-2')
    expect(pre.payload.tool_input).toEqual({ files: ['C:\\work\\demo\\notes.txt'], size: expect.any(Number) })
    expect(JSON.stringify(pre.payload)).not.toContain('SENTINEL-FILE-BODY')
    expect(pre.summary).toBe('Editing `notes.txt`')
    expect(ev('PreToolUse-1').summary).toBe('Running `node --version`')
  })

  it('adds the pid the shim reported, and leaves Claude Code ids alone', () => {
    expect(ev('SessionStart-1', { provider: 'codex', pid: 4242 }).payload.agentdeck_pid).toBe(4242)
    expect(ev('SessionStart-1').payload).not.toHaveProperty('agentdeck_pid')
    expect(normalizeHook(raw('Stop-1'), 1)!.sessionId).toBe('019a7c2e-5b1d-7f20-9c4e-2d8f6a1b3c50')
  })
})

describe('Codex sessions (reduce)', () => {
  it('prompt, two tools, stop: done, with its provider, model and pid', () => {
    const s = reduceSession(run(ORDER.slice(0, -1)), ev('SessionStart-1', { provider: 'codex', pid: 4242 })).session
    expect(s).toMatchObject({ status: 'done', activity: 'Finished', inflight: [], pid: 4242, model: 'gpt-5.6-luna', name: 'demo' })
    expect(toSession(s)).toMatchObject({ provider: 'codex', model: 'gpt-5.6-luna', status: 'done' })
    expect(() => Snapshot.shape.sessions.element.parse(toSession(s))).not.toThrow()
  })

  it('an interrupt leaves it idle, not finished', () => {
    const s = run(['UserPromptSubmit-1', 'PreToolUse-1', 'Interrupt-1'])
    expect(s).toMatchObject({ status: 'idle', activity: 'Interrupted', inflight: [], turn: null })
  })

  it('a Post that arrives before its Pre (async hooks) leaves no call open', () => {
    const s = run(['UserPromptSubmit-1', 'PostToolUse-1', 'PreToolUse-1'])
    expect(s.inflight).toEqual([])
  })

  it('the request\u2019s own Pre arriving after it keeps the session waiting; the Post answers it', () => {
    const waiting = run(['UserPromptSubmit-1', 'PermissionRequest-1', 'PreToolUse-1'])
    expect(waiting).toMatchObject({ status: 'needs_you', activity: 'Waiting for your OK' })
    expect(reduceSession(waiting, ev('PostToolUse-1')).session.status).toBe('working')
  })

  it('a Claude Code session has no provider or model in the snapshot', () => {
    const s = run(['UserPromptSubmit-1', 'Stop-1'], { provider: 'claude', pid: null })
    expect(toSession(s)).not.toHaveProperty('provider')
    expect(toSession(s)).not.toHaveProperty('model')
  })
})

describe('Codex in the store (attention)', () => {
  it('a late Pre of the asked-about call does not close its Needs you item; the Post does', () => {
    const store = new Store(':memory:')
    try {
      store.ingest(['UserPromptSubmit-1', 'PermissionRequest-1', 'PreToolUse-1'].map((n) => ev(n)))
      const open = store.snapshot(t, { awaySince: null, awayUntil: null, agentDefinitionCount: 0 }).attention
      expect(open).toMatchObject([{ sessionId: SID, kind: 'approval', held: false }])
      store.ingest([ev('PostToolUse-1')])
      expect(store.snapshot(t, { awaySince: null, awayUntil: null, agentDefinitionCount: 0 }).attention.filter((a) => a.kind === 'approval')).toEqual([])
    } finally {
      store.close()
    }
  })
})

describe('liveness without a poll', () => {
  it('a Codex session whose process is gone has ended; Claude Code sessions are the poll\u2019s', () => {
    const codex = { ...run(['UserPromptSubmit-1']), pid: 4242 }
    const claude = { ...run(['UserPromptSubmit-1'], { provider: 'claude', pid: null }), pid: 4343 }
    const gone = vanished([codex, claude], 5, () => false)
    expect(gone.map((e) => [e.sessionId, e.kind])).toEqual([[SID, 'session.gone']])
    expect(vanished([codex], 5, () => true)).toEqual([])
    expect(reduceSession(codex, gone[0]!).session).toMatchObject({ ended: true, status: 'idle' })
  })
})

describe('the /hooks/codex route', () => {
  const TOKEN = 'b'.repeat(64)
  let collector: Collector
  beforeAll(async () => {
    collector = await startCollector({ dbPath: ':memory:', token: TOKEN, ports: [0], agentsDir: null, claude: false, onChange: vi.fn(), onError: vi.fn() })
  })
  afterAll(() => collector.close())
  const send = (path: string, body: string, headers: Record<string, string> = {}): Promise<number> =>
    new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: collector.port, method: 'POST', path, headers: { 'x-agentdeck-token': TOKEN, ...headers } }, (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode ?? 0))
      })
      req.on('error', reject)
      req.end(body)
    })

  it('takes a body with the token, rejects one without, and knows no other provider', async () => {
    expect(await send('/hooks/codex', raw('SessionStart-1'), { 'x-agentdeck-pid': '4242' })).toBe(200)
    expect(await send('/hooks/codex', raw('Stop-1'), { 'x-agentdeck-token': '' })).toBe(401)
    expect(await send('/hooks/codex', raw('Stop-1'), { origin: 'http://evil.test' })).toBe(403)
    expect(await send('/hooks/gemini', raw('Stop-1'))).toBe(404)
    await vi.waitFor(() => expect(collector.snapshot().sessions.find((s) => s.id === SID)).toMatchObject({ provider: 'codex', pid: 4242 }))
  })
})
