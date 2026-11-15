import { describe, expect, it } from 'vitest'
import { demoRolesCatalog } from '../renderer/src/demo/roles'
import { searchRoles, stem, suggestRoles, words } from './role-search'

/** The demo catalog: about 50 roles with real-shaped names and descriptions, so the expectations below are what a user of the demo sees. */
const roles = demoRolesCatalog().roles
const names = (hits: { id: string }[]): string[] => hits.map((h) => roles.find((r) => r.id === h.id)!.name)

describe('words and stem', () => {
  it('splits, lower-cases and removes accents', () => {
    expect(words('Frontend-Developer (SRE) & Café')).toEqual(['frontend', 'developer', 'sre', 'and', 'cafe'])
    expect(words('C# and C++ on .NET')).toEqual(['csharp', 'and', 'cpp', 'on', 'dotnet'])
  })

  it('makes related forms meet', () => {
    expect(stem('queries')).toBe(stem('query'))
    expect(stem('optimizer')).toBe(stem('optimizing'))
    expect(stem('developers')).toBe(stem('development'))
    expect(stem('postgres')).not.toBe('')
    expect(stem('cto')).toBe('cto')
  })
})

describe('searchRoles', () => {
  it('finds a role by its name first', () => {
    expect(names(searchRoles(roles, 'database'))[0]).toBe('Database Optimizer')
    expect(names(searchRoles(roles, 'brand guardian'))[0]).toBe('Brand Guardian')
    expect(names(searchRoles(roles, 'founding engineer'))[0]).toBe('Founding Engineer')
  })

  it('knows titles: "cto" is the CTO role, then the roles an engineering leader reaches for', () => {
    const hits = names(searchRoles(roles, 'cto'))
    expect(hits[0]).toBe('CTO')
    expect(hits.slice(1, 6)).toEqual(expect.arrayContaining(['Principal Engineer', 'VP of Engineering']))
  })

  it('reads "chief technology officer" as the CTO role although no word of it is in the name', () => {
    expect(names(searchRoles(roles, 'chief technology officer'))[0]).toBe('CTO')
  })

  it('does not take a two-letter abbreviation for the start of other words', () => {
    const hits = names(searchRoles(roles, 'fe'))
    expect(hits[0]).toBe('Frontend Developer')
    expect(hits).not.toContain('Feedback Synthesizer')
  })

  it('expands what people type: marketing, devops, seo', () => {
    expect(names(searchRoles(roles, 'marketing')).slice(0, 4)).toEqual(expect.arrayContaining(['Head of Marketing', 'Email Marketing Strategist']))
    expect(names(searchRoles(roles, 'devops'))[0]).toBe('DevOps Automator')
    expect(names(searchRoles(roles, 'seo'))[0]).toBe('SEO Specialist')
    expect(names(searchRoles(roles, 'sre'))).toContain('SRE (Site Reliability Engineer)')
  })

  it('forgives typos', () => {
    expect(names(searchRoles(roles, 'fronted developr'))[0]).toBe('Frontend Developer')
    expect(names(searchRoles(roles, 'databse optimiser'))[0]).toBe('Database Optimizer')
  })

  it('narrows as words are added', () => {
    const one = searchRoles(roles, 'engineer').length
    const two = searchRoles(roles, 'engineer security').length
    expect(two).toBeLessThan(one)
    expect(names(searchRoles(roles, 'engineer security'))[0]).toBe('Application Security Engineer')
  })

  it('matches as you type: a prefix of three letters or more', () => {
    expect(names(searchRoles(roles, 'fron'))[0]).toBe('Frontend Developer')
  })

  it('says which words found a role', () => {
    expect(searchRoles(roles, 'seo content')[0]!.matched).toEqual(['seo', 'content'])
  })

  it('is empty for nothing, and for a word nothing knows', () => {
    expect(searchRoles(roles, '')).toEqual([])
    expect(searchRoles(roles, '   ')).toEqual([])
    expect(searchRoles(roles, 'zzzzqqqq')).toEqual([])
  })

  it('is deterministic and respects the limit', () => {
    expect(searchRoles(roles, 'engineer')).toEqual(searchRoles(roles, 'engineer'))
    expect(searchRoles(roles, 'engineer', 3)).toHaveLength(3)
  })
})

describe('suggestRoles', () => {
  it('"write landing page copy": Content Creator first or second, with SEO Specialist and Brand Guardian among the best fits', () => {
    const hits = suggestRoles(roles, 'write landing page copy', 5)
    const top = names(hits)
    expect(top.slice(0, 2)).toContain('Content Creator')
    expect(top).toEqual(expect.arrayContaining(['Content Creator', 'SEO Specialist', 'Brand Guardian']))
  })

  it('"our postgres queries are slow": the Database Optimizer, and it says why', () => {
    const [first] = suggestRoles(roles, 'our postgres queries are slow', 3)
    expect(roles.find((r) => r.id === first!.id)!.name).toBe('Database Optimizer')
    expect(first!.matched).toEqual(expect.arrayContaining(['queries', 'postgres']))
  })

  it('shows the words you typed before the synonyms that helped', () => {
    const [first] = suggestRoles(roles, 'our postgres queries are slow', 1)
    const typed = new Set(['postgres', 'queries', 'slow'])
    const firstTyped = first!.matched.findIndex((m) => typed.has(m))
    const lastTyped = first!.matched.findLastIndex((m) => typed.has(m))
    const firstExtra = first!.matched.findIndex((m) => !typed.has(m))
    expect(firstTyped).toBe(0)
    if (firstExtra >= 0) expect(lastTyped).toBeLessThan(firstExtra)
  })

  it('finds a review, a plan, a refactor', () => {
    expect(names(suggestRoles(roles, 'check this code for security holes', 3))).toContain('Application Security Engineer')
    expect(names(suggestRoles(roles, 'plan the next quarter roadmap', 3))).toEqual(expect.arrayContaining(['Product Manager']))
    expect(names(suggestRoles(roles, 'we need to hire a head of design', 2))).toContain('Head of Design')
  })

  it('returns at most n, nothing for no words, and nothing for words no role uses', () => {
    expect(suggestRoles(roles, 'write landing page copy', 2).length).toBeLessThanOrEqual(2)
    expect(suggestRoles(roles, '', 3)).toEqual([])
    expect(suggestRoles(roles, 'the and of', 3)).toEqual([])
    expect(suggestRoles(roles, 'zzzzqqqq xxxxyyyy', 3)).toEqual([])
    expect(suggestRoles(roles, 'database', 0)).toEqual([])
  })

  it('ranks the same way every time', () => {
    expect(suggestRoles(roles, 'write landing page copy', 5)).toEqual(suggestRoles(roles, 'write landing page copy', 5))
  })

  it('reads a long task in well under a frame', () => {
    const t0 = performance.now()
    for (let i = 0; i < 20; i++) suggestRoles(roles, 'we need to investigate why our checkout page loads slowly on mobile and fix the images and queries behind it', 3)
    expect((performance.now() - t0) / 20).toBeLessThan(25)
  })
})
