import { describe, expect, it } from 'vitest'
import { DEFAULT_DIVISIONS, buildCatalog, divisionMeta, toSummary, type RawRole } from './role-catalog'
import type { RoleSource } from './roles'

const raw = (source: RoleSource, key: string, name: string, extra: Partial<RawRole> = {}): RawRole => ({
  source,
  key: `${source}:${key}`,
  stem: key.replace(/^.*\//, '').replace(/\.md$/, ''),
  name,
  description: `${name} does things.`,
  vibe: `${name} vibe`,
  emoji: '🤖',
  division: source === 'agency' ? key.split('/')[0]! : source === 'builtin' ? 'leadership' : source === 'custom' ? 'custom' : 'yours',
  promptChars: 1_000,
  ...extra
})

const byName = (roles: ReturnType<typeof buildCatalog>['roles'], name: string) => roles.find((r) => r.name === name)!

describe('buildCatalog: one role from several places', () => {
  it('flags a clone role installed in Claude Code and takes the installed name for --agent', () => {
    const { roles } = buildCatalog([
      raw('agency', 'engineering/engineering-frontend-developer.md', 'Frontend Developer'),
      raw('installed', 'engineering-frontend-developer.md', 'Frontend Developer')
    ])
    expect(roles).toHaveLength(1)
    expect(roles[0]).toMatchObject({ id: 'frontend-developer', source: 'agency', division: 'engineering', installed: true, agentName: 'Frontend Developer' })
  })

  it('matches the installed copy by file name even when the names differ, and prefers the installed exact name', () => {
    const { roles } = buildCatalog([
      raw('agency', 'engineering/engineering-frontend-developer.md', 'Frontend Developer'),
      raw('installed', 'engineering-frontend-developer.md', 'frontend developer (local)')
    ])
    expect(roles).toHaveLength(1)
    expect(roles[0]).toMatchObject({ name: 'Frontend Developer', installed: true, agentName: 'frontend developer (local)' })
  })

  it('treats a conversion tool\'s "agency-" prefix as the same role', () => {
    const { roles } = buildCatalog([
      raw('agency', 'engineering/engineering-frontend-developer.md', 'Frontend Developer'),
      raw('installed', 'copy.md', 'agency-frontend-developer')
    ])
    expect(roles).toHaveLength(1)
    expect(roles[0]).toMatchObject({ installed: true, agentName: 'agency-frontend-developer' })
  })

  it('lists installed agents the clone does not have under Your agents', () => {
    const { roles, divisions } = buildCatalog([raw('installed', 'planner.md', 'planner')])
    expect(roles[0]).toMatchObject({ id: 'planner', source: 'installed', division: 'yours', divisionLabel: 'Your agents', installed: true, agentName: 'planner' })
    expect(divisions.map((d) => d.id)).toEqual(['custom', 'yours'])
  })

  it('keeps one of two clone files that name the same role: the installed copy, else the first by path', () => {
    const a = raw('agency', 'engineering/a-frontend.md', 'Frontend Developer')
    const b = raw('agency', 'design/b-frontend.md', 'Frontend Developer')
    const none = buildCatalog([a, b])
    expect(none.roles).toHaveLength(1)
    expect(none.roles[0]!.key).toBe('agency:design/b-frontend.md')
    expect(none.duplicates).toBe(1)
    const installed = buildCatalog([a, b, raw('installed', 'a-frontend.md', 'Frontend Developer')])
    expect(installed.roles).toHaveLength(1)
    expect(installed.roles[0]!.key).toBe('agency:engineering/a-frontend.md')
    expect(installed.duplicates).toBe(1)
  })

  it('compares names without regard to case or spacing', () => {
    const { roles, duplicates } = buildCatalog([raw('agency', 'x/one.md', 'Chief  of Staff'), raw('agency', 'x/two.md', 'chief of staff')])
    expect(roles).toHaveLength(1)
    expect(duplicates).toBe(1)
  })
})

describe('buildCatalog: ids', () => {
  it('keeps two different roles with one slug, the higher source holding the plain slug', () => {
    const { roles } = buildCatalog([raw('installed', 'chief-of-staff.md', 'chief-of-staff'), raw('agency', 'specialized/specialized-chief-of-staff.md', 'Chief of Staff')])
    expect(roles.map((r) => `${r.id}=${r.name}`).sort()).toEqual(['chief-of-staff-installed=chief-of-staff', 'chief-of-staff=Chief of Staff'])
  })

  it('lets a custom role keep its slug over an agency role of the same name', () => {
    const { roles } = buildCatalog([raw('agency', 'engineering/fe.md', 'Frontend Developer'), raw('custom', 'frontend-developer.md', 'Frontend Developer')])
    expect(roles.map((r) => `${r.id}:${r.source}`).sort()).toEqual(['frontend-developer-agency:agency', 'frontend-developer:custom'])
  })

  it('takes a custom role\'s id from its file name, so renaming it keeps the id', () => {
    const { roles } = buildCatalog([raw('custom', 'my-role.md', 'A Completely Different Name')])
    expect(roles[0]!.id).toBe('my-role')
  })

  it('never makes an installed flag or an agent name for a custom or built-in role', () => {
    const { roles } = buildCatalog([raw('builtin', 'cto.md', 'CTO'), raw('custom', 'cto2.md', 'Other'), raw('installed', 'cto.md', 'CTO')])
    expect(byName(roles, 'CTO')).toMatchObject({ source: 'builtin', installed: false, agentName: null })
    expect(byName(roles, 'Other')).toMatchObject({ installed: false, agentName: null })
  })

  it('does not hand an unsafe installed name to --agent', () => {
    const { roles } = buildCatalog([raw('installed', 'x.md', '--dangerously-skip-permissions'), raw('installed', 'y.md', 'a"b')])
    expect(roles.every((r) => r.installed && r.agentName === null)).toBe(true)
  })

  it('is deterministic whatever order the files were found in', () => {
    const input = [
      raw('agency', 'engineering/a.md', 'Alpha'),
      raw('agency', 'design/b.md', 'Alpha'),
      raw('installed', 'a.md', 'Alpha'),
      raw('installed', 'zeta.md', 'Zeta'),
      raw('custom', 'alpha.md', 'Alpha'),
      raw('builtin', 'zeta.md', 'Zeta')
    ]
    const forward = JSON.stringify(buildCatalog(input).roles)
    expect(JSON.stringify(buildCatalog([...input].reverse()).roles)).toBe(forward)
    expect(JSON.stringify(buildCatalog([input[3]!, input[0]!, input[5]!, input[1]!, input[4]!, input[2]!]).roles)).toBe(forward)
  })
})

describe('buildCatalog: divisions', () => {
  it('puts Leadership first, then the clone\'s divisions by label, then Custom and Your agents', () => {
    const { divisions } = buildCatalog([
      raw('installed', 'p.md', 'p'),
      raw('agency', 'marketing/m.md', 'M'),
      raw('agency', 'design/d.md', 'D'),
      raw('builtin', 'cto.md', 'CTO'),
      raw('agency', 'game-development/g.md', 'G')
    ])
    expect(divisions.map((d) => d.label)).toEqual(['Leadership', 'Design', 'Game Development', 'Marketing', 'Custom', 'Your agents'])
    expect(divisions.map((d) => d.count)).toEqual([1, 1, 1, 1, 0, 1])
  })

  it('takes label, icon and colour from the division table, and invents them for a new folder', () => {
    expect(divisionMeta('engineering', DEFAULT_DIVISIONS)).toEqual({ label: 'Engineering', icon: 'Code', color: '#3B82F6' })
    const novel = divisionMeta('quantum-computing', DEFAULT_DIVISIONS)
    expect(novel).toMatchObject({ label: 'Quantum Computing', icon: 'Folder' })
    expect(novel.color).toMatch(/^#[0-9A-F]{6}$/)
    expect(divisionMeta('quantum-computing', DEFAULT_DIVISIONS)).toEqual(novel)
  })

  it('sorts roles by division order then name', () => {
    const { roles } = buildCatalog([raw('agency', 'design/z.md', 'Zed'), raw('agency', 'design/a.md', 'Ann'), raw('builtin', 'cto.md', 'CTO'), raw('agency', 'engineering/b.md', 'Bob')])
    expect(roles.map((r) => r.name)).toEqual(['CTO', 'Ann', 'Zed', 'Bob'])
  })
})

describe('toSummary', () => {
  it('drops the key main uses to find a file', () => {
    const { roles } = buildCatalog([raw('builtin', 'cto.md', 'CTO')])
    expect(Object.keys(toSummary(roles[0]!)).sort()).toEqual(
      ['agentName', 'color', 'description', 'division', 'divisionLabel', 'emoji', 'id', 'installed', 'name', 'promptChars', 'source', 'vibe'].sort()
    )
  })
})
