import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createScanner, readDivisions, type ScanPaths } from './roles-catalog'

/** A small synthetic clone, an agents folder, a custom folder and a built-in folder: never the real ones on this PC. */
let base: string
const dir = (...p: string[]): string => join(base, ...p)
const persona = (name: string, extra = ''): string => `---\nname: ${name}\ndescription: ${name} does things.\nemoji: 🤖\nvibe: ${name} vibe\n${extra}---\n\n# ${name}\n\nYou are ${name}.\n`
const put = (rel: string, text: string): void => {
  mkdirSync(join(dir(rel), '..'), { recursive: true })
  writeFileSync(dir(rel), text)
}
const paths = (over: Partial<ScanPaths> = {}): ScanPaths => ({
  repo: [{ path: dir('clone'), source: 'default' }],
  configured: null,
  suggested: dir('suggested'),
  installed: dir('agents'),
  custom: dir('custom'),
  builtin: dir('builtin'),
  ...over
})

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'agentdeck-roles-cat-'))
  put('clone/divisions.json', JSON.stringify({ divisions: { engineering: { label: 'Eng', icon: 'Code', color: '#3B82F6' }, bad: { label: '', icon: 'x y', color: 'red' } } }))
  put('clone/engineering/engineering-frontend-developer.md', persona('Frontend Developer'))
  put('clone/engineering/engineering-backend-architect.md', persona('Backend Architect'))
  put('clone/design/design-ui-designer.md', persona('UI Designer'))
  put('clone/quantum-computing/q.md', persona('Qubit Whisperer'))
  put('clone/security/security-architect.md', persona('Security Architect'))
  put('clone/README.md', '# readme')
  put('clone/CONTRIBUTING_zh-CN.md', 'no front matter')
  put('clone/strategy/playbook.md', persona('Not A Persona'))
  put('clone/integrations/claude-code/x.md', persona('Converted Copy'))
  put('clone/.github/agent.md', persona('Hidden'))
  put('clone/engineering/notes.md', '# no front matter here')
  put('agents/engineering-frontend-developer.md', persona('Frontend Developer'))
  put('agents/planner.md', persona('planner'))
  put('custom/mine.md', persona('Mine'))
  put('builtin/cto.md', persona('CTO'))
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

describe('readDivisions', () => {
  it('merges the clone\'s divisions.json over the built-in table and drops invalid entries', () => {
    const d = readDivisions(dir('clone'))
    expect(d.engineering).toEqual({ label: 'Eng', icon: 'Code', color: '#3B82F6' })
    expect(d.design?.label).toBe('Design')
    expect(d.bad).toBeUndefined()
  })

  it('falls back to the built-in table when there is no clone, no file or a broken one', () => {
    expect(readDivisions(null).marketing?.label).toBe('Marketing')
    expect(readDivisions(dir('missing')).marketing?.label).toBe('Marketing')
    put('broken/divisions.json', '{ not json')
    expect(readDivisions(dir('broken')).marketing?.label).toBe('Marketing')
  })
})

describe('scan', () => {
  it('reads the four places into one catalog with counts', async () => {
    const s = await createScanner().scan(paths())
    expect(s.status).toMatchObject({ repoFound: true, repoSource: 'default', installedFound: true })
    expect(s.status.counts).toMatchObject({ agency: 5, installed: 1, installedFlagged: 2, custom: 1, builtin: 1, total: 8, duplicates: 0 })
    expect(s.roles.map((r) => r.name).sort()).toEqual(['Backend Architect', 'CTO', 'Frontend Developer', 'Mine', 'Qubit Whisperer', 'Security Architect', 'UI Designer', 'planner'])
    expect(s.roles.find((r) => r.name === 'Frontend Developer')).toMatchObject({ source: 'agency', installed: true, agentName: 'Frontend Developer', division: 'engineering', divisionLabel: 'Eng' })
    expect(s.roles.find((r) => r.name === 'planner')).toMatchObject({ source: 'installed', division: 'yours' })
    expect(s.roles.find((r) => r.name === 'Mine')).toMatchObject({ source: 'custom', division: 'custom' })
    expect(s.roles.find((r) => r.name === 'CTO')).toMatchObject({ source: 'builtin', division: 'leadership' })
  })

  it('maps divisions from folder names, with a fallback for a folder the table does not know', async () => {
    const s = await createScanner().scan(paths())
    expect(s.divisions.map((d) => d.label)).toEqual(['Leadership', 'Design', 'Eng', 'Quantum Computing', 'Security', 'Custom', 'Your agents'])
    expect(s.divisions.find((d) => d.id === 'quantum-computing')).toMatchObject({ icon: 'Folder', count: 1 })
  })

  it('skips README, CONTRIBUTING, strategy, integrations, hidden folders and files without a name, but not security-architect', async () => {
    const s = await createScanner().scan(paths())
    const names = s.roles.map((r) => r.name)
    for (const nope of ['Not A Persona', 'Converted Copy', 'Hidden']) expect(names).not.toContain(nope)
    expect(names).toContain('Security Architect')
    expect(s.status.counts.skipped).toBe(1) // engineering/notes.md has no front matter; a file in the clone's root is not counted
  })

  it('has the promptChars of the text after the front matter', async () => {
    const s = await createScanner().scan(paths())
    const role = s.roles.find((r) => r.name === 'UI Designer')!
    expect(role.promptChars).toBeGreaterThan(10)
    expect(role.promptChars).toBeLessThan(80)
  })

  it('says what is missing instead of failing: no clone, a configured folder that is gone, no agents folder', async () => {
    const s = await createScanner().scan(paths({ repo: [{ path: dir('nope'), source: 'config' }], configured: dir('nope'), installed: dir('nope2') }))
    expect(s.status).toMatchObject({ repoFound: false, repoPath: null, repoSource: null, configuredMissing: true, installedFound: false })
    expect(s.status.counts).toMatchObject({ agency: 0, builtin: 1, custom: 1 })
  })

  it('takes the first clone folder that exists, in order', async () => {
    put('other/engineering/x.md', persona('Other Role'))
    const s = await createScanner().scan(paths({ repo: [{ path: dir('missing'), source: 'config' }, { path: dir('other'), source: 'claude-config' }, { path: dir('clone'), source: 'default' }] }))
    expect(s.status).toMatchObject({ repoSource: 'claude-config' })
    expect(s.roles.map((r) => r.name)).toContain('Other Role')
    expect(s.roles.map((r) => r.name)).not.toContain('UI Designer')
  })
})

