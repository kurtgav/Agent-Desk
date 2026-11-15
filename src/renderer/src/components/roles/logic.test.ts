import { describe, expect, it } from 'vitest'
import { demoRolesCatalog } from '@/demo/roles'
import { ALL_ROLES, applyView, capFor, nextCard, sectionsFor, summary, type Box, type RolesView } from './logic'

const { roles, divisions } = demoRolesCatalog()
const view = (over: Partial<RolesView>): RolesView => ({ ...ALL_ROLES, ...over })
const names = (rs: { name: string }[]): string[] => rs.map((r) => r.name)

describe('applyView', () => {
  it('shows every role, in the catalog\'s order, when nothing is chosen', () => {
    const shown = applyView(roles, [], ALL_ROLES)
    expect(shown.roles).toEqual(roles)
    expect(shown.hits).toBeNull()
    expect(shown.mode).toBeNull()
  })

  it('filters by division, by pinned and by installed state, and the three combine', () => {
    expect(applyView(roles, [], view({ division: 'leadership' })).roles).toHaveLength(7)
    expect(names(applyView(roles, ['cto', 'planner'], view({ pinnedOnly: true })).roles).sort()).toEqual(['CTO', 'planner'])
    const installed = applyView(roles, [], view({ install: 'installed' })).roles
    const not = applyView(roles, [], view({ install: 'not-installed' })).roles
    expect(installed.every((r) => r.installed)).toBe(true)
    expect(not.every((r) => !r.installed)).toBe(true)
    expect(installed.length + not.length).toBe(roles.length)
    const both = applyView(roles, [], view({ division: 'engineering', install: 'installed' })).roles
    expect(both.every((r) => r.division === 'engineering' && r.installed)).toBe(true)
  })

  it('ranks by match for a name or a title, with the words that matched', () => {
    const shown = applyView(roles, [], view({ query: 'cto' }))
    expect(shown.mode).toBe('search')
    expect(shown.roles[0]!.name).toBe('CTO')
    expect(shown.hits!.get(shown.roles[0]!.id)!.matched).toEqual(['cto'])
  })

  it('ranks a sentence as a task, with reasons, and a query nothing matches word for word the same way', () => {
    const task = applyView(roles, [], view({ query: 'our postgres queries are slow' }))
    expect(task.mode).toBe('suggest')
    expect(task.roles[0]!.name).toBe('Database Optimizer')
    expect(task.hits!.get(task.roles[0]!.id)!.matched).toEqual(expect.arrayContaining(['queries']))
    const odd = applyView(roles, [], view({ query: 'plan roadmap prioritise' }))
    expect(['search', 'suggest']).toContain(odd.mode)
    expect(odd.roles.length).toBeGreaterThan(0)
  })

  it('keeps the filters while searching, and is empty for words nothing knows', () => {
    const inDivision = applyView(roles, [], view({ query: 'engineer', division: 'engineering' })).roles
    expect(inDivision.every((r) => r.division === 'engineering')).toBe(true)
    expect(applyView(roles, [], view({ query: 'zzzzqqqq' })).roles).toEqual([])
  })
})

describe('sectionsFor and capFor', () => {
  it('puts Pinned first, then every division in the catalog\'s order, and does not repeat a pinned role below', () => {
    const s = sectionsFor(roles, divisions, ['cto', 'frontend-developer'])
    expect(s.map((x) => x.id).slice(0, 3)).toEqual(['pinned', 'leadership', expect.any(String)])
    expect(names(s[0]!.roles)).toEqual(['CTO', 'Frontend Developer'])
    const below = s.slice(1).flatMap((x) => names(x.roles))
    expect(below).not.toContain('CTO')
    expect(below).not.toContain('Frontend Developer')
    expect(new Set([...names(s[0]!.roles), ...below]).size).toBe(roles.length)
  })

  it('has no Pinned section when nothing is pinned, and skips empty divisions', () => {
    const s = sectionsFor(roles, divisions, [])
    expect(s[0]!.id).toBe('leadership')
    expect(s.every((x) => x.roles.length > 0)).toBe(true)
  })

  it('collapses to one row per division, two for Leadership, and shows all of Pinned', () => {
    const s = sectionsFor(roles, divisions, ['cto', 'frontend-developer'])
    expect(capFor(s[0]!, 3)).toBe(2)
    expect(capFor(s.find((x) => x.id === 'leadership')!, 3)).toBe(6)
    expect(capFor(s.find((x) => x.id === 'engineering')!, 3)).toBe(3)
    expect(capFor(s.find((x) => x.id === 'engineering')!, 2)).toBe(2)
    expect(capFor(s.find((x) => x.id === 'engineering')!, 0)).toBe(1)
  })
})

describe('nextCard (arrow keys by position)', () => {
  /** Two sections: a row of three, then a row of three, then a row of two, 300 wide with 12 gaps. */
  const grid = (): Box[] => {
    const out: Box[] = []
    const rows = [[3, 0], [3, 200], [2, 420]] as const
    let n = 0
    for (const [count, y] of rows) for (let i = 0; i < count; i++) out.push({ id: `c${n++}`, x: i * 312, y, w: 300, h: 168 })
    return out
  }

  it('moves across a row and to the next one in reading order', () => {
    const b = grid()
    expect(nextCard(b, 'c0', 'ArrowRight')).toBe('c1')
    expect(nextCard(b, 'c2', 'ArrowRight')).toBe('c3')
    expect(nextCard(b, 'c3', 'ArrowLeft')).toBe('c2')
    expect(nextCard(b, 'c0', 'ArrowLeft')).toBe('c0')
    expect(nextCard(b, 'c7', 'ArrowRight')).toBe('c7')
  })

  it('moves down and up by column, across sections, landing on the nearest card when the row is shorter', () => {
    const b = grid()
    expect(nextCard(b, 'c1', 'ArrowDown')).toBe('c4')
    expect(nextCard(b, 'c4', 'ArrowDown')).toBe('c7')
    expect(nextCard(b, 'c5', 'ArrowDown')).toBe('c7') // the last row has two: the nearest one
    expect(nextCard(b, 'c7', 'ArrowUp')).toBe('c4')
    expect(nextCard(b, 'c1', 'ArrowUp')).toBe('c1')
    expect(nextCard(b, 'c6', 'ArrowDown')).toBe('c6')
  })

  it('jumps to the ends, and recovers when the current card is gone', () => {
    const b = grid()
    expect(nextCard(b, 'c4', 'Home')).toBe('c0')
    expect(nextCard(b, 'c4', 'End')).toBe('c7')
    expect(nextCard(b, 'gone', 'ArrowDown')).toBe('c0')
    expect(nextCard([], 'x', 'Home')).toBe('x')
  })
})

describe('summary', () => {
  it('says how many and of what', () => {
    expect(summary(1, ALL_ROLES, null)).toBe('1 role')
    expect(summary(12, view({ division: 'design' }), 'Design')).toBe('12 roles · in Design')
    expect(summary(3, view({ query: 'seo', install: 'installed' }), null)).toBe('3 roles · installed · matching “seo”')
  })
})
