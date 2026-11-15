import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/bridge'
import type { RoleDetail, RoleHit, RoleRepoResult, RoleSaveResult, RoleSkillsResult, RolesCatalog } from '@shared/roles'
import type { MainCtx } from './ctx'

// The real home folder and the real electron are never touched: a test home, and a stub for the one dialog.
const home = vi.hoisted(() => ({ dir: '' }))
vi.mock('node:os', async (orig) => ({ ...(await orig<typeof import('node:os')>()), homedir: () => home.dir }))
vi.mock('electron', () => ({ dialog: { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:\\picked\\agency-agents'] })) } }))

import { registerRoles, roles, toolList } from './roles'

let base: string
let handlers: Map<string, (...args: unknown[]) => unknown>
let demo = false
let dispose: () => void

const persona = (name: string, body = `You are ${name}.`): string => `---\nname: ${name}\ndescription: ${name} does things.\nemoji: 🤖\nvibe: ${name} vibe\n---\n\n# ${name}\n\n${body}\n`
const put = (rel: string, text: string): void => {
  mkdirSync(join(base, rel, '..'), { recursive: true })
  writeFileSync(join(base, rel), text)
}
/** Calls a channel as the page would. */
const call = async <T,>(channel: string, ...args: unknown[]): Promise<T> => handlers.get(channel)!({}, ...args) as T
const names = (c: RolesCatalog): string[] => c.roles.map((r) => r.name).sort()

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'agentdeck-roles-glue-'))
  home.dir = join(base, 'home')
  vi.stubEnv('CLAUDE_CONFIG_DIR', join(base, 'claude'))
  demo = false
  put('claude/repos/agency-agents/engineering/engineering-frontend-developer.md', persona('Frontend Developer', 'Build the UI. '.repeat(400)))
  put('claude/repos/agency-agents/design/design-ui-designer.md', persona('UI Designer'))
  put('claude/agents/engineering-frontend-developer.md', persona('Frontend Developer'))
  put('claude/agents/planner.md', persona('planner'))
  put('config.json', '{}')
  handlers = new Map()
  const ctx: MainCtx = {
    handle: (channel, fn) => void handlers.set(channel, (...a: unknown[]) => fn({} as never, ...a.slice(1))),
    collector: () => null,
    demo: () => demo,
    configFile: () => join(base, 'config.json'),
    userData: () => join(base, 'userData'),
    window: () => null
  }
  dispose = registerRoles(ctx)
})
afterEach(() => {
  dispose()
  vi.unstubAllEnvs()
  rmSync(base, { recursive: true, force: true })
})

const mine = { name: 'Release Notes Writer', emoji: '🧾', vibe: 'Turns a diff into notes.', description: 'Writes release notes.', prompt: '# Release Notes Writer\n\nYou write notes.' }

describe('listing', () => {
  it('lists the four sources, with the built-in leadership roles from resources/roles', async () => {
    const c = await call<RolesCatalog>(IPC.rolesList)
    expect(names(c)).toEqual(expect.arrayContaining(['CTO', 'Founding Engineer', 'Frontend Developer', 'UI Designer', 'planner']))
    expect(c.roles.filter((r) => r.source === 'builtin')).toHaveLength(7)
    expect(c.status).toMatchObject({ repoFound: true, repoSource: 'claude-config', installedFound: true })
    expect(c.divisions[0]!.id).toBe('leadership')
    expect(c.pinned).toEqual([])
  })

  it('never puts a file path in what the page gets', async () => {
    const c = await call<RolesCatalog>(IPC.rolesList)
    const text = JSON.stringify(c.roles)
    expect(text).not.toContain(base.replaceAll('\\', '\\\\'))
    expect(text).not.toContain('.md')
    expect(c.roles.every((r) => !('key' in r))).toBe(true)
  })

  it('reload sees a file added since, and the status carries a scan time', async () => {
    await call(IPC.rolesList)
    put('claude/repos/agency-agents/design/design-new.md', persona('Brand New Role'))
    expect(names(await call<RolesCatalog>(IPC.rolesReload))).toContain('Brand New Role')
    expect((await call<{ scannedAt: number }>(IPC.rolesStatus)).scannedAt).toBeGreaterThan(0)
  })

  it('answers search and suggest from the same catalog', async () => {
    const hits = await call<RoleHit[]>(IPC.rolesSearch, 'cto')
    expect(hits[0]).toMatchObject({ matched: ['cto'] })
    const suggested = await call<RoleHit[]>(IPC.rolesSuggest, 'design the user interface', 3)
    expect(suggested.length).toBeGreaterThan(0)
  })
})