describe('duplicates and collisions in a real folder layout', () => {
  it('keeps the copy that is installed when the clone has two files for one name, and counts the other', async () => {
    put('clone/design/design-frontend-developer.md', persona('Frontend Developer'))
    const s = await createScanner().scan(paths())
    expect(s.status.counts.duplicates).toBe(1)
    const kept = s.roles.filter((r) => r.name === 'Frontend Developer')
    expect(kept).toHaveLength(1)
    expect(kept[0]!.key).toBe('agency:engineering/engineering-frontend-developer.md')
  })

  it('lists a quoted agency-prefixed installed copy as the same role and uses its exact name for --agent', async () => {
    put('agents/engineering-backend-architect.md', persona('"agency-backend-architect"'))
    const s = await createScanner().scan(paths())
    const role = s.roles.find((r) => r.name === 'Backend Architect')!
    expect(role).toMatchObject({ installed: true, agentName: 'agency-backend-architect' })
  })

  it('keeps an agency "Chief of Staff" and an installed `chief-of-staff` apart with distinct ids', async () => {
    put('clone/specialized/specialized-chief-of-staff.md', persona('Chief of Staff'))
    put('agents/chief-of-staff.md', persona('chief-of-staff'))
    const s = await createScanner().scan(paths())
    const ids = s.roles.filter((r) => /chief/.test(r.id)).map((r) => `${r.id}:${r.source}`).sort()
    expect(ids).toEqual(['chief-of-staff-installed:installed', 'chief-of-staff:agency'])
  })

  it('survives a malformed file, a huge one and hostile names', async () => {
    put('clone/engineering/bad.md', '---\nname: "unclosed\ndescription: [\n---\n')
    put('clone/engineering/huge.md', `${persona('Huge Role')}${'x'.repeat(2_000_000)}`)
    put('clone/engineering/hostile.md', persona('../../etc/passwd'))
    put('clone/engineering/bidi.md', persona(`Evil${String.fromCharCode(0x202e)}Name`))
    const s = await createScanner().scan(paths())
    expect(s.roles.find((r) => r.name === 'Huge Role')?.promptChars).toBeGreaterThan(2_000_000)
    expect(s.roles.find((r) => r.name === '../../etc/passwd')?.id).toBe('etc-passwd')
    expect(s.roles.find((r) => r.name === 'EvilName')).toBeTruthy()
    // an unclosed quote reads as a value, not an error
    expect(s.roles.length).toBeGreaterThanOrEqual(8)
  })
})

describe('cache and speed', () => {
  it('reads a changed file again and forgets a deleted one', async () => {
    const scanner = createScanner()
    const first = await scanner.scan(paths())
    expect(first.roles.map((r) => r.name)).toContain('UI Designer')
    put('clone/design/design-ui-designer.md', persona('UI Designer Renamed'))
    const future = new Date(Date.now() + 5_000)
    utimesSync(dir('clone/design/design-ui-designer.md'), future, future)
    rmSync(dir('clone/security/security-architect.md'))
    const second = await scanner.scan(paths())
    const names = second.roles.map((r) => r.name)
    expect(names).toContain('UI Designer Renamed')
    expect(names).not.toContain('UI Designer')
    expect(names).not.toContain('Security Architect')
  })

  it('reads about 350 files well inside the budget', async () => {
    for (let i = 0; i < 300; i++) put(`clone/engineering/e-${i}.md`, persona(`Role Number ${i}`))
    for (let i = 0; i < 50; i++) put(`agents/a-${i}.md`, persona(`Agent Number ${i}`))
    const t0 = Date.now()
    const s = await createScanner().scan(paths())
    const ms = Date.now() - t0
    expect(s.status.counts.total).toBeGreaterThan(350)
    // The target on the real machine is under 200 ms (measured 96 ms for 353 files); a loaded CI runner gets room.
    expect(ms).toBeLessThan(1_500)
  })
})
