import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CONSOLE_MAX_LIVE, NO_OPTIONS, type ConsoleEvent, type ConsoleStart } from '@shared/console'
import { ConsoleHub } from './console-hub'
import { NO_ROLE, type RolePlan } from './console-roles'

// The definitions file of a conversation started as a role is deleted on every way that conversation can end. These start a real child
// process that is not Claude Code, so each path is the hub's own: no `init` ever arrives.
let dir: string
let events: ConsoleEvent[]
let hub: ConsoleHub | null = null

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentdeck-hub-role-'))
  events = []
})
afterEach(async () => {
  hub?.dispose()
  hub = null
  await new Promise((r) => setTimeout(r, 150))
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const make = (script: string | null): ConsoleHub =>
  (hub = new ConsoleHub(
    { command: async () => (script === null ? null : { file: process.execPath, args: ['-e', script] }), env: () => process.env, emit: (e) => events.push(e), now: Date.now },
    { flushMs: 5 }
  ))
const req = (): ConsoleStart => ({ cwd: process.cwd(), prompt: 'hello', model: null, effort: 'low', permissionMode: 'default', resume: null, options: NO_OPTIONS })
const planWithFile = (): RolePlan => {
  const file = join(dir, 'roles-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.json')
  writeFileSync(file, '{"cto":{"description":"d","prompt":"p"}}')
  return { ...NO_ROLE, lead: { id: 'cto', name: 'CTO', emoji: '🧭' }, args: ['--agents', file, '--agent', 'cto'], file, expect: 'cto' }
}
const until = async (what: string, ok: () => boolean, ms = 10_000): Promise<void> => {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('the definitions file of a conversation started as a role', () => {
  it('is deleted when the process exits before it ever said init', async () => {
    const plan = planWithFile()
    const r = await make('process.exit(3)').start(req(), plan)
    expect(r.ok).toBe(true)
    await until('the file to go', () => !existsSync(plan.file!))
    await until('the conversation to fail', () => events.some((e) => e.kind === 'state' && (e.state === 'failed' || e.state === 'ended')))
  })

  it('is deleted when the hub is disposed while Claude Code is still starting', async () => {
    const plan = planWithFile()
    const h = make('setTimeout(() => {}, 60000)')
    expect((await h.start(req(), plan)).ok).toBe(true)
    expect(existsSync(plan.file!)).toBe(true)
    h.dispose()
    // Synchronous: a quit does not wait for anything.
    expect(existsSync(plan.file!)).toBe(false)
  })

  it('is deleted when there is no Claude Code to start, and the start says so', async () => {
    const plan = planWithFile()
    const r = await make(null).start(req(), plan)
    expect(r.ok).toBe(false)
    expect(existsSync(plan.file!)).toBe(false)
  })

  it('is deleted when the live conversation limit is reached', async () => {
    const h = make('setTimeout(() => {}, 60000)')
    for (let i = 0; i < CONSOLE_MAX_LIVE; i++) expect((await h.start(req())).ok).toBe(true)
    const plan = planWithFile()
    expect(await h.start(req(), plan)).toMatchObject({ ok: false, error: expect.stringContaining('already running') })
    expect(existsSync(plan.file!)).toBe(false)
  })

  it('a conversation without a role has no file to delete, and the hub does not mind', async () => {
    const r = await make('process.exit(0)').start(req())
    expect(r.ok).toBe(true)
  })
})

describe('noting the role of a session', () => {
  it('is done once per session id, although Claude Code says init every turn', async () => {
    const fake = join(process.cwd(), 'test', 'fixtures', 'fake-claude.mjs')
    const noted: (string | null)[] = []
    const h = (hub = new ConsoleHub(
      { command: async () => ({ file: process.execPath, args: [fake] }), env: () => process.env, emit: (e) => events.push(e), now: Date.now, sessionKnown: (s) => void noted.push(s.sessionId) },
      { flushMs: 5 }
    ))
    const r = await h.start({ ...req(), prompt: 'quick one' })
    if (!r.ok) throw new Error(r.error)
    const idle = (n: number) => until(`${n} idle`, () => events.filter((e) => e.kind === 'state' && e.state === 'idle').length >= n)
    await idle(1)
    expect(h.send(r.id, 'second turn')).toEqual({ ok: true })
    await idle(2)
    expect(noted).toEqual(['11111111-2222-4333-8444-555555555555'])
  })
})
