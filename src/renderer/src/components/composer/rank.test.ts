import { describe, expect, it } from 'vitest'
import { fixtureDivisions, fixtureRoles } from './fixture'
import { groupRows, menuRows, optionsOf, rankMentions } from './rank'
import { HEADER_ROW_H, ROLE_ROW_H, layoutOf, rangeAt, scrollToShow, topFor } from './window'

const roles = fixtureRoles()
const divisions = fixtureDivisions(roles)
const none = { pinned: [], recent: [] }
const ids = (rs: { id: string }[]): string[] => rs.map((r) => r.id)

describe('ranking what follows the @', () => {
  it('puts the CTO first for @c, ahead of every other name that begins with c', () => {
    const out = ids(rankMentions(roles, 'c', none))
    expect(out[0]).toBe('cto')
    expect(out).toEqual(expect.arrayContaining(['chief-of-staff', 'content-creator', 'cms-developer', 'code-reviewer']))
  })

  it('finds the QA roles for @qa, the ones named QA before the ones found through synonyms', () => {
    const out = ids(rankMentions(roles, 'qa', none))
    expect(out.slice(0, 2)).toContain('gis-qa-engineer')
    expect(out).toContain('test-automation-engineer')
    expect(out).toContain('evidence-collector')
  })

  it('knows the short forms people type: @fe, @cto, @marketing, @growth', () => {
    expect(ids(rankMentions(roles, 'fe', none))[0]).toBe('frontend-developer')
    expect(ids(rankMentions(roles, 'cto', none))[0]).toBe('cto')
    expect(ids(rankMentions(roles, 'marketing', none))).toEqual(expect.arrayContaining(['seo-specialist', 'growth-hacker', 'content-creator']))
    expect(ids(rankMentions(roles, 'growth', none))[0]).toBe('growth-hacker')
  })

  it('prefers the exact handle, then the name, then a prefix', () => {
    expect(ids(rankMentions(roles, 'frontend-developer', none))[0]).toBe('frontend-developer')
    expect(ids(rankMentions(roles, 'Frontend Developer', none))[0]).toBe('frontend-developer')
    expect(ids(rankMentions(roles, 'front', none))[0]).toBe('frontend-developer')
  })

  it('lets a pinned or recent role win a tie, but never over a better kind of match', () => {
    const tie = ids(rankMentions(roles, 'c', { pinned: ['content-creator'], recent: [] }))
    expect(tie.slice(0, 2)).toEqual(['cto', 'content-creator'])
    const recent = ids(rankMentions(roles, 'c', { pinned: [], recent: ['code-reviewer'] }))
    expect(recent.indexOf('code-reviewer')).toBeLessThan(recent.indexOf('cms-developer'))
    // A pinned role that only matches through its description stays under an exact handle.
    const exact = ids(rankMentions(roles, 'cto', { pinned: ['backend-architect'], recent: [] }))
    expect(exact[0]).toBe('cto')
  })

  it('lists nothing for nothing typed, and caps a broad query', () => {
    expect(rankMentions(roles, '', none)).toEqual([])
    expect(rankMentions(roles, '  ', none)).toEqual([])
    expect(rankMentions(roles, 'e', none, 5)).toHaveLength(5)
  })

  it('says nothing matches for a word nothing is called', () => {
    expect(rankMentions(roles, 'zzzzq', none)).toEqual([])
  })
})

