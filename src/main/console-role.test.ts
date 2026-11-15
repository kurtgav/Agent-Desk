import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/bridge'
import { NO_OPTIONS, type ConsoleEvent, type ConsoleStart, type ConsoleSummary } from '@shared/console'

// The real home folder and the real electron are never touched; Claude Code is the fake one (test/fixtures/fake-claude.mjs).
const home = vi.hoisted(() => ({ dir: '' }))
vi.mock('node:os', async (orig) => ({ ...(await orig<typeof import('node:os')>()), homedir: () => home.dir }))
vi.mock('electron', () => ({ dialog: { showOpenDialog: vi.fn() } }))

import { registerConsole } from './console'
import type { Dispose, MainCtx } from './ctx'
import { registerRoles } from './roles'

const FAKE = resolve('test/fixtures/fake-claude.mjs')
const HERE = process.cwd()
const SESSION = '11111111-2222-4333-8444-555555555555'

let base: string
let log: string
let tmp: string
const handlers = new Map<string, (e: IpcMainInvokeEvent, ...a: unknown[]) => unknown>()
const sent: ConsoleEvent[] = []
const disposers: Dispose[] = []

const persona = (name: string, body = `You are ${name}.`): string => `---\nname: ${name}\ndescription: ${name} does things.\nemoji: 🤖\nvibe: ${name} vibe\n---\n\n# ${name}\n\n${body}\n`
const put = (rel: string, text: string): void => {
  mkdirSync(join(base, rel, '..'), { recursive: true })
  writeFileSync(join(base, rel), text)
}
const call = async <T,>(channel: string, ...args: unknown[]): Promise<T> => (await handlers.get(channel)!({} as IpcMainInvokeEvent, ...args)) as T

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'agentdeck-console-role-'))
  home.dir = join(base, 'home')
  log = join(base, 'claude.log')
  tmp = join(base, 'userData', 'tmp')
  vi.stubEnv('CLAUDE_CONFIG_DIR', join(base, 'claude'))
  vi.stubEnv('FAKE_CLAUDE_LOG', log)
  vi.stubEnv('FAKE_CLAUDE_INSTALLED', 'Frontend Developer,Backend Architect')
  // A clone with three roles; two of them are installed in Claude Code as well.
  put('claude/repos/agency-agents/engineering/engineering-frontend-developer.md', persona('Frontend Developer'))
  put('claude/repos/agency-agents/engineering/engineering-backend-architect.md', persona('Backend Architect'))
  put('claude/repos/agency-agents/testing/testing-qa-engineer.md', persona('QA Engineer', 'Find the bug before the user does.'))
  put('claude/agents/engineering-frontend-developer.md', persona('Frontend Developer'))
  put('claude/agents/engineering-backend-architect.md', persona('Backend Architect'))
  put('config.json', '{}')
  handlers.clear()
  sent.length = 0
  const win = { isDestroyed: () => false, once: () => undefined, webContents: { send: (_c: string, e: ConsoleEvent) => void sent.push(e) } }
  const ctx = {
    handle: (channel: string, fn: (e: IpcMainInvokeEvent, ...a: unknown[]) => unknown) => void handlers.set(channel, fn),
    collector: () => null,
    demo: () => false,
    configFile: () => join(base, 'config.json'),
    userData: () => join(base, 'userData'),
    window: () => win
  } as unknown as MainCtx
  disposers.push(registerRoles(ctx), registerConsole(ctx, { command: async () => ({ file: process.execPath, args: [FAKE] }), knownFolders: () => [HERE] }))
})
afterEach(async () => {
  for (const d of disposers.splice(0)) d()
  await new Promise((r) => setTimeout(r, 100))
  vi.unstubAllEnvs()
  rmSync(base, { recursive: true, force: true })
})

const good: ConsoleStart = { cwd: HERE, prompt: 'plan the launch', model: null, effort: 'low', permissionMode: 'default', resume: null, options: NO_OPTIONS }
type Started = { ok: true; id: string } | { ok: false; error: string; untrusted: boolean }
const start = (over: Record<string, unknown> = {}): Promise<Started> => call<Started>(IPC.consoleStart, { ...good, ...over })
const idle = (id: string): Promise<void> =>
  vi.waitFor(async () => expect((await call<ConsoleSummary[]>(IPC.consoleList)).find((c) => c.id === id)?.state).toBe('idle'), { timeout: 10_000 })
const logLines = (): string[] => readFileSync(log, 'utf8').split('\n').filter(Boolean)
const argv = (n = 0): string[] => JSON.parse(logLines().filter((l) => l.startsWith('ARGV '))[n]!.slice(5)) as string[]
/** The text of every user message Claude Code was sent, in order. */
const userTexts = (): string[] =>
  logLines()
    .filter((l) => l.startsWith('IN '))
    .flatMap((l) => {
      const m = JSON.parse(l.slice(3)) as { type?: string; message?: { content?: string | { type: string; text?: string }[] } }
      if (m.type !== 'user') return []
      const c = m.message?.content
      return [typeof c === 'string' ? c : (c ?? []).map((p) => p.text ?? '').join('')]
    })
