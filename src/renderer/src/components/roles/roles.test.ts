import { createElement, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import * as Tooltip from '@radix-ui/react-tooltip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { demoRolesCatalog, resetDemoRoles } from '@/demo/roles'
import { demoSnapshot } from '@/demo/snapshot'
import { useUi } from '@/store'
import { RolesPage } from '../pages/Roles'
import { DivisionRail } from './DivisionRail'
import { installNote } from './RoleDrawer'
import { RoleBrowser } from './RoleBrowser'
import { RoleCard } from './RoleCard'
import { PromptPreview, blocks } from './PromptPreview'
import { RepoSetup } from './Sources'
import { roleIcon } from './icons'
import { sectionsFor } from './logic'
import { useRoleCommands } from './palette'

const NOW = Date.UTC(2026, 10, 5, 14, 0)
const { roles, divisions, status } = demoRolesCatalog()
const role = (name: string) => roles.find((r) => r.name === name)!
const noop = (): void => undefined
/** The app wraps everything in one tooltip provider; a server render of a part needs the same. */
const render = (el: ReactElement): string => renderToString(createElement(Tooltip.Provider, null, el))

beforeEach(() => {
  resetDemoRoles()
  vi.stubGlobal('window', {})
  useUi.setState({ snapshot: demoSnapshot(NOW), now: NOW, link: 'up', nav: { page: 'roles' } })
  Object.assign(useUi.getInitialState(), useUi.getState())
})
afterEach(() => vi.unstubAllGlobals())

describe('RoleCard', () => {
  const html = (over: Partial<Parameters<typeof RoleCard>[0]> = {}): string =>
    render(createElement('ul', null, createElement(RoleCard, { role: role('Frontend Developer'), pinned: false, active: true, showDivision: true, onOpen: noop, onPin: noop, ...over })))

  it('is a button that opens the role, with the name, the one-liner, the description and where it comes from', () => {
    const h = html()
    expect(h).toContain('data-role-card="frontend-developer"')
    expect(h).toContain('Frontend Developer')
    expect(h).toContain('Builds responsive, accessible web apps')
    expect(h).toContain('Agency')
    expect(h).toContain('Engineering')
    expect(h).toContain('Installed')
  })

  it('points aria-describedby at a description that is in the card', () => {
    const h = html()
    const id = /aria-describedby="([^"]+)"/.exec(h)![1]!
    expect(h).toContain(`id="${id}"`)
  })

  it('has a pin button with its state and a name that says whose', () => {
    expect(html({ pinned: false })).toContain('aria-label="Pin Frontend Developer"')
    expect(html({ pinned: false })).toContain('aria-pressed="false"')
    expect(html({ pinned: true })).toContain('aria-label="Unpin Frontend Developer"')
    expect(html({ pinned: true })).toContain('aria-pressed="true"')
  })

  it('is a tab stop only when it is the active card', () => {
    expect(html({ active: true })).not.toContain('tabindex="-1"')
    expect(html({ active: false }).match(/tabindex="-1"/g)).toHaveLength(2) // the card and its pin
  })

  it('shows the words that found it under a search', () => {
    expect(html({ matched: ['copy', 'seo'] })).toContain('matched: copy, seo')
  })

  it('renders a hostile name and description as text', () => {
    const evil = { ...role('CTO'), name: '<img src=x onerror=alert(1)>', description: '<script>alert(1)</script>', vibe: '"><svg onload=alert(1)>' }
    const h = html({ role: evil })
    expect(h).not.toMatch(/<img|<script|<svg onload/)
    expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(h).toContain('&lt;svg onload=alert(1)&gt;')
  })
})

describe('PromptPreview', () => {
  it('reads headings, lists, paragraphs and fences', () => {
    expect(blocks('# One\n\nA para\nover two lines.\n\n- a\n- b\n  more b\n\n1. x\n2. y\n\n```\ncode\n  here\n```\n')).toEqual([
      { kind: 'heading', text: 'One' },
      { kind: 'para', text: 'A para over two lines.' },
      { kind: 'list', ordered: false, items: ['a', 'b more b'] },
      { kind: 'list', ordered: true, items: ['x', 'y'] },
      { kind: 'code', text: 'code\n  here' }
    ])
  })

  it('shows markup in a role as the characters it is: nothing runs, nothing links, nothing loads', () => {
    const h = renderToString(createElement(PromptPreview, { text: '# <b>Hi</b>\n\n<script>alert(1)</script> [x](javascript:alert(1)) ![i](http://evil/x.png) <img src=x onerror=alert(1)>\n\n- <a href="javascript:1">l</a>' }))
    expect(h).not.toMatch(/<(script|img|a|b|svg)[\s>]/)
    expect(h).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(h).toContain('[x](javascript:alert(1))')
    expect(h).not.toContain('<ul class="list-disc pl-5"><li class="pl-1 text-pretty"><a')
  })

  it('formats **bold** and `code` and nothing else', () => {
    const h = renderToString(createElement(PromptPreview, { text: 'Say **this** and `that`, not *those*.' }))
    expect(h).toContain('<strong')
    expect(h).toContain('<code')
    expect(h).toContain('*those*')
  })
})

