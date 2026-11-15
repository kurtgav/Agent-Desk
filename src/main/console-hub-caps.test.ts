import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NO_OPTIONS, TOOL_RULES_MAX, type ConsoleEvent, type ConsoleOptions, type ConsoleStart } from '@shared/console'
import { ConsoleHub } from './console-hub'
import { consoleArgs, isShim } from './console-proc'

// Capabilities, live allow, the Advanced options and slash commands, against the real process manager and test/fixtures/fake-claude.mjs.
const FAKE = resolve('test/fixtures/fake-claude.mjs')

let dir: string
let log: string
let events: ConsoleEvent[]
let hub: ConsoleHub | null = null

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentdeck-console-caps-'))
  log = join(dir, 'fake.log')
  events = []
})
afterEach(async () => {
  hub?.dispose()
  hub = null
  await new Promise((r) => setTimeout(r, 150))
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

function make(extraEnv: Record<string, string> = {}): ConsoleHub {
  hub = new ConsoleHub({ command: async () => ({ file: process.execPath, args: [FAKE] }), env: () => ({ ...process.env, FAKE_CLAUDE_LOG: log, ...extraEnv }), emit: (e) => events.push(e), now: Date.now }, { flushMs: 5, controlMs: 800 })
  return hub
}
const req = (prompt: string, options: Partial<ConsoleOptions> = {}, over: Partial<ConsoleStart> = {}): ConsoleStart => ({
  cwd: process.cwd(), prompt, model: null, effort: 'low', permissionMode: 'default', resume: null, options: { ...NO_OPTIONS, ...options }, ...over
})
async function until(what: string, ok: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}. Events: ${events.map((e) => e.kind).join(', ')}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}
const idle = (n = 1) => until(`${n} idle`, () => events.filter((e) => e.kind === 'state' && e.state === 'idle').length >= n)
const started = async (prompt: string, options: Partial<ConsoleOptions> = {}, over: Partial<ConsoleStart> = {}): Promise<string> => {
  const r = await make().start(req(prompt, options, over))
  if (!r.ok) throw new Error(r.error)
  return r.id
}
const argvOf = (): string[] => JSON.parse(readFileSync(log, 'utf8').split('\n').find((l) => l.startsWith('ARGV '))!.slice(5)) as string[]
const lastCaps = () => events.filter((e) => e.kind === 'capabilities').at(-1)

describe('what the conversation can use', () => {
  it('shows it from the init, then again with descriptions, and keeps one entry in the history', async () => {
    const id = await started('hello')
    await idle()
    const caps = events.filter((e) => e.kind === 'capabilities')
    expect(caps).toHaveLength(2)
    expect(lastCaps()).toMatchObject({ capabilities: { claudeVersion: '9.9.9', terminalOnly: ['doctor', 'color'] } })
    const c = lastCaps()?.kind === 'capabilities' ? lastCaps() : null
    expect(c && 'capabilities' in c && c.capabilities.mcpServers).toEqual([
      { name: 'fake_server', status: 'connected', tools: 2 }, { name: 'claude.ai Gmail', status: 'connected', tools: 1 }, { name: 'broken', status: 'failed', tools: 0 },
      { name: 'slack', status: 'needs-auth', tools: 0 }, { name: 'later', status: 'pending', tools: 0 }
    ])
    expect(c && 'capabilities' in c && c.capabilities.commands.find((x) => x.name === 'aside')).toMatchObject({ kind: 'skill', description: expect.stringContaining('side question'), hint: '<question>' })
    expect(hub!.history(id).filter((e) => e.kind === 'capabilities')).toHaveLength(1)
  })

  it('keeps the model that was asked for apart from the one in use', async () => {
    await started('hello', {}, { model: 'sonnet' })
    await idle()
    expect(argvOf().slice(argvOf().indexOf('--model'), argvOf().indexOf('--model') + 2)).toEqual(['--model', 'sonnet'])
    expect(hub!.list()[0]?.model).toBe('sonnet')
    expect(lastCaps()).toMatchObject({ capabilities: { model: 'claude-fake-sonnet' } })
  })

  it('takes a custom model id, including the long-context suffix, as one argument', async () => {
    await started('hello', {}, { model: 'claude-opus-4-5[1m]' })
    await idle()
    expect(argvOf()).toEqual(expect.arrayContaining(['--model', 'claude-opus-4-5[1m]']))
  })
})

describe('slash commands and skills', () => {
  it('sends /name args as the user’s message, unchanged', async () => {
    await started('/aside what is 2+2')
    await idle()
    const sent = readFileSync(log, 'utf8').split('\n').find((l) => l.startsWith('IN '))!
    expect(JSON.parse(sent.slice(3))).toEqual({ type: 'user', message: { role: 'user', content: '/aside what is 2+2' } })
    expect(events.find((e) => e.kind === 'assistant-text' && e.final)).toMatchObject({ text: 'Skill ran: /aside what is 2+2' })
  })

  it('runs a local command like /context for free, as a normal message', async () => {
    await started('/context')
    await idle()
    expect(events.find((e) => e.kind === 'assistant-text' && e.final)).toMatchObject({ text: expect.stringContaining('Context Usage') })
    expect(events.find((e) => e.kind === 'turn-end')).toMatchObject({ costUsd: 0, totalCostUsd: 0 })
  })

  it('follows /clear: a notice, and the new session id for resume', async () => {
    const id = await started('hello')
    await idle()
    expect(hub!.list()[0]?.sessionId).toBe('11111111-2222-4333-8444-555555555555')
    hub!.send(id, '/clear')
    await idle(2)
    expect(events.find((e) => e.kind === 'notice')).toMatchObject({ text: expect.stringContaining('Conversation cleared') })
    expect(hub!.list()[0]?.sessionId).toBe('99999999-8888-4777-8666-555555555555')
  })
})

describe('tools that run without asking', () => {
  it('starts with --allowedTools, and the MCP tool runs', async () => {
    await started('call the mcp tool', { allowedTools: ['mcp__fake_server__ping', 'Bash(git status:*)'] })
    await idle()
    expect(argvOf()).toEqual(expect.arrayContaining(['--allowedTools', 'mcp__fake_server__ping,Bash(git status:*)']))
    expect(events.find((e) => e.kind === 'allowed')).toMatchObject({ tools: ['mcp__fake_server__ping', 'Bash(git status:*)'] })
    expect(events.find((e) => e.kind === 'tool-result')).toMatchObject({ ok: true, text: 'pong' })
    expect(events.some((e) => e.kind === 'permission-denied')).toBe(false)
  })

  it('names the concrete fix for a denied MCP tool, and allows it live, with no restart', async () => {
    const id = await started('call the mcp tool')
    await idle()
    expect(events.find((e) => e.kind === 'tool-use')).toMatchObject({ summary: 'fake server · ping' })
    const denied = events.find((e) => e.kind === 'permission-denied')
    expect(denied).toMatchObject({ summary: 'fake server · ping', rule: 'mcp__fake_server__ping' })
    const pid = readFileSync(log, 'utf8').split('\n').find((l) => l.startsWith('PID '))
    const r = await hub!.allow(id, 'mcp__fake_server__ping')
    expect(r).toEqual({ ok: true, allowed: ['mcp__fake_server__ping'] })
    expect(events.filter((e) => e.kind === 'allowed').at(-1)).toMatchObject({ tools: ['mcp__fake_server__ping'] })
    expect(hub!.list()[0]?.options.allowedTools).toEqual(['mcp__fake_server__ping'])
    const before = events.length
    hub!.send(id, 'call the mcp tool again')
    await idle(2)
    expect(events.slice(before).find((e) => e.kind === 'tool-result')).toMatchObject({ ok: true, text: 'pong' })
    // The same process answered: nothing restarted.
    expect(readFileSync(log, 'utf8').split('\n').filter((l) => l.startsWith('PID '))).toEqual([pid])
    const sent = readFileSync(log, 'utf8').split('\n').find((l) => l.includes('apply_flag_settings'))!
    expect(JSON.parse(sent.slice(3))).toMatchObject({ type: 'control_request', request: { subtype: 'apply_flag_settings', settings: { permissions: { allow: ['mcp__fake_server__ping'] } } } })
  })

  it('allows a denied Bash command exactly, and sends the whole list each time', async () => {
    const id = await started('denied please')
    await idle()
    expect(events.find((e) => e.kind === 'permission-denied')).toMatchObject({ rule: 'Bash(npm test)' })
    await hub!.allow(id, 'Bash(npm test)')
    expect(await hub!.allow(id, 'mcp__fake_server__echo')).toEqual({ ok: true, allowed: ['Bash(npm test)', 'mcp__fake_server__echo'] })
    expect(await hub!.allow(id, 'Bash(npm test)')).toMatchObject({ ok: true, allowed: ['Bash(npm test)', 'mcp__fake_server__echo'] })
    const before = events.length
    hub!.send(id, 'denied please')
    await idle(2)
    expect(events.slice(before).find((e) => e.kind === 'tool-result')).toMatchObject({ ok: true, text: 'PASS 2 tests' })
  })

  it('says so, and asks for a restart, when this Claude Code can not take a rule while running', async () => {
    make({ FAKE_CLAUDE_NO_LIVE_ALLOW: '1' })
    const r = await hub!.start(req('call the mcp tool'))
    if (!r.ok) throw new Error(r.error)
    await idle()
    expect(await hub!.allow(r.id, 'mcp__fake_server__ping')).toEqual({ ok: false, error: expect.stringContaining('did not take the new rule'), restart: true })
    expect(events.some((e) => e.kind === 'allowed')).toBe(false)
    expect(hub!.list()[0]?.options.allowedTools).toEqual([])
  })

  it('refuses too many rules, and a conversation that is over or unknown', async () => {
    const id = await started('hello', { allowedTools: Array.from({ length: TOOL_RULES_MAX }, (_, i) => `mcp__s__t${i}`) })
    await idle()
    expect(await hub!.allow(id, 'mcp__s__extra')).toMatchObject({ ok: false, error: expect.stringContaining('At most 20'), restart: false })
    hub!.stop(id)
    await until('ended', () => events.some((e) => e.kind === 'state' && e.state === 'ended'))
    expect(await hub!.allow(id, 'Read')).toMatchObject({ ok: false, restart: true })
    expect(await hub!.allow('c_00000000', 'Read')).toMatchObject({ ok: false, restart: false })
  })
})

describe('the Advanced options', () => {
  it('become arguments, and the prompt stays off the command line', async () => {
    await started('Please do the secret thing', {
      disallowedTools: ['WebFetch', 'Bash(rm *)'], addDirs: ['C:\\one', 'C:\\two'], fallbackModel: 'sonnet,haiku', maxBudgetUsd: 1.5, appendSystemPrompt: 'Answer in French.\nBe brief.'
    }, { resume: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' })
    await idle()
    const argv = argvOf()
    expect(argv).toEqual(expect.arrayContaining(['--disallowedTools', 'WebFetch,Bash(rm *)', '--add-dir', 'C:\\one', 'C:\\two', '--fallback-model', 'sonnet,haiku', '--max-budget-usd', '1.5', '--append-system-prompt', 'Answer in French.\nBe brief.']))
    expect(argv.join(' ')).not.toContain('secret thing')
    expect(argv.join(' ')).not.toMatch(/dangerously|bypass/i)
  })

  it('puts nothing on the command line when nothing is set', () => {
    const args = consoleArgs({ model: null, effort: 'low', permissionMode: 'default', resume: null, options: NO_OPTIONS })
    for (const flag of ['--allowedTools', '--disallowedTools', '--add-dir', '--fallback-model', '--max-budget-usd', '--append-system-prompt']) expect(args).not.toContain(flag)
  })

  it('turns line breaks in the appended instructions into spaces behind an npm shim (cmd.exe ends a command at a line break)', () => {
    const options = { ...NO_OPTIONS, appendSystemPrompt: 'Line one.\r\n\r\n  Line two.\nLine three.' }
    const base = { model: null, effort: 'low' as const, permissionMode: 'default' as const, resume: null, options }
    expect(consoleArgs(base, true).at(-1)).toBe('Line one. Line two. Line three.')
    expect(consoleArgs(base, false).at(-1)).toBe('Line one.\r\n\r\n  Line two.\nLine three.')
    expect(isShim('C:\\npm\\claude.cmd')).toBe(true)
    expect(isShim('C:\\Users\\x\\.local\\bin\\claude.exe')).toBe(false)
  })
})
