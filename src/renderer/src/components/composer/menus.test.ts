import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { RoleSummary } from '@shared/roles'
import { fixtureDivisions, fixtureRoles } from './fixture'
import { MentionList } from './MentionList'
import { MentionMenu } from './MentionMenu'
import { groupRows, optionsOf } from './rank'
import { SlashList, SLASH_LIST_ID } from './SlashList'
import { indexFor } from './useRoleIndex'
import { MENTION_LIST_ID, type Menus } from './useMenus'
import type { Completion } from './slash'

const many: RoleSummary[] = Array.from({ length: 350 }, (_, i) => ({
  ...fixtureRoles()[0]!, id: `role-${i}`, name: `Role ${i}`, division: `d${i % 12}`, divisionLabel: `Division ${i % 12}`, installed: false, agentName: null
}))
const divisions = Array.from({ length: 12 }, (_, i) => ({ id: `d${i}`, label: `Division ${i}`, icon: 'Code', color: '#3B82F6', count: 0 }))
const none = { pinned: [], recent: [] }

describe('the @ list with about 350 agents', () => {
  const rows = groupRows(many, divisions, none)
  const html = (active: number): string => renderToString(createElement(MentionList, { rows, active, listId: MENTION_LIST_ID, label: 'Agents', onPick: () => undefined, onActive: () => undefined }))

  it('draws a window of the rows, not all of them, so it opens at once', () => {
    const out = html(0)
    const drawn = out.match(/role="option"/g)?.length ?? 0
    expect(drawn).toBeGreaterThan(5)
    expect(drawn).toBeLessThan(25)
  })

  it('tells a screen reader the whole size and each option its place', () => {
    const out = html(0)
    expect(out).toContain('role="listbox"')
    expect(out).toContain('aria-label="Agents"')
    expect(out).toContain('aria-setsize="350"')
    expect(out).toContain('aria-posinset="1"')
    expect(out.match(/aria-selected="true"/g)).toHaveLength(1)
  })

  it('always draws the highlighted option, so aria-activedescendant has something to point at, wherever it is', () => {
    const out = html(300)
    expect(out).toContain(`id="${MENTION_LIST_ID}-${optionsOf(rows)[300]!.id}"`)
    expect(out).toContain('aria-posinset="301"')
  })

  it('draws group names as plain text that a screen reader skips (each option names its own division)', () => {
    const out = html(0)
    expect(out).toMatch(/role="presentation"[^>]*aria-hidden="true"|aria-hidden="true"[^>]*role="presentation"/)
    expect(out).toContain('Division 0')
  })

  it('shows each agent as a face, a name, its division, its one line and the handle to type', () => {
    const out = renderToString(
      createElement(MentionList, { rows: groupRows(fixtureRoles(), fixtureDivisions(), none), active: 0, listId: MENTION_LIST_ID, label: 'Agents', onPick: () => undefined, onActive: () => undefined })
    )
    expect(out).toContain('CTO')
    expect(out).toContain('Leadership')
    expect(out).toContain('🧭')
    expect(out).toMatch(/@(<!-- -->)?cto/)
    expect(out).toContain('Calm, plain-spoken')
  })

  it('walks only the roles with the keys: headers are not options', () => {
    expect(optionsOf(rows)).toHaveLength(350)
  })
})

describe('the / list', () => {
  const item = (name: string, kind: Completion['kind'] = 'command'): Completion => ({ id: `${kind}:${name}`, kind, name, insert: `/${name} `, description: `About ${name}`, hint: '[x]' })
  const html = (items: Completion[], note: 'load' | 'none' | null = null): string =>
    renderToString(createElement(SlashList, { items, index: 0, note, onPick: () => undefined, onActive: () => undefined }))

  it('is a labelled listbox of options with one selected', () => {
    const out = html([item('compact'), item('aside', 'skill')])
    expect(out).toContain(`id="${SLASH_LIST_ID}"`)
    expect(out).toContain('aria-label="Commands and skills"')
    expect(out.match(/role="option"/g)).toHaveLength(2)
    expect(out.match(/aria-selected="true"/g)).toHaveLength(1)
    expect(out).toMatch(/\/(<!-- -->)?compact/)
    expect(out).toContain('>skill<')
  })

  it('says how to get the list before any conversation has reported, and when nothing matches, in words', () => {
    expect(html([], 'load')).toContain('Start the conversation to load them')
    expect(html([], 'none')).toContain('Nothing matches')
    expect(html([], 'none')).not.toContain('role="listbox"')
  })
})

describe('the @ menu when there is nothing to list', () => {
  const empty = (): Menus => ({
    kind: 'mention', trigger: { char: '@', query: 'zz', start: 0, end: 3 }, open: true, listed: false, index: 0, count: 0, activeId: undefined, listId: undefined,
    slash: { items: [], note: null }, mention: { rows: [], options: [] }, move: () => undefined, setActive: () => undefined, dismiss: () => undefined, slashAt: () => null, mentionAt: () => null
  })
  const html = (ready: boolean, full = false): string => renderToString(createElement(MentionMenu, { menus: empty(), ready, full, room: 400, onPick: () => undefined }))

  it('says no agent matches, or that they are still being read, and offers no key hints for nothing', () => {
    expect(html(true)).toContain('No agent matches')
    expect(html(true)).not.toContain('move')
    expect(html(false)).toContain('Reading the agents')
  })

  it('says the limit in words when a session already has all the agents it can', () => {
    expect(html(true, true)).toContain('A lead and four helpers is the most')
  })
})

describe('one index per catalog content', () => {
  const catalog = (pinned: string[]) => ({ roles: fixtureRoles(), divisions: fixtureDivisions(), pinned, skills: [], skillsPath: '', status: {} as never })

  it('gives the same index for the same roles, even when the catalog object is new (the demo rebuilds it on every read)', () => {
    expect(indexFor(catalog(['cto']))).toBe(indexFor(catalog(['cto'])))
  })

  it('gives a new one when the roles or the pins change, and looks agents up by id', () => {
    const a = indexFor(catalog(['cto']))
    const b = indexFor(catalog(['qa']))
    expect(a).not.toBe(b)
    expect(b.has('cto')).toBe(true)
    expect(b.lookup.name('cto')).toBe('CTO')
    expect(b.lookup.agent('cto')).toBe('CTO')
    expect(b.lookup.agent('gis-qa-engineer')).toBeNull()
    expect(b.lookup.name('no-such-role')).toBe('no-such-role')
  })

  it('is empty and not ready before the catalog has loaded', () => {
    const nothing = indexFor(null)
    expect(nothing.ready).toBe(false)
    expect(nothing.roles).toEqual([])
    expect(nothing.has('cto')).toBe(false)
  })
})
