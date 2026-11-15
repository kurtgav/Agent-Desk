import { describe, expect, it } from 'vitest'
import {
  ALIAS_MAX, EMPTY_META, META_KEEP_MS, META_MAX_ENTRIES, SECTIONS_MAX, SECTION_NAME_MAX, SEEN_REFRESH_MS, SectionOpSchema, SessionMetaPatchSchema,
  applyPatch, applySectionOp, bgKey, nameKey, oneLine, prune, readMeta, roleOf, setRole, toConfig, touch, validId, type SessionMetaState
} from './session-meta'

const NOW = Date.UTC(2026, 10, 14, 12, 0)
const DAY = 86_400_000

const ok = (r: ReturnType<typeof applyPatch>): SessionMetaState => {
  if (!r.ok) throw new Error(r.error)
  return r.state
}
const withSections = (...names: string[]): SessionMetaState => ({ ...EMPTY_META, sections: names })

describe('oneLine', () => {
  it('makes one line: control and direction characters go, runs collapse, the length counts characters', () => {
    expect(oneLine('  a\u0000b\r\n\tc‮d  ', 20)).toBe('a b c d')
    expect(oneLine('😀'.repeat(10), 4)).toBe('😀😀😀😀')
  })
})

describe('readMeta (config.json is checked on the way in)', () => {
  it('keeps good entries, drops entries that are not objects or have a bad id, and reads a bad field as absent', () => {
    const state = readMeta(
      {
        sessionMeta: {
          a: { pinned: true, unread: 'yes', alias: 42 },
          b: 'nope',
          c: [1],
          'bad id': { pinned: true },
          __proto__: { pinned: true }
        },
        sections: []
      },
      NOW
    )
    expect(Object.keys(state.sessions)).toEqual(['a'])
    expect(state.sessions.a).toEqual({ pinned: true, seenAt: NOW })
  })

  it('keeps keys this version does not know, inside an entry', () => {
    const state = readMeta({ sessionMeta: { a: { pinned: true, color: 'teal', seenAt: NOW - DAY } }, sections: [] }, NOW)
    expect(state.sessions.a).toEqual({ pinned: true, color: 'teal', seenAt: NOW - DAY })
    expect(toConfig(state).sessionMeta.a).toMatchObject({ color: 'teal' })
  })

  it('drops an entry with nothing left to say, but keeps one that only has an unknown key', () => {
    const state = readMeta({ sessionMeta: { a: { pinned: false, alias: '   ' }, b: { color: 'teal' } }, sections: [] }, NOW)
    expect(Object.keys(state.sessions)).toEqual(['b'])
  })

  it('cleans the alias to one line of at most ALIAS_MAX characters', () => {
    const state = readMeta({ sessionMeta: { a: { alias: `x\ny${'z'.repeat(200)}` } }, sections: [] }, NOW)
    expect(state.sessions.a?.alias).toHaveLength(ALIAS_MAX)
    expect(state.sessions.a?.alias?.startsWith('x y')).toBe(true)
  })

  it('cleans sections: trimmed, unique ignoring case, not more than SECTIONS_MAX, non-strings dropped', () => {
    const many = Array.from({ length: SECTIONS_MAX + 5 }, (_, i) => `S${i}`)
    expect(readMeta({ sections: ['  Client work ', 'client WORK', 7, '', 'Home'] }, NOW).sections).toEqual(['Client work', 'Home'])
    expect(readMeta({ sections: many }, NOW).sections).toHaveLength(SECTIONS_MAX)
    expect(readMeta({ sections: 'Home' }, NOW).sections).toEqual([])
  })

  it('un-files an entry whose section is no longer in the list, and fixes the casing of one that is', () => {
    const state = readMeta({ sessionMeta: { a: { section: 'gone', pinned: true }, b: { section: 'client work' } }, sections: ['Client work'] }, NOW)
    expect(state.sessions.a).not.toHaveProperty('section')
    expect(state.sessions.b?.section).toBe('Client work')
  })

  it('reads anything as an empty state', () => {
    expect(readMeta({}, NOW)).toEqual(EMPTY_META)
    expect(readMeta({ sessionMeta: 12, sections: null }, NOW)).toEqual(EMPTY_META)
  })
})