describe('detail', () => {
  it('gives a capped plain-text preview of an agency role and says it was cut', async () => {
    const list = await call<RolesCatalog>(IPC.rolesList)
    const id = list.roles.find((r) => r.name === 'Frontend Developer')!.id
    const d = (await call<RoleDetail | null>(IPC.rolesGet, id))!
    expect(d.preview.length).toBeLessThanOrEqual(4096)
    expect(d.previewTruncated).toBe(true)
    expect(d.preview.startsWith('# Frontend Developer')).toBe(true)
    expect(d.editable).toBe(false)
    expect(d.prompt).toBeNull()
    expect(d).toMatchObject({ installed: true, agentName: 'Frontend Developer' })
  })

  it('answers null for an unknown id and rejects an id that is not a slug', async () => {
    expect(await call(IPC.rolesGet, 'no-such-role')).toBeNull()
    for (const bad of ['../../etc/passwd', 'C:\\x', 'A B', '', 'x'.repeat(200), 5, null]) await expect(call(IPC.rolesGet, bad)).rejects.toThrow()
  })
})

describe('your own roles', () => {
  it('create, read back with the text, edit, duplicate and delete', async () => {
    const created = await call<RoleSaveResult>(IPC.rolesSave, mine)
    expect(created).toMatchObject({ ok: true, role: { name: 'Release Notes Writer', source: 'custom', division: 'custom' } })
    const id = (created as { role: { id: string } }).role.id
    expect(readdirSync(join(base, 'userData', 'roles'))).toEqual(['release-notes-writer.md'])

    const d = (await call<RoleDetail | null>(IPC.rolesGet, id))!
    expect(d).toMatchObject({ editable: true, prompt: '# Release Notes Writer\n\nYou write notes.' })

    const edited = await call<RoleSaveResult>(IPC.rolesSave, { ...mine, id, name: 'Changelog Writer', description: 'Changed.' })
    expect(edited).toMatchObject({ ok: true, role: { id, name: 'Changelog Writer', description: 'Changed.' } })
    expect(readdirSync(join(base, 'userData', 'roles'))).toEqual(['release-notes-writer.md'])

    const copy = await call<RoleSaveResult>(IPC.rolesDuplicate, id)
    expect(copy).toMatchObject({ ok: true, role: { name: 'Changelog Writer (copy)', source: 'custom' } })

    expect(await call(IPC.rolesDelete, id)).toEqual({ ok: true })
    expect(names(await call<RolesCatalog>(IPC.rolesList))).not.toContain('Changelog Writer')
  })

  it('duplicates an agency role into an editable copy with its text', async () => {
    const list = await call<RolesCatalog>(IPC.rolesList)
    const ui = list.roles.find((r) => r.name === 'UI Designer')!
    const copy = (await call<RoleSaveResult>(IPC.rolesDuplicate, ui.id)) as { ok: true; role: { id: string; name: string } }
    expect(copy.role.name).toBe('UI Designer (copy)')
    const d = (await call<RoleDetail>(IPC.rolesGet, copy.role.id))!
    expect(d.prompt).toContain('You are UI Designer.')
    expect(d.editable).toBe(true)
  })

  it('refuses a name another role has, a role that is gone, and deleting a role that is not yours', async () => {
    expect(await call<RoleSaveResult>(IPC.rolesSave, { ...mine, name: 'Frontend Developer' })).toMatchObject({ ok: false, field: 'name' })
    expect(await call<RoleSaveResult>(IPC.rolesSave, { ...mine, id: 'gone' })).toMatchObject({ ok: false })
    expect(await call(IPC.rolesDelete, 'cto')).toMatchObject({ ok: false })
    expect(await call(IPC.rolesDelete, 'frontend-developer')).toMatchObject({ ok: false })
  })

  it('validates in main whatever the page sent', async () => {
    expect(await call<RoleSaveResult>(IPC.rolesSave, { ...mine, name: '' })).toMatchObject({ ok: false, field: 'name' })
    expect(await call<RoleSaveResult>(IPC.rolesSave, { ...mine, prompt: 'x'.repeat(70 * 1024) })).toMatchObject({ ok: false, field: 'prompt' })
    await expect(call(IPC.rolesSave, { ...mine, name: 5 })).rejects.toThrow()
    await expect(call(IPC.rolesSave, { ...mine, id: '../x' })).rejects.toThrow()
    await expect(call(IPC.rolesSave, 'nope')).rejects.toThrow()
    expect(() => readdirSync(join(base, 'userData', 'roles'))).toThrow() // nothing was written
  })

  it('writes nothing in demo mode', async () => {
    demo = true
    expect(await call(IPC.rolesSave, mine)).toMatchObject({ ok: false })
    expect(await call(IPC.rolesDuplicate, 'cto')).toMatchObject({ ok: false })
    expect(await call(IPC.rolesDelete, 'x')).toMatchObject({ ok: false })
    expect(await call(IPC.rolesSetRepo, 'C:\\x')).toMatchObject({ ok: false })
  })
})

