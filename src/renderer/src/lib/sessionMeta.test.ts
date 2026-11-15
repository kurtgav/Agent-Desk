import { describe, expect, it } from 'vitest'
import { EMPTY_META, applyPatch, applySectionOp, type SessionMetaPatch, type SessionMetaState } from '@shared/session-meta'
import type { Session, Status } from '@shared/snapshot'
import { groupSessions, isPinned, isRunning, nameOf, noteOf, pinnedFirst, pinnedSessions, shownIn, type Place } from './sessionMeta'

const NOW = Date.UTC(2026, 10, 14, 12, 0)

const session = (id: string, status: Status = 'idle', over: Partial<Session> = {}): Session => ({
  id, bgId: null, name: `name-${id}`, cwd: 'C:\\p', surface: 'cli', status, startedAt: 0, lastEventAt: 0, activity: '', plan: null, waitingSince: null, subagents: [], ...over
})

function notes(...steps: [string, SessionMetaPatch][]): SessionMetaState {
  return apply(EMPTY_META, ...steps)
}
function apply(from: SessionMetaState, ...steps: [string, SessionMetaPatch][]): SessionMetaState {
  let state = from
  for (const [id, patch] of steps) {
    const r = applyPatch(state, id, patch, NOW)
    if (!r.ok) throw new Error(r.error)
    state = r.state
  }
  return state
}
function withSections(state: SessionMetaState, ...names: string[]): SessionMetaState {
  return names.reduce((s, name) => {
    const r = applySectionOp(s, { op: 'add', name }, NOW)
    if (!r.ok) throw new Error(r.error)
    return r.state
  }, state)
}

describe('the name a session shows', () => {
  it('is your name for it, otherwise the one Claude Code gave it; clearing the alias brings the original back', () => {
    const s = session('a')
    const named = notes(['a', { alias: 'Billing API' }])
    expect(nameOf(named, s)).toBe('Billing API')
    expect(nameOf(EMPTY_META, s)).toBe('name-a')
    expect(nameOf(notes(['a', { alias: 'x' }], ['a', { alias: null }]), s)).toBe('name-a')
    expect(nameOf(named, session('b'))).toBe('name-b')
  })

  it('never reads a note off the object prototype', () => {
    expect(noteOf(EMPTY_META, '__proto__')).toBeUndefined()
    expect(noteOf(EMPTY_META, 'constructor')).toBeUndefined()
    expect(nameOf(EMPTY_META, session('toString'))).toBe('name-toString')
  })
})

describe('pinned sessions float to the top of every list', () => {
  const list = [session('a'), session('b'), session('c'), session('d')]

  it('moves them up and keeps every other order', () => {
    const meta = notes(['c', { pinned: true }], ['a', { pinned: true }])
    expect(pinnedFirst(list, meta).map((s) => s.id)).toEqual(['a', 'c', 'b', 'd'])
    expect(pinnedFirst(list, EMPTY_META)).toEqual(list)
  })

  it('does not change the list it was given', () => {
    const copy = [...list]
    pinnedFirst(list, notes(['d', { pinned: true }]))
    expect(list).toEqual(copy)
  })

  it('the sidebar group lists the pinned ones, most recently active first', () => {
    const meta = notes(['a', { pinned: true }], ['b', { pinned: true }])
    const sessions = [session('a', 'idle', { lastEventAt: 5 }), session('b', 'idle', { lastEventAt: 9 }), session('c', 'idle', { lastEventAt: 99 })]
    expect(pinnedSessions(sessions, meta).map((s) => s.id)).toEqual(['b', 'a'])
    expect(isPinned(meta, 'a')).toBe(true)
  })
})

describe('archive: what it hides and what it never does', () => {
  const archived = notes(['x', { archived: true }])
  const ALL: Status[] = ['working', 'needs_you', 'failed', 'idle', 'done']
  const where = (place: Place, status: Status): boolean => shownIn(place, session('x', status), archived)

  it('hides an archived session from Sessions, whatever it is doing', () => {
    for (const status of ALL) expect(where('sessions', status)).toBe(false)
  })

  it('hides it from Your agents once it is not running, and keeps a running or waiting one there', () => {
    expect(ALL.filter((st) => where('agents', st))).toEqual(['working', 'needs_you'])
  })

  it('never hides it from Running now or from Needs you', () => {
    for (const status of ALL) {
      expect(where('running', status)).toBe(true)
      expect(where('needs-you', status)).toBe(true)
    }
  })

  it('shows a session that is not archived everywhere', () => {
    for (const place of ['sessions', 'agents', 'running', 'needs-you'] as const) expect(shownIn(place, session('y', 'done'), archived)).toBe(true)
  })

  it('unarchiving shows it again', () => {
    const back = notes(['x', { archived: true }], ['x', { archived: false }])
    expect(shownIn('sessions', session('x', 'done'), back)).toBe(true)
  })

  it('running means working or waiting for you', () => {
    expect(ALL.filter((status) => isRunning({ status }))).toEqual(['working', 'needs_you'])
  })
})

describe('groups on the Sessions page', () => {
  const list = [session('a'), session('b'), session('c'), session('d'), session('e')]

  it('with no sections it is one list with the pinned first and no headings', () => {
    const groups = groupSessions(list, notes(['c', { pinned: true }]))
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ title: null, kind: 'rest' })
    expect(groups[0]!.sessions.map((s) => s.id)).toEqual(['c', 'a', 'b', 'd', 'e'])
  })

  it('with sections: Pinned, then each section in the order it was made (empty ones too), then the rest', () => {
    const s = apply(withSections(EMPTY_META, 'Clients', 'Home', 'Empty'), ['a', { pinned: true }], ['b', { section: 'Home' }], ['c', { section: 'Clients' }], ['d', { section: 'Clients' }], ['a', { section: 'Clients' }])
    const groups = groupSessions(list, s)
    expect(groups.map((g) => [g.title, g.sessions.map((x) => x.id)])).toEqual([
      ['Pinned', ['a']],
      ['Clients', ['c', 'd']],
      ['Home', ['b']],
      ['Empty', []],
      ['Not in a section', ['e']]
    ])
    expect(groups.map((g) => g.kind)).toEqual(['pinned', 'section', 'section', 'section', 'rest'])
    expect(new Set(groups.map((g) => g.key)).size).toBe(groups.length)
  })

  it('every session is in exactly one group', () => {
    const s = apply(withSections(EMPTY_META, 'A', 'B'), ['a', { section: 'A' }], ['b', { section: 'B' }], ['c', { section: 'A' }], ['d', { pinned: true }])
    const ids = groupSessions(list, s).flatMap((g) => g.sessions.map((x) => x.id))
    expect([...ids].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('deleting a section only un-files its sessions: they fall into the rest', () => {
    let s = withSections(EMPTY_META, 'Clients')
    const r = applyPatch(s, 'a', { section: 'Clients' }, NOW)
    if (!r.ok) throw new Error(r.error)
    s = r.state
    const del = applySectionOp(s, { op: 'delete', name: 'Clients' }, NOW)
    if (!del.ok) throw new Error(del.error)
    const groups = groupSessions(list, del.state)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.sessions.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})