describe('applyPatch', () => {
  it('pins, marks unread, archives and renames, one note at a time, and stamps the sighting', () => {
    let s = ok(applyPatch(EMPTY_META, 's1', { pinned: true }, NOW))
    s = ok(applyPatch(s, 's1', { unread: true, alias: '  Billing\nAPI ' }, NOW + 1))
    s = ok(applyPatch(s, 's1', { archived: true }, NOW + 2))
    expect(s.sessions.s1).toEqual({ pinned: true, unread: true, archived: true, alias: 'Billing API', seenAt: NOW + 2 })
  })

  it('takes a note off with false, null or an empty alias, and removes the entry when nothing is left', () => {
    let s = ok(applyPatch(EMPTY_META, 's1', { pinned: true, alias: 'x' }, NOW))
    s = ok(applyPatch(s, 's1', { alias: '   ' }, NOW))
    expect(s.sessions.s1).toEqual({ pinned: true, seenAt: NOW })
    s = ok(applyPatch(s, 's1', { pinned: false }, NOW))
    expect(s.sessions).toEqual({})
  })

  it('keeps the keys it does not know', () => {
    const start = readMeta({ sessionMeta: { s1: { pinned: true, color: 'teal' } } }, NOW)
    expect(ok(applyPatch(start, 's1', { unread: true }, NOW)).sessions.s1).toMatchObject({ color: 'teal', unread: true })
  })

  it('files a session in an existing section (ignoring case) and refuses one that is gone', () => {
    const base = withSections('Client work')
    expect(ok(applyPatch(base, 's1', { section: 'client WORK' }, NOW)).sessions.s1?.section).toBe('Client work')
    expect(applyPatch(base, 's1', { section: 'Nope' }, NOW)).toEqual({ ok: false, error: expect.stringMatching(/section is gone/) })
    const filed = ok(applyPatch(base, 's1', { section: 'Client work' }, NOW))
    expect(ok(applyPatch(filed, 's1', { section: null }, NOW)).sessions).toEqual({})
  })

  it('refuses an id that is not a session id', () => {
    for (const id of ['', '__proto__', 'a b', 'x'.repeat(129), '../etc']) expect(applyPatch(EMPTY_META, id, { pinned: true }, NOW).ok).toBe(false)
    expect(validId('0b6e0d55-7c2e-4a39-9d0a-5d6a1f2c3b4e')).toBe(true)
  })

  it('does not change the state it was given', () => {
    const base = ok(applyPatch(EMPTY_META, 's1', { pinned: true }, NOW))
    const frozen = JSON.stringify(base)
    applyPatch(base, 's1', { pinned: false }, NOW)
    applyPatch(base, 's2', { alias: 'x' }, NOW)
    expect(JSON.stringify(base)).toBe(frozen)
  })
})