describe('pins', () => {
  it('pins and unpins by id, keeps the order, and forgets a deleted role\'s pin', async () => {
    expect(await call(IPC.rolesSetPinned, 'cto', true)).toEqual(['cto'])
    expect(await call(IPC.rolesSetPinned, 'founding-engineer', true)).toEqual(['cto', 'founding-engineer'])
    expect(await call(IPC.rolesSetPinned, 'cto', true)).toEqual(['founding-engineer', 'cto'])
    expect((await call<RolesCatalog>(IPC.rolesList)).pinned).toEqual(['founding-engineer', 'cto'])
    expect(await call(IPC.rolesSetPinned, 'founding-engineer', false)).toEqual(['cto'])
    const mineId = ((await call<RoleSaveResult>(IPC.rolesSave, mine)) as { role: { id: string } }).role.id
    await call(IPC.rolesSetPinned, mineId, true)
    await call(IPC.rolesDelete, mineId)
    expect((await call<RolesCatalog>(IPC.rolesList)).pinned).toEqual(['cto'])
  })

  it('keeps other settings in config.json and rejects a bad id', async () => {
    writeFileSync(join(base, 'config.json'), JSON.stringify({ theme: 'dark', roles: { other: 1 } }))
    await call(IPC.rolesSetPinned, 'cto', true)
    expect(JSON.parse(readFileSync(join(base, 'config.json'), 'utf8'))).toMatchObject({ theme: 'dark', roles: { other: 1, pinned: ['cto'] } })
    await expect(call(IPC.rolesSetPinned, '../x', true)).rejects.toThrow()
    await expect(call(IPC.rolesSetPinned, 'cto', 'yes')).rejects.toThrow()
  })
})

describe('roles as Claude Code skills', () => {
  const skillFile = (id: string): string => join(base, 'claude', 'skills', `agency-${id}`, 'SKILL.md')

  it('installs a role as a skill with its whole text, lists it, and removes it', async () => {
    const before = await call<RolesCatalog>(IPC.rolesList)
    expect(before.skills).toEqual([])
    expect(before.skillsPath).toBe(join(base, 'claude', 'skills'))
    const r = await call<RoleSkillsResult>(IPC.rolesInstallSkills, ['frontend-developer', 'ui-designer'])
    expect(r.ok && [...r.skills].sort()).toEqual(['frontend-developer', 'ui-designer'])
    const text = readFileSync(skillFile('frontend-developer'), 'utf8')
    expect(text).toMatch(/^---\nname: agency-frontend-developer\ndescription: "Frontend Developer does things\. Use when the task calls for a Frontend Developer\."\n---/)
    expect(text.match(/Build the UI\./g)).toHaveLength(400) // the whole text, not the preview
    expect((await call<RolesCatalog>(IPC.rolesList)).skills.sort()).toEqual(['frontend-developer', 'ui-designer'])
    expect(await call<RoleSkillsResult>(IPC.rolesRemoveSkills, ['ui-designer'])).toEqual({ ok: true, skills: ['frontend-developer'] })
    expect(readdirSync(join(base, 'claude', 'skills'))).toEqual(['agency-frontend-developer'])
  })
  it('reports a role it could not install and still installs the rest', async () => {
    put('claude/skills/agency-ui-designer/SKILL.md', '---\nname: agency-ui-designer\ndescription: my own\n---\nmine\n')
    const r = await call<RoleSkillsResult>(IPC.rolesInstallSkills, ['ui-designer', 'frontend-developer'])
    expect(r.ok).toBe(false)
    expect(r.skills).toEqual(['frontend-developer'])
    expect(!r.ok && r.error).toMatch(/did not write it/)
    expect(readFileSync(skillFile('ui-designer'), 'utf8')).toContain('mine')
  })
  it('writes nothing in demo mode and rejects ids that are not role ids', async () => {
    demo = true
    expect((await call<RoleSkillsResult>(IPC.rolesInstallSkills, ['frontend-developer'])).ok).toBe(false)
    expect(() => handlers.get(IPC.rolesInstallSkills)!({}, ['../x'])).toThrow()
    expect(() => handlers.get(IPC.rolesInstallSkills)!({}, [])).toThrow()
  })
})

