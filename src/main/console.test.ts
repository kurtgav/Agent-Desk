import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/bridge'
import { CONSOLE_PROMPT_MAX, NO_OPTIONS, type ConsoleEvent, type ConsoleStart } from '@shared/console'
import { registerConsole, type ConsoleDeps } from './console'
import type { Dispose, MainCtx } from './ctx'
import { NOT_KNOWN, NOT_LOCAL } from './dispatch'

const FAKE = resolve('test/fixtures/fake-claude.mjs')
/** userData and config.json live in a folder of their own: a conversation started as a role writes a definitions file and notes the role. */
const scratch = mkdtempSync(join(tmpdir(), 'agentdeck-console-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
const HERE = process.cwd()

function rig(over: { demo?: boolean; known?: string[]; window?: boolean } = {}) {
  const handlers = new Map<string, (e: IpcMainInvokeEvent, ...a: unknown[]) => unknown>()
  const sent: ConsoleEvent[] = []
  const closed: (() => void)[] = []
  const win = {
    isDestroyed: () => false,
    once: (_: string, fn: () => void) => void closed.push(fn),
    webContents: { send: (_c: string, e: ConsoleEvent) => void sent.push(e) }
  }
  const ctx = {
    handle: (channel: string, fn: (e: IpcMainInvokeEvent, ...a: unknown[]) => unknown) => void handlers.set(channel, fn),
    demo: () => over.demo ?? false,
    userData: () => scratch,
    configFile: () => join(scratch, 'config.json'),
    window: () => (over.window === false ? null : win)
  } as unknown as MainCtx
  const deps: ConsoleDeps = { command: async () => ({ file: process.execPath, args: [FAKE] }), knownFolders: () => over.known ?? [HERE] }
  const dispose: Dispose = registerConsole(ctx, deps)
  disposers.push(dispose)
  const call = async <T>(channel: string, ...args: unknown[]): Promise<T> => (await handlers.get(channel)!({} as IpcMainInvokeEvent, ...args)) as T
  return { call, sent, closed, handlers, dispose }
}

const disposers: Dispose[] = []
afterEach(async () => {
  for (const d of disposers.splice(0)) d()
  await new Promise((r) => setTimeout(r, 100))
})

const good: ConsoleStart = { cwd: HERE, prompt: 'hello', model: null, effort: 'low', permissionMode: 'default', resume: null, options: NO_OPTIONS }

describe('registerConsole', () => {
  it('registers every console channel but the push', () => {
    const { handlers } = rig()
    expect([...handlers.keys()].sort()).toEqual([IPC.consoleStart, IPC.consoleSend, IPC.consoleStop, IPC.consoleList, IPC.consoleHistory, IPC.consoleAllow, IPC.consoleMcpList, IPC.consoleMcpCancel].sort())
  })

  it('starts a conversation in a known folder, pushes its events to the window and lists it', async () => {
    const { call, sent } = rig()
    const r = await call<{ ok: boolean; id: string }>(IPC.consoleStart, good)
    expect(r.ok).toBe(true)
    await vi.waitFor(() => expect(sent.some((e) => e.kind === 'turn-end')).toBe(true), { timeout: 10_000 })
    expect(sent.every((e) => e.conversation === r.id)).toBe(true)
    expect(await call(IPC.consoleList)).toEqual([expect.objectContaining({ id: r.id, title: 'hello', state: 'idle' })])
    expect((await call<ConsoleEvent[]>(IPC.consoleHistory, r.id)).length).toBeGreaterThan(3)
    expect(await call(IPC.consoleSend, r.id, 'again')).toEqual({ ok: true })
    expect(await call(IPC.consoleStop, r.id)).toEqual({ ok: true })
  })

  it('starts with bypassPermissions and a pasted image when the page asks for both', async () => {
    const { call } = rig()
    const png = { mediaType: 'image/png', data: 'iVBORw0KGgo=' }
    const r = await call<{ ok: boolean; id: string }>(IPC.consoleStart, { ...good, permissionMode: 'bypassPermissions', images: [png] })
    expect(r.ok).toBe(true)
    expect(await call(IPC.consoleList)).toEqual([expect.objectContaining({ id: r.id, permissionMode: 'bypassPermissions' })])
    expect(await call(IPC.consoleSend, r.id, 'and this', [], [png])).toEqual({ ok: true })
    expect(await call(IPC.consoleSend, r.id, 'bad', [], [{ mediaType: 'text/html', data: 'AAAA' }])).toMatchObject({ ok: false })
  })

  it('closes the conversations when the window it pushes to is closed', async () => {
    const { call, sent, closed } = rig()
    const r = await call<{ ok: boolean; id: string }>(IPC.consoleStart, good)
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0))
    expect(closed).toHaveLength(1)
    closed[0]!()
    await vi.waitFor(async () => expect(await call(IPC.consoleList)).toEqual([expect.objectContaining({ id: r.id, state: 'ended' })]), { timeout: 10_000 })
  })

  it('refuses a folder that is not on a local drive, or that AgentDeck does not know', async () => {
    const { call } = rig({ known: [HERE] })
    expect(await call(IPC.consoleStart, { ...good, cwd: '\\\\host\\share\\proj' })).toEqual({ ok: false, error: NOT_LOCAL, untrusted: false })
    // A local folder on this computer's own kind of path, just not one AgentDeck knows.
    const unknown = process.platform === 'win32' ? 'C:\\Windows' : '/etc'
    expect(await call(IPC.consoleStart, { ...good, cwd: unknown })).toEqual({ ok: false, error: NOT_KNOWN, untrusted: false })
    expect(await call(IPC.consoleList)).toEqual([])
  })

  it('checks every field the page sends before anything starts', async () => {
    const { call } = rig()
    const bad: unknown[] = [
      null, 'hello', [], {},
      { ...good, prompt: '' }, { ...good, prompt: '   ' }, { ...good, prompt: 7 },
      { ...good, model: '--dangerously-skip-permissions' }, { ...good, model: '-x' }, { ...good, model: 'a b' }, { ...good, model: 'x'.repeat(80) },
      { ...good, effort: 'ultra' }, { ...good, effort: undefined },
      { ...good, permissionMode: 'dontAsk' }, { ...good, permissionMode: 'auto' },
      { ...good, images: [{ mediaType: 'image/svg+xml', data: 'AAAA' }] }, { ...good, images: [{ mediaType: 'image/png', data: 'not base64!' }] },
      { ...good, images: Array.from({ length: 6 }, () => ({ mediaType: 'image/png', data: 'AAAA' })) },
      { ...good, resume: '--help' }, { ...good, resume: 'a b' }, { ...good, resume: '' },
      { ...good, cwd: 'C' }, { ...good, cwd: 42 },
      { ...good, extra: true }, { ...good, dangerouslySkipPermissions: true }
    ]
    for (const b of bad) expect(await call(IPC.consoleStart, b), JSON.stringify(b)).toMatchObject({ ok: false, untrusted: false })
    expect(await call(IPC.consoleList)).toEqual([])
  })

  it('says a message is too long, in words', async () => {
    const { call } = rig()
    expect(await call(IPC.consoleStart, { ...good, prompt: 'x'.repeat(CONSOLE_PROMPT_MAX + 1) })).toMatchObject({ ok: false, error: expect.stringContaining('longer than 32,000 characters') })
    expect(await call(IPC.consoleSend, 'c_00000001', 'x'.repeat(CONSOLE_PROMPT_MAX + 1))).toMatchObject({ ok: false, error: expect.stringContaining('longer than') })
  })

  it('accepts the aliases and full model names, and a resume id', async () => {
    const { call } = rig()
    for (const model of ['opus', 'sonnet', 'fable', 'claude-sonnet-5-5', 'claude-opus-4-5[1m]']) {
      expect(await call(IPC.consoleStart, { ...good, model, prompt: 'quick' }), model).toMatchObject({ ok: true })
    }
    expect(await call(IPC.consoleStart, { ...good, resume: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', prompt: 'quick' })).toMatchObject({ ok: true })
  })

  it('starts a fork only from a session to copy, and says so in words', async () => {
    const { call } = rig()
    const session = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    expect(await call(IPC.consoleStart, { ...good, fork: true })).toEqual({ ok: false, error: 'A fork needs a session to copy.', untrusted: false })
    expect(await call(IPC.consoleStart, { ...good, fork: true, forkOf: 'auth-tests' })).toMatchObject({ ok: false, error: 'A fork needs a session to copy.' })
    expect(await call(IPC.consoleStart, { ...good, forkOf: 'auth-tests' })).toMatchObject({ ok: false, error: 'A fork needs a session to copy.' })
    // A name without fork:true, a fork that is not a boolean, an empty name and a made-up field are refused.
    for (const bad of [{ resume: session, forkOf: 'x' }, { resume: session, fork: 'yes' }, { resume: session, fork: true, forkOf: '   ' }, { resume: session, fork: true, forkSession: true }]) {
      expect(await call(IPC.consoleStart, { ...good, ...bad }), JSON.stringify(bad)).toMatchObject({ ok: false, untrusted: false })
    }
    const r = await call<{ ok: boolean; id: string }>(IPC.consoleStart, { ...good, resume: session, fork: true, forkOf: 'auth-tests', prompt: 'quick' })
    expect(r.ok).toBe(true)
    expect(await call(IPC.consoleList)).toEqual([expect.objectContaining({ id: r.id, title: 'Fork of auth-tests', fork: { sessionId: session, name: 'auth-tests' } })])
  })

  it('validates the id and text of send, stop and history', async () => {
    const { call } = rig()
    for (const id of [undefined, 5, '', 'c_', 'c_XYZ', '../etc', 'c_000000001', { id: 'c_00000001' }]) {
      expect(await call(IPC.consoleSend, id, 'hi'), String(id)).toMatchObject({ ok: false })
      expect(await call(IPC.consoleStop, id), String(id)).toMatchObject({ ok: false })
      expect(await call(IPC.consoleHistory, id), String(id)).toEqual([])
    }
    expect(await call(IPC.consoleSend, 'c_00000001', '   ')).toEqual({ ok: false, error: 'Type a message first.' })
    expect(await call(IPC.consoleSend, 'c_00000001', 'hi')).toMatchObject({ ok: false, error: expect.stringContaining('not open') })
  })

  it('runs nothing in demo mode', async () => {
    const { call } = rig({ demo: true })
    expect(await call(IPC.consoleStart, good)).toMatchObject({ ok: false, error: expect.stringContaining('Demo data') })
    expect(await call(IPC.consoleSend, 'c_00000001', 'hi')).toMatchObject({ ok: false, error: expect.stringContaining('Demo data') })
    expect(await call(IPC.consoleStop, 'c_00000001')).toMatchObject({ ok: false })
    expect(await call(IPC.consoleList)).toEqual([])
    expect(await call(IPC.consoleHistory, 'c_00000001')).toEqual([])
  })

  it('keeps working with no window to show events in', async () => {
    const { call } = rig({ window: false })
    const r = await call<{ ok: boolean; id: string }>(IPC.consoleStart, good)
    expect(r.ok).toBe(true)
    await vi.waitFor(async () => expect(await call(IPC.consoleList)).toEqual([expect.objectContaining({ state: 'idle' })]), { timeout: 10_000 })
  })
})