const shownUsers = async (id: string): Promise<string[]> => (await call<ConsoleEvent[]>(IPC.consoleHistory, id)).flatMap((e) => (e.kind === 'user' ? [e.text] : []))
const config = (): { sessionMeta?: Record<string, { role?: string }> } => JSON.parse(readFileSync(join(base, 'config.json'), 'utf8')) as never
const tmpFiles = (): string[] => (existsSync(tmp) ? readdirSync(tmp) : [])

describe('a conversation started as a role', () => {
  it('uses --agent <installed name> for a role Claude Code has, writes no file, and notes the role under the session', async () => {
    const r = await start({ role: 'frontend-developer' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    await idle(r.id)
    const args = argv()
    expect(args.slice(args.indexOf('--agent'), args.indexOf('--agent') + 2)).toEqual(['--agent', 'Frontend Developer'])
    expect(args).not.toContain('--agents')
    expect(logLines()).toContain('AGENT_FOUND true')
    expect(tmpFiles()).toEqual([])
    expect((await call<ConsoleSummary[]>(IPC.consoleList))[0]).toMatchObject({ role: { id: 'frontend-developer', name: 'Frontend Developer' }, helpers: [] })
    expect(config().sessionMeta?.[SESSION]?.role).toBe('frontend-developer')
  })

  it('hands a role Claude Code does not have over as a definitions file that Claude has read, and then deletes it', async () => {
    const r = await start({ role: 'cto' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    await idle(r.id)
    const args = argv()
    const file = args[args.indexOf('--agents') + 1]!
    expect(args.slice(args.indexOf('--agent'), args.indexOf('--agent') + 2)).toEqual(['--agent', 'cto'])
    expect(file.startsWith(tmp)).toBe(true)
    // Claude Code found the file when it started, defined the role and ran as it.
    expect(logLines()).toContain('AGENTS_FILE true')
    expect(logLines()).toContain('AGENT_FOUND true')
    expect(JSON.parse(logLines().find((l) => l.startsWith('AGENTS '))!.slice(7))).toMatchObject({ cto: { prompt: expect.stringContaining('CTO') } })
    // Once it was up, AgentDeck had no reason to keep it.
    await vi.waitFor(() => expect(tmpFiles()).toEqual([]))
    // The thread shows what the user typed, nothing about the role text.
    expect(await shownUsers(r.id)).toEqual(['plan the launch'])
    expect(userTexts()).toEqual(['plan the launch'])
  })

  it('tells the lead who it can consult, but shows the user only their own words', async () => {
    const r = await start({ role: 'cto', helpers: ['qa-engineer', 'frontend-developer'] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    await idle(r.id)
    const defs = JSON.parse(logLines().find((l) => l.startsWith('AGENTS '))!.slice(7)) as Record<string, { prompt: string }>
    // The installed helper needs no definition; the one Claude Code does not have is defined under its own name.
    expect(Object.keys(defs).sort()).toEqual(['QA Engineer', 'cto'])
    expect(userTexts()).toEqual(['plan the launch\n\nAvailable to consult: QA Engineer, Frontend Developer. Use them when their expertise applies.'])
    expect(await shownUsers(r.id)).toEqual(['plan the launch'])
    expect((await call<ConsoleSummary[]>(IPC.consoleList))[0]!.helpers!.map((h) => h.id)).toEqual(['qa-engineer', 'frontend-developer'])
  })

  it('says so in the thread when Claude Code does not list the lead after all', async () => {
    vi.stubEnv('FAKE_CLAUDE_INSTALLED', '')
    // Installed on disk, yet this Claude Code does not list it (an older or different build).
    const r = await start({ role: 'frontend-developer' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    await idle(r.id)
    expect(sent.some((e) => e.kind === 'notice' && e.level === 'warn' && /Frontend Developer/.test(e.text))).toBe(true)
  })

  it('leaves no file behind when the conversation is stopped', async () => {
    const r = await start({ role: 'cto', prompt: 'slow please' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    await call(IPC.consoleStop, r.id)
    await vi.waitFor(() => expect(tmpFiles()).toEqual([]))
  })
})

describe('what a start refuses, in words', () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ['a role the catalog does not have', { role: 'ghost' }, 'Reload the roles'],
    ['a helper the catalog does not have', { role: 'cto', helpers: ['ghost'] }, 'Reload the roles'],
    ['helpers without a lead', { helpers: ['qa-engineer'] }, 'Pick a lead role first'],
    ['more than four helpers', { role: 'cto', helpers: ['a1', 'a2', 'a3', 'a4', 'a5'] }, 'up to 4 helper roles'],
    ['a role with a resume', { role: 'cto', resume: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }, 'keeps the role it began with'],
    ['a role with a fork', { role: 'cto', resume: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', fork: true, forkOf: 'x' }, 'keeps the role it began with']
  ]
  for (const [name, over, words] of cases) {
    it(`refuses ${name}`, async () => {
      expect(await start(over)).toMatchObject({ ok: false, error: expect.stringContaining(words), untrusted: false })
      expect(await call(IPC.consoleList)).toEqual([])
      expect(existsSync(log)).toBe(false) // Claude Code was never started
      expect(tmpFiles()).toEqual([])
    })
  }

  it('refuses anything that is not a catalog id: a name, a path, an option', async () => {
    for (const role of ['CTO', '../cto', 'C:\\agents\\cto.md', '--dangerously-skip-permissions', 'cto cto', '', 'x'.repeat(200), 7, ['cto']]) {
      expect(await start({ role }), JSON.stringify(role)).toMatchObject({ ok: false, untrusted: false })
    }
    expect(await start({ role: 'cto', helpers: ['../x'] })).toMatchObject({ ok: false })
    expect(await start({ role: 'cto', helpers: 'qa-engineer' })).toMatchObject({ ok: false })
    expect(await call(IPC.consoleList)).toEqual([])
  })

  it('treats an empty role as no role', async () => {
    const r = await start({ role: null, helpers: [] })
    expect(r.ok).toBe(true)
    if (r.ok) await idle(r.id)
    expect(argv()).not.toContain('--agent')
  })
})

describe('naming roles in a later message', () => {
  const begin = async (over: Record<string, unknown> = {}): Promise<string> => {
    const r = await start({ role: 'cto', helpers: ['qa-engineer'], ...over })
    if (!r.ok) throw new Error(r.error)
    await idle(r.id)
    return r.id
  }
  const send = (id: string, text: string, mentions?: unknown) => call<{ ok: boolean; error?: string }>(IPC.consoleSend, id, text, mentions)
  const last = (): string => userTexts().at(-1)!

  it('asks for a helper that was declared at start by the name it was declared under, and shows the original words', async () => {
    const id = await begin()
    expect(await send(id, 'check the signup form', ['qa-engineer'])).toEqual({ ok: true })
    await idle(id)
    expect(last()).toBe('Use the QA Engineer subagent for this: check the signup form')
    expect((await shownUsers(id)).at(-1)).toBe('check the signup form')
  })

  it('asks for an installed role by its installed name even when it was not declared', async () => {
    const id = await begin()
    expect(await send(id, 'review the API', ['backend-architect'])).toEqual({ ok: true })
    await idle(id)
    expect(last()).toBe('Use the Backend Architect subagent for this: review the API')
  })

  it('describes a role Claude Code does not have in the message itself, and keeps it out of the thread', async () => {
    const id = await begin({ helpers: [] })
    expect(await send(id, 'find the bug', ['qa-engineer'])).toEqual({ ok: true })
    await idle(id)
    expect(last()).toBe('Use a general-purpose subagent for this, briefed as the QA Engineer with the role text below: find the bug\n\nRole of the QA Engineer:\n# QA Engineer\n\nFind the bug before the user does.')
    expect((await shownUsers(id)).at(-1)).toBe('find the bug')
  })

  it('leaves the message alone when it names no one, names the lead, or names no role', async () => {
    const id = await begin()
    for (const mentions of [undefined, [], ['cto']]) {
      expect(await send(id, 'just a note', mentions)).toEqual({ ok: true })
      await idle(id)
      expect(last()).toBe('just a note')
    }
  })

  it('refuses a role that is not in the catalog, and anything that is not an id, without sending anything', async () => {
    const id = await begin()
    const before = userTexts().length
    expect(await send(id, 'hi', ['ghost'])).toMatchObject({ ok: false, error: expect.stringContaining('“ghost”') })
    for (const bad of [['../x'], 'qa-engineer', [7], ['a1', 'a2', 'a3', 'a4', 'a5']]) expect(await send(id, 'hi', bad), JSON.stringify(bad)).toMatchObject({ ok: false })
    expect(userTexts()).toHaveLength(before)
  })

  it('refuses a role whose text is too long to bring into a running conversation', async () => {
    put('userData/roles/essay.md', persona('Essay Writer', 'word '.repeat(6_000)))
    await call(IPC.rolesReload)
    const id = await begin({ helpers: [] })
    const before = userTexts().length
    expect(await send(id, 'write', ['essay'])).toMatchObject({ ok: false, error: expect.stringContaining('too long') })
    expect(userTexts()).toHaveLength(before)
  })

  it('works in a conversation that has no role too: the named role is described in the message', async () => {
    const r = await start()
    if (!r.ok) throw new Error(r.error)
    await idle(r.id)
    expect(await send(r.id, 'plain', ['qa-engineer'])).toEqual({ ok: true })
    await idle(r.id)
    expect(last()).toContain('Use a general-purpose subagent for this, briefed as the QA Engineer with the role text below: plain')
    expect((await shownUsers(r.id)).at(-1)).toBe('plain')
  })
})