describe('sections', () => {
  const add = (s: SessionMetaState, name: string) => applySectionOp(s, { op: 'add', name }, NOW)

  it('adds a section: cleaned, at most SECTION_NAME_MAX characters, unique ignoring case', () => {
    const s = ok(add(EMPTY_META, `  Client\nwork ${'x'.repeat(100)}`))
    expect(s.sections[0]).toHaveLength(SECTION_NAME_MAX)
    expect(add(ok(add(EMPTY_META, 'Home')), 'home')).toEqual({ ok: false, error: 'There is already a section called home.' })
    expect(add(EMPTY_META, '   ')).toEqual({ ok: false, error: 'Give the section a name.' })
  })

  it('stops at SECTIONS_MAX', () => {
    let s = EMPTY_META
    for (let i = 0; i < SECTIONS_MAX; i++) s = ok(add(s, `S${i}`))
    expect(add(s, 'One more')).toMatchObject({ ok: false, error: expect.stringContaining(`${SECTIONS_MAX} sections`) })
  })

  it('renames a section and moves its sessions along; the new name must be free', () => {
    let s = ok(add(ok(add(EMPTY_META, 'Client work')), 'Home'))
    s = ok(applyPatch(s, 's1', { section: 'Client work' }, NOW))
    const renamed = ok(applySectionOp(s, { op: 'rename', from: 'client work', to: 'Clients' }, NOW))
    expect(renamed.sections).toEqual(['Clients', 'Home'])
    expect(renamed.sessions.s1?.section).toBe('Clients')
    expect(applySectionOp(s, { op: 'rename', from: 'Client work', to: 'HOME' }, NOW)).toMatchObject({ ok: false })
    expect(ok(applySectionOp(s, { op: 'rename', from: 'Client work', to: 'CLIENT WORK' }, NOW)).sections[0]).toBe('CLIENT WORK')
  })

  it('deleting a section only un-files its sessions: pinned and unknown keys stay, an entry with nothing left goes', () => {
    let s = ok(add(EMPTY_META, 'Client work'))
    s = ok(applyPatch(s, 'a', { section: 'Client work', pinned: true }, NOW))
    s = ok(applyPatch(s, 'b', { section: 'Client work' }, NOW))
    const withKey = { ...s, sessions: { ...s.sessions, c: { section: 'Client work', color: 'teal', seenAt: NOW } } }
    const after = ok(applySectionOp(withKey, { op: 'delete', name: 'Client work' }, NOW))
    expect(after.sections).toEqual([])
    expect(after.sessions.a).toEqual({ pinned: true, seenAt: NOW })
    expect(after.sessions).not.toHaveProperty('b')
    expect(after.sessions.c).toEqual({ color: 'teal', seenAt: NOW })
  })

  it('says so when the section is gone', () => {
    expect(applySectionOp(EMPTY_META, { op: 'delete', name: 'x' }, NOW)).toMatchObject({ ok: false })
    expect(applySectionOp(EMPTY_META, { op: 'rename', from: 'x', to: 'y' }, NOW)).toMatchObject({ ok: false })
  })
})

describe('pruning and sightings', () => {
  const entries = (n: number, seenAt: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`s${i}`, { alias: `n${i}`, seenAt: seenAt - i }]))

  it('drops what no snapshot has listed for 90 days, pinned or not', () => {
    const state: SessionMetaState = {
      sections: [],
      sessions: {
        fresh: { alias: 'a', seenAt: NOW - 89 * DAY },
        old: { alias: 'b', seenAt: NOW - META_KEEP_MS - 1 },
        oldPinned: { pinned: true, seenAt: NOW - 120 * DAY }
      }
    }
    expect(Object.keys(prune(state, NOW).sessions)).toEqual(['fresh'])
  })

  it('caps the entries, keeping the pinned and then the most recently seen', () => {
    const sessions = { ...entries(META_MAX_ENTRIES + 10, NOW), pinnedOld: { pinned: true, seenAt: NOW - 80 * DAY } }
    const kept = prune({ sections: [], sessions }, NOW).sessions
    expect(Object.keys(kept)).toHaveLength(META_MAX_ENTRIES)
    expect(kept.pinnedOld).toBeDefined()
    expect(kept.s0).toBeDefined()
    expect(kept[`s${META_MAX_ENTRIES + 9}`]).toBeUndefined()
  })

  it('a patch that would pass the cap prunes in the same step', () => {
    const state: SessionMetaState = { sections: [], sessions: entries(META_MAX_ENTRIES, NOW - DAY) }
    const next = ok(applyPatch(state, 'new', { pinned: true }, NOW))
    expect(Object.keys(next.sessions)).toHaveLength(META_MAX_ENTRIES)
    expect(next.sessions.new).toBeDefined()
  })

  it('touch stamps the sessions a snapshot lists, but only when the stamp is stale, and returns the same object when nothing changed', () => {
    const state: SessionMetaState = { sections: [], sessions: { a: { pinned: true, seenAt: NOW - SEEN_REFRESH_MS - 1 }, b: { pinned: true, seenAt: NOW - 1000 } } }
    const next = touch(state, ['a', 'b', 'unknown'], NOW)
    expect(next.sessions.a?.seenAt).toBe(NOW)
    expect(next.sessions.b?.seenAt).toBe(NOW - 1000)
    expect(next.sessions).not.toHaveProperty('unknown')
    expect(touch(next, ['a', 'b'], NOW)).toBe(next)
  })
})

