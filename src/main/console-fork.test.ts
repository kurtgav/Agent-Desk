import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FORK_NAME_MAX, NO_OPTIONS, type ConsoleEvent, type ConsoleStart } from '@shared/console'
import { ConsoleHub, forkTitle } from './console-hub'
import { consoleArgs } from './console-proc'

// Fork = `claude -p … --resume <id> --fork-session`: a copy under a NEW session id. Against test/fixtures/fake-claude.mjs, which reports one.
const FAKE = resolve('test/fixtures/fake-claude.mjs')
const ORIGINAL = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const FORKED = '77777777-6666-4555-8444-333333333333'

let dir: string
let log: string
let events: ConsoleEvent[]
let hub: ConsoleHub | null = null

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentdeck-console-fork-'))
  log = join(dir, 'fake.log')
  events = []
})
afterEach(async () => {
  hub?.dispose()
  hub = null
  await new Promise((r) => setTimeout(r, 150))
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const make = (): ConsoleHub => {
  hub = new ConsoleHub({ command: async () => ({ file: process.execPath, args: [FAKE] }), env: () => ({ ...process.env, FAKE_CLAUDE_LOG: log }), emit: (e) => events.push(e), now: Date.now }, { flushMs: 5 })
  return hub
}
const req = (over: Partial<ConsoleStart> = {}): ConsoleStart => ({
  cwd: process.cwd(), prompt: 'try the other approach', model: null, effort: 'low', permissionMode: 'default', resume: null, options: NO_OPTIONS, ...over
})
const idle = async (): Promise<void> => {
  const end = Date.now() + 10_000
  while (!events.some((e) => e.kind === 'state' && e.state === 'idle')) {
    if (Date.now() > end) throw new Error(`Timed out. Events: ${events.map((e) => e.kind).join(', ')}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}
const argvOf = (): string[] => JSON.parse(readFileSync(log, 'utf8').split('\n').find((l) => l.startsWith('ARGV '))!.slice(5)) as string[]
const base = { model: null, effort: 'low', permissionMode: 'default', options: NO_OPTIONS } as const

describe('the command line of a fork', () => {
  it('adds --fork-session right after --resume <id>, and nothing else changes', () => {
    const plain = consoleArgs({ ...base, resume: ORIGINAL })
    const fork = consoleArgs({ ...base, resume: ORIGINAL, fork: true })
    const at = fork.indexOf('--resume')
    expect(fork.slice(at, at + 3)).toEqual(['--resume', ORIGINAL, '--fork-session'])
    expect(fork.filter((a) => a !== '--fork-session')).toEqual(plain)
  })

  it('never carries --fork-session without a session to resume, or when fork is off', () => {
    expect(consoleArgs({ ...base, resume: null, fork: true })).not.toContain('--fork-session')
    expect(consoleArgs({ ...base, resume: ORIGINAL, fork: false })).not.toContain('--fork-session')
    expect(consoleArgs({ ...base, resume: ORIGINAL })).not.toContain('--fork-session')
  })
})

describe('the title of a fork', () => {
  it('is Fork of the session’s name, on one line, capped, with secrets masked', () => {
    expect(forkTitle('auth-tests')).toBe('Fork of auth-tests')
    expect(forkTitle('  two\n lines  ')).toBe('Fork of two lines')
    expect(forkTitle('')).toBe('Fork of a session')
    expect(forkTitle('x'.repeat(200)).length).toBeLessThanOrEqual(60 + 1)
    expect(forkTitle('key sk-ant-api03-FAKEFAKEFAKEFAKEFAKE')).not.toContain('FAKEFAKE')
  })
})

describe('a forked conversation', () => {
  it('starts with --resume <id> --fork-session, is titled and marked as a fork, and the prompt is the user’s own message', async () => {
    const h = make()
    const r = await h.start(req({ resume: ORIGINAL, fork: true, forkOf: 'auth-tests' }))
    expect(r.ok).toBe(true)
    await idle()
    const argv = argvOf()
    expect(argv.slice(argv.indexOf('--resume'), argv.indexOf('--resume') + 3)).toEqual(['--resume', ORIGINAL, '--fork-session'])
    expect(argv).not.toContain('try the other approach')
    expect(h.list()[0]).toMatchObject({ title: 'Fork of auth-tests', fork: { sessionId: ORIGINAL, name: 'auth-tests' } })
  })

  it('records the NEW session id the copy reports, so a later Resume continues the fork and not the original', async () => {
    const h = make()
    await h.start(req({ resume: ORIGINAL, fork: true, forkOf: 'auth-tests' }))
    await idle()
    const summary = h.list()[0]!
    expect(summary.sessionId).toBe(FORKED)
    expect(summary.sessionId).not.toBe(ORIGINAL)
    expect(summary.fork?.sessionId).toBe(ORIGINAL)
    const states = events.filter((e) => e.kind === 'state')
    expect(states.at(-1)).toMatchObject({ sessionId: FORKED })
    expect(h.history(summary.id).filter((e) => e.kind === 'state').at(-1)).toMatchObject({ sessionId: FORKED })
  })

  it('a plain resume keeps the session’s own id and is not a fork', async () => {
    const h = make()
    await h.start(req({ resume: ORIGINAL }))
    await idle()
    expect(argvOf()).not.toContain('--fork-session')
    expect(h.list()[0]).toMatchObject({ title: 'try the other approach', fork: null, sessionId: ORIGINAL })
  })

  it('ignores a fork request with nothing to copy, rather than inventing a session', async () => {
    const h = make()
    await h.start(req({ fork: true, forkOf: 'auth-tests' }))
    await idle()
    expect(argvOf()).not.toContain('--fork-session')
    expect(h.list()[0]).toMatchObject({ fork: null })
  })

  it('caps the name of the copied session', async () => {
    const h = make()
    await h.start(req({ resume: ORIGINAL, fork: true, forkOf: 'n'.repeat(400) }))
    await idle()
    expect(h.list()[0]!.fork!.name.length).toBeLessThanOrEqual(FORK_NAME_MAX + 1)
  })
})