describe('grouping the menu when nothing is typed', () => {
  it('starts with Pinned, then Recent, then Leadership, then each division with its count', () => {
    const rows = groupRows(roles, divisions, { pinned: ['frontend-developer'], recent: ['qa-nobody', 'seo-specialist', 'frontend-developer'] })
    const heads = rows.flatMap((r) => (r.kind === 'header' ? [`${r.label} ${r.count}`] : []))
    expect(heads).toEqual(['Pinned 1', 'Recent 1', 'Leadership 2', 'Engineering 4', 'Testing 4', 'Marketing 2', 'Specialized 1'])
  })

  it('lists a role once, in the first group that has it', () => {
    const rows = groupRows(roles, divisions, { pinned: ['cto'], recent: ['cto', 'qa'] })
    const all = optionsOf(rows).map((r) => r.id)
    expect(new Set(all).size).toBe(all.length)
    expect(all).toHaveLength(roles.length)
    expect(all[0]).toBe('cto')
  })

  it('has no Pinned or Recent group when there are none, and Leadership comes first', () => {
    const rows = groupRows(roles, divisions, none)
    expect(rows[0]).toMatchObject({ kind: 'header', label: 'Leadership' })
    expect(rows[1]).toMatchObject({ kind: 'role', role: { id: 'cto' } })
  })

  it('shows at most five recent roles', () => {
    const rows = groupRows(roles, divisions, { pinned: [], recent: roles.slice(5, 12).map((r) => r.id) })
    const recent = rows.findIndex((r) => r.kind === 'header' && r.id === 'recent')
    expect(rows[recent]).toMatchObject({ count: 5 })
  })

  it('chooses between the groups and the ranked list by whether anything is typed', () => {
    expect(menuRows(roles, divisions, '', none)[0]!.kind).toBe('header')
    expect(menuRows(roles, divisions, 'c', none).every((r) => r.kind === 'role')).toBe(true)
  })
})

describe('the menu stays instant with about 350 agents', () => {
  const many = Array.from({ length: 350 }, (_, i) => ({ ...roles[i % roles.length]!, id: `${roles[i % roles.length]!.id}-${i}`, name: `${roles[i % roles.length]!.name} ${i}` }))
  const timed = (fn: () => unknown): number => {
    const t = performance.now()
    fn()
    return performance.now() - t
  }

  it('groups every agent, ranks a typed handle, and ranks again, each well inside a frame budget', () => {
    expect(timed(() => groupRows(many, divisions, none))).toBeLessThan(50)
    // The first ranking builds the search index; the ones after it are what typing costs.
    timed(() => rankMentions(many, 'c', none))
    for (const q of ['c', 'cto', 'qa', 'frontend', 'our postgres']) expect(timed(() => rankMentions(many, q, none)), q).toBeLessThan(50)
  })
})

describe('windowing about 350 roles', () => {
  const many = Array.from({ length: 350 }, (_, i) => ({ kind: (i % 40 === 0 ? 'header' : 'role') as 'header' | 'role' }))
  const l = layoutOf(many)

  it('lays rows out with fixed heights, headers shorter than roles', () => {
    expect(l.tops[0]).toBe(0)
    expect(l.tops[1]).toBe(HEADER_ROW_H)
    expect(l.total).toBe(many.reduce((n, r) => n + (r.kind === 'header' ? HEADER_ROW_H : ROLE_ROW_H), 0))
  })

  it('renders a few rows, not 350, wherever the list is scrolled', () => {
    for (const top of [0, 1_000, 8_000, l.total - 360]) {
      const [from, to] = rangeAt(l, top, 360)
      expect(to - from).toBeLessThan(20)
      expect(l.tops[from]! + l.heights[from]!).toBeLessThanOrEqual(top + 3 * ROLE_ROW_H)
      expect(l.tops[Math.min(to, many.length - 1)]!).toBeGreaterThanOrEqual(top + 360 - 3 * ROLE_ROW_H)
    }
    expect(rangeAt(layoutOf([]), 0, 360)).toEqual([0, 0])
  })

  it('scrolls the least that brings a row into view', () => {
    expect(scrollToShow(100, 48, 0, 360)).toBe(0)
    expect(scrollToShow(400, 48, 0, 360)).toBe(88)
    expect(scrollToShow(20, 48, 100, 360)).toBe(20)
  })

  it('brings a group header into view with its first role', () => {
    expect(topFor(l, 1, many)).toEqual({ top: 0, height: HEADER_ROW_H + ROLE_ROW_H })
    expect(topFor(l, 2, many)).toEqual({ top: l.tops[2], height: ROLE_ROW_H })
  })
})
