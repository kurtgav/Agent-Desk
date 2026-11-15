import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { IPC } from '@shared/bridge'
import type { SessionMetaResult, SessionMetaState } from '@shared/session-meta'
import type { MainCtx } from './ctx'
import { changeMeta, loadMeta, registerSessionMeta, saveMeta } from './session-meta'

const NOW = Date.UTC(2026, 10, 14, 12, 0)
const dir = mkdtempSync(join(tmpdir(), 'agentdeck-meta-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

let file = ''
let n = 0
beforeEach(() => {
  file = join(dir, `config-${n++}.json`)
})
const write = (v: unknown): void => writeFileSync(file, JSON.stringify(v))
const read = (): Record<string, unknown> => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>

describe('session notes in config.json', () => {
  it('reads nothing from a missing or damaged file', () => {
    expect(loadMeta(file, NOW)).toEqual({ sessions: {}, sections: [] })
    writeFileSync(file, '{ not json')
    expect(loadMeta(file, NOW)).toEqual({ sessions: {}, sections: [] })
  })

  it('writes only its two keys and keeps every other key of the file, and every unknown key of an entry', () => {
    write({ demo: false, token: 'abc', sessionMeta: { s1: { pinned: true, color: 'teal', seenAt: NOW } }, sections: ['Home'] })
    const r = changeMeta(file, NOW, (state) => ({ ok: true, state: { ...state, sections: [...state.sections, 'Clients'] } }))
    expect(r.ok).toBe(true)
    expect(read()).toEqual({ demo: false, token: 'abc', sessionMeta: { s1: { pinned: true, color: 'teal', seenAt: NOW } }, sections: ['Home', 'Clients'] })
  })

  it('does not write when the change is refused', () => {
    write({ sections: ['Home'] })
    const before = readFileSync(file, 'utf8')
    expect(changeMeta(file, NOW, () => ({ ok: false, error: 'No.' }))).toEqual({ ok: false, error: 'No.' })
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('reads back what it wrote, and says so when the file cannot be written', () => {
    const state: SessionMetaState = { sessions: { s1: { alias: 'x', seenAt: NOW } }, sections: [] }
    expect(saveMeta(file, state)).toEqual({ ok: true, state })
    const blocked = join(dir, 'blocked.json')
    mkdirSync(blocked)
    expect(saveMeta(blocked, state)).toMatchObject({ ok: false, error: expect.stringContaining('could not write config.json') })
  })

  it('prunes on read: what no snapshot listed for 90 days is gone', () => {
    write({ sessionMeta: { old: { alias: 'a', seenAt: NOW - 100 * 86_400_000 }, fresh: { alias: 'b', seenAt: NOW } } })
    expect(Object.keys(loadMeta(file, NOW).sessions)).toEqual(['fresh'])
  })
})

describe('the IPC handlers (only our page reaches them; demo keeps its notes in memory)', () => {
  type Handler = (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  const setup = (demo: boolean): Record<string, (...args: unknown[]) => unknown> => {
    const handlers = new Map<string, Handler>()
    const ctx = { handle: (c: string, fn: Handler) => handlers.set(c, fn), demo: () => demo, configFile: () => file } as unknown as MainCtx
    registerSessionMeta(ctx)
    const call = (channel: string) => (...args: unknown[]) => handlers.get(channel)!({} as IpcMainInvokeEvent, ...args)
    return { get: call(IPC.getSessionMeta), set: call(IPC.setSessionMeta), sections: call(IPC.setSections), seen: call(IPC.touchSessions) }
  }

  it('sets a note through a patch and a section through an operation, and the next get returns them', () => {
    write({})
    const h = setup(false)
    expect((h.sections!({ op: 'add', name: 'Clients' }) as SessionMetaResult).ok).toBe(true)
    expect(h.set!('s1', { pinned: true, section: 'Clients' })).toMatchObject({ ok: true })
    expect(h.get!()).toMatchObject({ sections: ['Clients'], sessions: { s1: { pinned: true, section: 'Clients' } } })
  })

  it('refuses a malformed message instead of storing it', () => {
    write({})
    const h = setup(false)
    expect(() => h.set!('s1', { pinned: 'yes' })).toThrow()
    expect(() => h.set!('s1', { seenAt: 1 })).toThrow()
    expect(() => h.set!('', { pinned: true })).toThrow()
    expect(() => h.sections!({ op: 'drop' })).toThrow()
    expect(() => h.seen!('not an array')).toThrow()
    expect(read()).toEqual({})
  })

  it('answers a refused change with a sentence', () => {
    write({})
    expect(setup(false).set!('s1', { section: 'Nope' })).toMatchObject({ ok: false, error: expect.stringMatching(/section is gone/) })
  })

  it('demo reads nothing and writes nothing', () => {
    write({ sessionMeta: { s1: { pinned: true, seenAt: NOW } } })
    const before = readFileSync(file, 'utf8')
    const h = setup(true)
    expect(h.get!()).toEqual({ sessions: {}, sections: [] })
    expect(h.set!('s1', { pinned: false })).toEqual({ ok: false, error: 'Demo data: nothing was saved.' })
    expect(h.sections!({ op: 'add', name: 'x' })).toMatchObject({ ok: false })
    h.seen!(['s1'])
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('a sighting of a session that has notes is written once, then not again until the stamp is stale', () => {
    write({ sessionMeta: { s1: { pinned: true, seenAt: Date.now() - 12 * 3_600_000 } } })
    const h = setup(false)
    h.seen!(['s1', 'other'])
    const stamped = (read().sessionMeta as Record<string, { seenAt: number }>).s1!.seenAt
    expect(stamped).toBeGreaterThan(Date.now() - 60_000)
    const text = readFileSync(file, 'utf8')
    h.seen!(['s1'])
    expect(readFileSync(file, 'utf8')).toBe(text)
  })
})