describe('pointing at a clone', () => {
  const folder = (): string => join(base, 'my-clone')

  it('takes a folder that holds roles, saves it, and reads from it first', async () => {
    put('my-clone/marketing/marketing-seo.md', persona('SEO Specialist'))
    const r = await call<RoleRepoResult>(IPC.rolesSetRepo, folder())
    expect(r.ok).toBe(true)
    const c = (r as { catalog: RolesCatalog }).catalog
    expect(c.status).toMatchObject({ repoSource: 'config', configuredPath: expect.stringContaining('my-clone') })
    expect(names(c)).toContain('SEO Specialist')
    expect(JSON.parse(readFileSync(join(base, 'config.json'), 'utf8')).roles.repoPath).toBe(folder())
  })

  it('refuses a folder that is missing, empty of roles, or not a local path, and saves nothing', async () => {
    mkdirSync(join(base, 'empty'))
    expect(await call<RoleRepoResult>(IPC.rolesSetRepo, join(base, 'nope'))).toMatchObject({ ok: false, error: expect.stringMatching(/does not exist/) })
    expect(await call<RoleRepoResult>(IPC.rolesSetRepo, join(base, 'empty'))).toMatchObject({ ok: false, error: expect.stringMatching(/No roles found/) })
    expect(await call<RoleRepoResult>(IPC.rolesSetRepo, '\\\\server\\share\\agents')).toMatchObject({ ok: false, error: expect.stringMatching(/local drive/) })
    expect(JSON.parse(readFileSync(join(base, 'config.json'), 'utf8')).roles).toBeUndefined()
  })

  it('forgets the choice with null', async () => {
    put('my-clone/marketing/marketing-seo.md', persona('SEO Specialist'))
    await call(IPC.rolesSetRepo, folder())
    const r = (await call<RoleRepoResult>(IPC.rolesSetRepo, null)) as { ok: true; catalog: RolesCatalog }
    expect(r.catalog.status.repoSource).toBe('claude-config')
    expect(names(r.catalog)).not.toContain('SEO Specialist')
  })

  it('opens a folder picker and returns what was chosen', async () => {
    expect(await call(IPC.rolesBrowseRepo)).toBe('C:\\picked\\agency-agents')
  })
})

describe('what a conversation or task starts from (main only)', () => {
  it('gives the full text, the installed name when Claude Code has the agent, and nothing for a role that is gone', async () => {
    const svc = roles()!
    const fe = (await svc.roleForSpawn('frontend-developer'))!
    expect(fe).toMatchObject({ name: 'Frontend Developer', source: 'agency', agentName: 'Frontend Developer' })
    expect(fe.prompt.length).toBeGreaterThan(4_096)
    expect(await svc.roleForSpawn('ui-designer')).toMatchObject({ agentName: null })
    expect(await svc.roleForSpawn('cto')).toMatchObject({ source: 'builtin', agentName: null })
    expect(await svc.roleForSpawn('nope')).toBeNull()
  })

  it('passes on the tools a role\'s front matter limits it to, and drops anything that is not a tool name', async () => {
    put('claude/repos/agency-agents/marketing/marketing-seo.md', persona('SEO Specialist').replace('vibe: SEO Specialist vibe', 'tools: WebFetch, Read, --evil, a b, Write'))
    expect(await roles()!.roleForSpawn('seo-specialist')).toMatchObject({ tools: ['WebFetch', 'Read', 'Write'] })
    expect(await roles()!.roleForSpawn('cto')).toMatchObject({ tools: null })
    expect(toolList(undefined)).toBeNull()
    expect(toolList('--x, ; ,')).toBeNull()
  })

  it('is gone after dispose', () => {
    dispose()
    expect(roles()).toBeNull()
  })
})
