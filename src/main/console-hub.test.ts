import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CONSOLE_MAX_LIVE, NO_OPTIONS, type ConsoleEvent, type ConsoleStart } from '@shared/console'
import { NO_CLI } from './actions'
import { ConsoleHub, explainExit, titleOf, type HubTuning } from './console-hub'
import { PROBLEM_TEXT } from './console-text'
import { consoleArgs } from './console-proc'
import { History } from './console-store'

// The real process manager against test/fixtures/fake-claude.mjs: real pipes, real exits, a scripted `claude -p`.
const FAKE = resolve('test/fixtures/fake-claude.mjs')

let dir: string
let log: string
let events: ConsoleEvent[]
let hub: ConsoleHub | null = null

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentdeck-console-'))
  log = join(dir, 'fake.log')
  events = []
})
afterEach(async () => {
  hub?.dispose()
  hub = null
  await new Promise((r) => setTimeout(r, 150)) // let killed children release the temp folder
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

function make(tuning: Partial<HubTuning> = {}, command: () => Promise<{ file: string; args: string[] } | null> = async () => ({ file: process.execPath, args: [FAKE] })): ConsoleHub {
  hub = new ConsoleHub({ command, env: () => ({ ...process.env, FAKE_CLAUDE_LOG: log }), emit: (e) => events.push(e), now: Date.now }, { flushMs: 5, ...tuning })
  return hub
}

const req = (prompt: string, over: Partial<ConsoleStart> = {}): ConsoleStart => ({
  cwd: process.cwd(), prompt, model: null, effort: 'low', permissionMode: 'default', resume: null, options: NO_OPTIONS, ...over
})

async function until(what: string, ok: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}. Events: ${events.map((e) => e.kind).join(', ')}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}
const kinds = (): string[] => events.map((e) => e.kind)
const states = (): string[] => events.filter((e) => e.kind === 'state').map((e) => (e.kind === 'state' ? e.state : ''))
const idle = (n = 1) => until(`${n} idle`, () => states().filter((s) => s === 'idle').length >= n)
const started = async (prompt: string, over: Partial<ConsoleStart> = {}): Promise<string> => {
  const r = await make().start(req(prompt, over))
  if (!r.ok) throw new Error(r.error)
  return r.id
}

describe('a conversation', () => {
  it('streams a reply, ends the turn and waits for the next message', async () => {
    const id = await started('Say hello')
    await idle()
    expect(kinds()[0]).toBe('user')
    const text = events.filter((e) => e.kind === 'assistant-text')
    expect(text.at(-1)).toMatchObject({ final: true, text: 'Fake reply to: Say hello' })
    expect(events.find((e) => e.kind === 'turn-end')).toMatchObject({ costUsd: 0.0123, totalCostUsd: 0.0123, inputTokens: 1102, outputTokens: 12, interrupted: false, error: null })
    expect(hub!.list()).toEqual([expect.objectContaining({ id, title: 'Say hello', state: 'idle', turns: 1, costUsd: 0.0123, sessionId: '11111111-2222-4333-8444-555555555555', model: null, problem: null })])
    // Ids and numbers are the hub's: strictly increasing, one id per event.
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1))
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length)
  })

  it('puts the prompt on stdin as JSON and never on the command line', async () => {
    await started('Please refactor "my file" & more')
    await idle()
    const lines = readFileSync(log, 'utf8').split('\n')
    const argv = lines.find((l) => l.startsWith('ARGV '))!
    expect(argv).not.toContain('refactor')
    expect(JSON.parse(argv.slice(5))).toEqual(consoleArgs({ model: null, effort: 'low', permissionMode: 'default', resume: null, options: NO_OPTIONS }))
    expect(JSON.parse(lines.find((l) => l.startsWith('IN '))!.slice(3))).toEqual({ type: 'user', message: { role: 'user', content: 'Please refactor "my file" & more' } })
  })

  it('takes a follow-up and keeps the running cost', async () => {
    const id = await started('first')
    await idle()
    expect(hub!.send(id, 'second')).toEqual({ ok: true })
    await idle(2)
    const ends = events.filter((e) => e.kind === 'turn-end')
    expect(ends.map((e) => (e.kind === 'turn-end' ? [e.costUsd, e.totalCostUsd] : null))).toEqual([[0.0123, 0.0123], [0.0123, 0.0246]])
    expect(hub!.list()[0]).toMatchObject({ turns: 2, costUsd: 0.0246 })
  })

  it('shows a tool call and its result between the words', async () => {
    await started('use a tool please')
    await idle()
    const seen = kinds().filter((k) => ['user', 'tool-use', 'tool-result', 'assistant-text', 'turn-end'].includes(k))
    expect([...new Set(seen)]).toEqual(['user', 'tool-use', 'tool-result', 'assistant-text', 'turn-end'])
    expect(events.find((e) => e.kind === 'tool-use')).toMatchObject({ name: 'Glob', summary: 'Find files: scripts/**/*' })
    expect(events.find((e) => e.kind === 'tool-result')).toMatchObject({ ok: true })
  })

  it('tells the user a tool was not allowed to run', async () => {
    await started('denied please')
    await idle()
    expect(events.find((e) => e.kind === 'permission-denied')).toMatchObject({ name: 'Bash', summary: 'Run: npm test' })
    expect(events.find((e) => e.kind === 'tool-result')).toMatchObject({ ok: false })
  })

  it('masks secrets in what it says, in the events and in the history a later page reads', async () => {
    const id = await started('a secret please')
    await idle()
    const everything = JSON.stringify([events, hub!.history(id)])
    expect(everything).not.toMatch(/FAKEFAKE|hunter2/)
    expect(everything).toContain('•••')
  })

  it('keeps one entry per message in the history, with the final text', async () => {
    const id = await started('Say hello')
    await idle()
    const h = hub!.history(id)
    expect(h.filter((e) => e.kind === 'assistant-text')).toHaveLength(1)
    expect(h.filter((e) => e.kind === 'assistant-text')[0]).toMatchObject({ final: true, text: 'Fake reply to: Say hello' })
    expect(h.length).toBeLessThan(events.length)
  })

  it('continues a session with --resume and does not know the first turn’s own cost', async () => {
    await started('carry on', { resume: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' })
    await idle()
    const argv = JSON.parse(readFileSync(log, 'utf8').split('\n').find((l) => l.startsWith('ARGV '))!.slice(5)) as string[]
    expect(argv.slice(argv.indexOf('--resume'), argv.indexOf('--resume') + 2)).toEqual(['--resume', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'])
    expect(events.find((e) => e.kind === 'turn-end')).toMatchObject({ costUsd: null, totalCostUsd: 0.0123 })
    expect(hub!.list()[0]?.sessionId).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
  })
})

describe('stopping', () => {
  it('interrupts a running turn and keeps the conversation for the next message', async () => {
    const id = await started('go slow')
    await until('some text', () => events.some((e) => e.kind === 'assistant-text'))
    expect(hub!.stop(id)).toEqual({ ok: true })
    await idle()
    expect(events.find((e) => e.kind === 'turn-end')).toMatchObject({ interrupted: true })
    expect(hub!.list()[0]?.state).toBe('idle')
    expect(hub!.send(id, 'and now?')).toEqual({ ok: true })
    await idle(2)
    expect(events.filter((e) => e.kind === 'turn-end')).toHaveLength(2)
  })

  it('ends an idle conversation: the process exits, the session stays resumable', async () => {
    const id = await started('quick')
    await idle()
    hub!.stop(id)
    await until('ended', () => states().includes('ended'))
    expect(hub!.list()[0]).toMatchObject({ state: 'ended', error: null, sessionId: '11111111-2222-4333-8444-555555555555' })
    expect(hub!.send(id, 'more')).toMatchObject({ ok: false, error: expect.stringContaining('ended') })
    expect(hub!.stop(id)).toEqual({ ok: true })
  })

  it('closes a process that ignores the interrupt, and says so', async () => {
    make({ stopGraceMs: 150 })
    const r = await hub!.start(req('hang forever'))
    if (!r.ok) throw new Error(r.error)
    await until('some text', () => events.some((e) => e.kind === 'assistant-text'))
    hub!.stop(r.id)
    await until('ended', () => states().includes('ended'))
    expect(hub!.list()[0]).toMatchObject({ state: 'ended', error: expect.stringContaining('did not answer the interrupt') })
  })

  it('ends a conversation nobody writes to for a while', async () => {
    make({ idleMs: 120 })
    const r = await hub!.start(req('quick'))
    if (!r.ok) throw new Error(r.error)
    await until('ended', () => states().includes('ended'))
    expect(hub!.list()[0]?.error).toContain('without a message')
  })

  it('kills every child on dispose', async () => {
    const h = make()
    await h.start(req('go slow'))
    await h.start(req('go slow'))
    await until('text from both', () => events.filter((e) => e.kind === 'assistant-text').length >= 2)
    h.dispose()
    await until('both closed', () => states().filter((s) => s === 'ended').length === 2)
  })
})

describe('when it goes wrong', () => {
  it('maps a crash to a failed state with the reason in words', async () => {
    await started('please crash')
    await until('failed', () => states().includes('failed'))
    const s = hub!.list()[0]!
    expect(s.state).toBe('failed')
    expect(s.error).toContain('stopped unexpectedly (exit code 3)')
    expect(s.error).toContain('boom: the fake crashed')
    expect(s.problem).toBeNull()
  })

  it('names “not signed in” and closes the conversation', async () => {
    await started('signin test')
    await until('failed', () => states().includes('failed'))
    expect(hub!.list()[0]).toMatchObject({ state: 'failed', problem: 'signed-out', error: PROBLEM_TEXT['signed-out'] })
  })

  it('refuses when Claude Code can not be found', async () => {
    const r = await make({}, async () => null).start(req('hi'))
    expect(r).toEqual({ ok: false, error: NO_CLI, untrusted: false })
    expect(hub!.list()).toEqual([])
  })

  it('reports a program that will not start', async () => {
    make({}, async () => ({ file: join(dir, 'missing.exe'), args: [] }))
    await hub!.start(req('hi'))
    await until('failed', () => states().includes('failed'))
    expect(hub!.list()[0]?.error).toMatch(/could not start Claude Code/)
  })

  it('allows six live conversations and refuses the seventh with a reason', async () => {
    const h = make()
    const results = await Promise.all(Array.from({ length: CONSOLE_MAX_LIVE + 1 }, (_, i) => h.start(req(`quick ${i}`))))
    expect(results.filter((r) => r.ok)).toHaveLength(CONSOLE_MAX_LIVE)
    expect(results.find((r) => !r.ok)).toMatchObject({ ok: false, error: expect.stringContaining('already running'), untrusted: false })
  }, 30_000)

  it('refuses a message for a conversation it does not have', () => {
    expect(make().send('c_00000000', 'hi')).toEqual({ ok: false, error: expect.stringContaining('not open') })
    expect(hub!.stop('c_00000000')).toMatchObject({ ok: false })
    expect(hub!.history('c_00000000')).toEqual([])
  })
})

describe('helpers', () => {
  it('titles a conversation by the first line of the prompt, masked and short', () => {
    expect(titleOf('\n  Fix   the login bug\nmore detail')).toBe('Fix the login bug')
    expect(titleOf('use sk-ant-api03-ABCDEFGHIJ to log in')).toBe('use ••• to log in')
    expect(titleOf('x'.repeat(200)).length).toBe(61)
    expect(titleOf('   ')).toBe('Conversation')
  })

  it('explains an exit in plain words', () => {
    expect(explainExit({ code: 1, signal: null, stderr: 'Workspace not trusted. Run claude in C:\\x', spawnFailed: false })).toEqual({ error: PROBLEM_TEXT.untrusted, problem: 'untrusted' })
    expect(explainExit({ code: 2, signal: null, stderr: 'error: unknown option --x\n', spawnFailed: false }).error).toBe('Claude Code stopped unexpectedly (exit code 2). It said: error: unknown option --x')
    expect(explainExit({ code: null, signal: 'SIGKILL', stderr: '', spawnFailed: false }).error).toBe('Claude Code stopped unexpectedly (it was closed).')
    expect(explainExit({ code: null, signal: null, stderr: 'spawn x ENOENT', spawnFailed: true }).error).toBe('AgentDeck could not start Claude Code: spawn x ENOENT')
  })

  it('never builds a command line that can skip permissions or carry the prompt', () => {
    const args = consoleArgs({ model: 'opus', effort: 'max', permissionMode: 'acceptEdits', resume: 'abc-123', options: NO_OPTIONS })
    expect(args).toEqual(expect.arrayContaining(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--effort', 'max', '--permission-mode', 'acceptEdits', '--model', 'opus', '--resume', 'abc-123']))
    expect(args.join(' ')).not.toMatch(/dangerously|bypass/i)
    expect(consoleArgs({ model: null, effort: 'low', permissionMode: 'plan', resume: null, options: NO_OPTIONS })).not.toContain('--model')
  })
})

describe('History', () => {
  const ev = (seq: number, over: Partial<ConsoleEvent> = {}): ConsoleEvent => ({ id: `c:${seq}`, conversation: 'c_00000001', seq, ts: seq, kind: 'user', text: 'hi', ...over }) as ConsoleEvent

  it('keeps the newest events and tells the page some were trimmed', () => {
    const h = new History(5, 1_000_000)
    for (let i = 1; i <= 9; i++) h.push(ev(i))
    const list = h.list()
    expect(list[0]).toMatchObject({ kind: 'notice', seq: 0 })
    expect(list.slice(1).map((e) => e.seq)).toEqual([5, 6, 7, 8, 9])
  })

  it('trims by size too, but never to nothing', () => {
    const h = new History(100, 600)
    for (let i = 1; i <= 4; i++) h.push(ev(i, { text: 'x'.repeat(300) } as Partial<ConsoleEvent>))
    expect(h.list().length).toBeGreaterThan(1)
    expect(h.list().length).toBeLessThan(5)
  })

  it('replaces a message in place as it grows', () => {
    const h = new History()
    h.push(ev(1, { kind: 'assistant-text', messageId: 'm:0', text: 'He', final: false } as Partial<ConsoleEvent>))
    h.push(ev(2))
    h.push(ev(3, { kind: 'assistant-text', messageId: 'm:0', text: 'Hello', final: true } as Partial<ConsoleEvent>))
    expect(h.list().map((e) => [e.kind, e.seq])).toEqual([['assistant-text', 3], ['user', 2]])
  })
})