describe('DivisionRail', () => {
  const rail = (current: Parameters<typeof DivisionRail>[0]['current']): string =>
    render(createElement(DivisionRail, { divisions, total: roles.length, pinned: 2, current, onChoose: noop, footer: createElement('p', null, 'footer') }))

  it('lists All roles, Pinned and the divisions with counts, Leadership first', () => {
    const h = rail({ kind: 'all' })
    expect(h.indexOf('All roles')).toBeLessThan(h.indexOf('Pinned'))
    expect(h.indexOf('Pinned')).toBeLessThan(h.indexOf('Leadership'))
    expect(h.indexOf('Leadership')).toBeLessThan(h.indexOf('Engineering'))
    expect(h).toContain('footer')
  })

  it('marks the current choice and makes it the one tab stop', () => {
    const h = rail({ kind: 'division', id: 'engineering' })
    expect(h.match(/aria-current="true"/g)).toHaveLength(1)
    expect(h.match(/tabindex="0"/g)).toHaveLength(1)
    expect(/aria-current="true"[^>]*>|<button[^>]*aria-current="true"/.test(h)).toBe(true)
    expect(h.match(/tabindex="-1"/g)!.length).toBe(divisions.length + 1)
  })
})

describe('RoleBrowser', () => {
  const browser = (over: Partial<Parameters<typeof RoleBrowser>[0]> = {}): string =>
    render(
      createElement(RoleBrowser, { sections: null, flat: [], hits: null, pinned: [], showDivision: true, onOpen: noop, onPin: noop, onSeeAll: noop, empty: createElement('p', null, 'Nothing here'), ...over })
    )

  it('shows what it is given in the empty case', () => {
    expect(browser()).toContain('Nothing here')
  })

  it('groups the front page: a heading per section, one row of cards, and Show all where there are more', () => {
    const h = browser({ sections: sectionsFor(roles, divisions, ['cto']) })
    expect(h).toContain('>Pinned<')
    expect(h).toContain('>Leadership<')
    expect(h).toContain('aria-label="Show all 8 Engineering roles"')
    // one row of three for Engineering, not all eight
    const eng = h.slice(h.indexOf('id="section-engineering"'), h.indexOf('id="section-finance"'))
    expect(eng.match(/data-role-card=/g)).toHaveLength(3)
  })

  it('never repeats a card on the page: ids are unique, so aria-describedby and the arrow keys are sound', () => {
    const h = browser({ sections: sectionsFor(roles, divisions, ['cto', 'frontend-developer']), pinned: ['cto', 'frontend-developer'] })
    const ids = [...h.matchAll(/data-role-card="([^"]+)"/g)].map((m) => m[1])
    expect(new Set(ids).size).toBe(ids.length)
    const descs = [...h.matchAll(/ id="(role-desc-[^"]+)"/g)].map((m) => m[1])
    expect(new Set(descs).size).toBe(descs.length)
  })

  it('has exactly one tab stop among its cards', () => {
    const h = browser({ flat: roles.slice(0, 6) })
    expect(h.match(/data-role-card=/g)).toHaveLength(6)
    // each card: the card button and its pin; only the first card's pair is tabbable
    expect(h.match(/tabindex="-1"/g)).toHaveLength(10)
  })

  it('names the division on each card of a mixed list only', () => {
    expect(browser({ flat: [role('Frontend Developer')], showDivision: true })).toContain('Engineering')
    expect(browser({ flat: [role('Frontend Developer')], showDivision: false })).not.toContain('>Engineering<')
  })
})