describe('what the window may send', () => {
  it('accepts the patch fields and refuses anything else', () => {
    expect(SessionMetaPatchSchema.safeParse({ pinned: true, alias: null }).success).toBe(true)
    expect(SessionMetaPatchSchema.safeParse({ pinned: 'yes' }).success).toBe(false)
    expect(SessionMetaPatchSchema.safeParse({ pinned: true, seenAt: 1 }).success).toBe(false)
    expect(SessionMetaPatchSchema.safeParse({ alias: 'x'.repeat(501) }).success).toBe(false)
  })

  it('accepts the three section operations and refuses anything else', () => {
    expect(SectionOpSchema.safeParse({ op: 'add', name: 'x' }).success).toBe(true)
    expect(SectionOpSchema.safeParse({ op: 'rename', from: 'a', to: 'b' }).success).toBe(true)
    expect(SectionOpSchema.safeParse({ op: 'delete', name: 'x' }).success).toBe(true)
    expect(SectionOpSchema.safeParse({ op: 'drop', name: 'x' }).success).toBe(false)
    expect(SectionOpSchema.safeParse({ op: 'add' }).success).toBe(false)
  })
})

describe('the role of a session AgentDeck started', () => {
  const FE = 'frontend-developer'

  it('is noted under every key, and read back by the session id, the name or the background id', () => {
    const state = setRole(EMPTY_META, ['aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', nameKey('fix-login-ab12'), bgKey('fakebg1')], FE, NOW)
    expect(Object.keys(state.sessions)).toEqual(['aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'name:fix-login-ab12', 'bg:fakebg1'])
    expect(roleOf(state, { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' })).toBe(FE)
    expect(roleOf(state, { id: 'cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee', name: 'fix-login-ab12' })).toBe(FE)
    expect(roleOf(state, { id: 'cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee', bgId: 'fakebg1' })).toBe(FE)
    expect(roleOf(state, { id: 'cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee', bgId: 'other', name: 'other-name' })).toBeNull()
  })

  it('changes nothing for a role id or a key that is not valid', () => {
    expect(setRole(EMPTY_META, ['a'], '../cto', NOW)).toBe(EMPTY_META)
    expect(setRole(EMPTY_META, ['a'], 'CTO', NOW)).toBe(EMPTY_META)
    expect(setRole(EMPTY_META, ['bad key', '__proto__'], FE, NOW).sessions).toEqual({})
  })

  it('keeps what else the entry says, and survives a read from config.json', () => {
    const pinned = ok(applyPatch(EMPTY_META, 'a', { pinned: true }, NOW))
    const state = setRole(pinned, ['a'], FE, NOW)
    expect(state.sessions.a).toMatchObject({ pinned: true, role: FE })
    const reread = readMeta(toConfig(state), NOW)
    expect(reread.sessions.a).toMatchObject({ pinned: true, role: FE })
    // Un-pinning does not drop the role: an entry that still says something stays.
    expect(ok(applyPatch(reread, 'a', { pinned: false }, NOW)).sessions.a).toMatchObject({ role: FE })
  })

  it('reads a role that is not an id as absent, and keeps an entry that holds only a role', () => {
    const state = readMeta({ sessionMeta: { a: { role: '../x', pinned: true }, b: { role: FE }, c: { role: 7 } } }, NOW)
    expect(state.sessions.a).toEqual({ pinned: true, seenAt: NOW })
    expect(state.sessions.b).toEqual({ role: FE, seenAt: NOW })
    expect(state.sessions.c).toBeUndefined()
  })

  it('can not be set from the window: the patch has no role', () => {
    expect(SessionMetaPatchSchema.safeParse({ role: FE }).success).toBe(false)
  })

  it('goes with the entry after 90 days, like the rest of it, and the 2,000-entry cap prunes it too', () => {
    const state = setRole(EMPTY_META, ['name:old'], FE, NOW - META_KEEP_MS - DAY)
    expect(prune(state, NOW).sessions).toEqual({})
    const many = Object.fromEntries(Array.from({ length: META_MAX_ENTRIES + 5 }, (_, i) => [`s${i}`, { role: FE, seenAt: NOW - i }]))
    expect(Object.keys(prune({ ...EMPTY_META, sessions: many }, NOW).sessions)).toHaveLength(META_MAX_ENTRIES)
  })

  it('is not refreshed by touching the session ids a snapshot lists (the documented 90-day shortcut)', () => {
    const state = setRole(EMPTY_META, ['name:x'], FE, NOW - 8 * 3_600_000)
    expect(touch(state, ['aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'], NOW)).toBe(state)
  })
})