describe('RolesPage (demo data)', () => {
  const page = (): string => render(createElement(RolesPage, { nav: { page: 'roles' } }))

  it('renders the title, the search, the filters, the rail and the front page', () => {
    const h = page()
    expect(h).toContain('>Roles</h1>')
    expect(h).toContain('aria-label="Search roles"')
    expect(h).toContain('Create a role')
    expect(h).toContain('aria-label="Reload roles"')
    expect(h).toMatch(/aria-pressed="false"[^>]*>Installed in Claude Code/)
    for (const d of divisions) expect(h).toContain(`>${d.label}<`)
    expect(h).toContain('>Pinned<')
    expect(h).toContain('Founding Engineer')
    expect(h).not.toContain('Add the agency roles') // the demo has the library
  })

  it('starts on a search when the sidebar sent one (a recent agent)', () => {
    const h = render(createElement(RolesPage, { nav: { page: 'roles', query: 'planner' } }))
    expect(h).toContain('value="planner"')
    expect(h).toContain('data-role-card="planner"')
    expect(h).not.toContain('data-role-card="cto"')
  })

  it('shows a calm empty state with a way out for a search nothing matches', () => {
    const h = render(createElement(RolesPage, { nav: { page: 'roles', query: 'zzzzqqqq' } }))
    expect(h).toContain('No role matches')
    expect(h).toContain('Clear search and filters')
    expect(h).toContain('Create a role')
  })
})

describe('RepoSetup (no clone found)', () => {
  const noRepo = { ...status, repoFound: false, repoPath: null, repoSource: null, suggestedPath: 'C:\\Users\\you\\.claude\\repos\\agency-agents' }

  it('gives the exact command, a Copy button, a way to point at a folder, and Reload', () => {
    const h = render(createElement(RepoSetup, { status: noRepo }))
    expect(h).toContain('git clone https://github.com/msitarzewski/agency-agents.git')
    expect(h).toContain('Copy')
    expect(h).toContain('Or use a copy you already have')
    expect(h).toContain('Browse')
    expect(h).toContain('Use this folder')
    expect(h).toContain('Reload roles')
    expect(h).toContain('never downloads anything itself')
  })

  it('says when the folder the user chose is gone', () => {
    const h = render(createElement(RepoSetup, { status: { ...noRepo, configuredPath: 'D:\\gone', configuredMissing: true } }))
    expect(h).toContain('D:\\gone')
    expect(h).toContain('is not there')
  })
})

describe('installNote', () => {
  it('says what installed means for each kind of role', () => {
    expect(installNote({ source: 'agency', installed: true, agentName: 'Frontend Developer' })).toMatchObject({ yes: true, text: expect.stringContaining('--agent "Frontend Developer"') })
    expect(installNote({ source: 'agency', installed: true, agentName: null })).toMatchObject({ yes: true, text: expect.stringContaining('as text') })
    expect(installNote({ source: 'agency', installed: false, agentName: null })).toMatchObject({ yes: false, text: expect.stringContaining('adds nothing to your agents folder') })
    expect(installNote({ source: 'custom', installed: false, agentName: null }).text).toContain('nothing goes into your agents folder')
    expect(installNote({ source: 'builtin', installed: false, agentName: null }).yes).toBe(false)
  })
})

describe('roleIcon', () => {
  it('maps the clone\'s icon names and falls back for one it does not know', () => {
    expect(roleIcon('Code')).toBe(roleIcon('Code'))
    expect(roleIcon('Crown')).not.toBe(roleIcon('NoSuchIcon'))
    expect(roleIcon('NoSuchIcon')).toBe(roleIcon('AlsoMissing'))
    for (const d of divisions) expect(roleIcon(d.icon)).toBeTruthy()
  })
})

describe('the palette finds roles', () => {
  it('offers matches for a typed query only, with the role\'s face, and opens the detail on the Roles page', () => {
    let typed: ReturnType<typeof useRoleCommands> = []
    let empty: ReturnType<typeof useRoleCommands> = [{ id: 'x', group: 'Go to', label: 'x', icon: roleIcon('Code'), run: noop }]
    const Probe = ({ q }: { q: string }) => {
      const found = useRoleCommands(q)
      if (q) typed = found
      else empty = found
      return null
    }
    renderToString(createElement(Probe, { q: 'cto' }))
    renderToString(createElement(Probe, { q: '' }))
    expect(empty).toEqual([])
    expect(typed[0]).toMatchObject({ group: 'Roles', label: 'CTO', emoji: expect.any(String), id: 'role:cto' })
    expect(typed.length).toBeLessThanOrEqual(6)
    typed[0]!.run()
    expect(useUi.getState().nav).toEqual({ page: 'roles', role: 'cto' })
  })
})
