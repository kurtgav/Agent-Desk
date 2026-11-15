import { beforeEach, describe, expect, it } from 'vitest'
import { demoRolesApi, demoRolesCatalog, resetDemoRoles } from './roles'

beforeEach(() => resetDemoRoles())

describe('demo roles', () => {
  it('is a believable catalog: about 40 sample roles across divisions, the seven leadership roles, installed and not', () => {
    const c = demoRolesCatalog()
    expect(c.roles.filter((r) => r.source === 'agency').length).toBeGreaterThanOrEqual(36)
    expect(c.roles.filter((r) => r.source === 'builtin').map((r) => r.name).sort()).toEqual([
      'CTO', 'Founding Engineer', 'Head of Design', 'Head of Marketing', 'Head of Product', 'Principal Engineer', 'VP of Engineering'
    ])
    expect(new Set(c.roles.filter((r) => r.source === 'agency').map((r) => r.division)).size).toBeGreaterThanOrEqual(10)
    expect(c.roles.some((r) => r.installed)).toBe(true)
    expect(c.roles.some((r) => r.source === 'agency' && !r.installed)).toBe(true)
    expect(c.roles.filter((r) => r.source === 'installed').map((r) => r.name).sort()).toEqual(['code-reviewer', 'planner', 'tdd-guide'])
    expect(c.divisions[0]!.id).toBe('leadership')
    expect(c.status).toMatchObject({ repoFound: true, counts: { builtin: 7, custom: 1 } })
  })

  it('has no real path or name on this machine', () => {
    const text = JSON.stringify(demoRolesCatalog())
    expect(text).not.toMatch(/MSI|nicole|thirdcodesolutions/i)
    expect(demoRolesCatalog().status.repoPath).toContain('Kurt')
  })

  it('has unique ids and every role has the fields a card needs', () => {
    const { roles } = demoRolesCatalog()
    expect(new Set(roles.map((r) => r.id)).size).toBe(roles.length)
    for (const r of roles) {
      expect(r.name && r.emoji && r.vibe && r.description && r.color).toBeTruthy()
      expect(r.color).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  it('gives a detail with a preview, and the real text of a leadership role', async () => {
    const cto = (await demoRolesApi.get('cto'))!
    expect(cto.preview).toContain('Identity and memory')
    expect(cto.previewTruncated).toBe(true)
    expect(cto.editable).toBe(false)
    expect((await demoRolesApi.get('frontend-developer'))!.preview).toContain('sample text')
    expect(await demoRolesApi.get('nope')).toBeNull()
  })
})

describe('demo custom roles (in memory)', () => {
  const input = { name: 'Support Triage Lead', emoji: '🛟', description: 'Sorts tickets.', prompt: '# Support Triage Lead\n\nYou sort tickets.' }

  it('create, edit, duplicate and delete', async () => {
    const made = await demoRolesApi.save(input)
    expect(made).toMatchObject({ ok: true, role: { name: 'Support Triage Lead', source: 'custom' } })
    const id = (made as { role: { id: string } }).role.id
    expect((await demoRolesApi.get(id))!.prompt).toContain('You sort tickets.')

    expect(await demoRolesApi.save({ ...input, id, description: 'Changed.' })).toMatchObject({ ok: true, role: { id, description: 'Changed.' } })
    expect(demoRolesCatalog().roles.filter((r) => r.name === 'Support Triage Lead')).toHaveLength(1)

    const copy = await demoRolesApi.duplicate(id)
    expect(copy).toMatchObject({ ok: true, role: { name: 'Support Triage Lead (copy)' } })
    expect(await demoRolesApi.duplicate('frontend-developer')).toMatchObject({ ok: true, role: { name: 'Frontend Developer (copy)', source: 'custom' } })

    expect(await demoRolesApi.remove(id)).toEqual({ ok: true })
    expect(demoRolesCatalog().roles.some((r) => r.id === id)).toBe(false)
  })

  it('checks what the form checks, and refuses a name another role has', async () => {
    expect(await demoRolesApi.save({ ...input, name: '' })).toMatchObject({ ok: false, field: 'name' })
    expect(await demoRolesApi.save({ ...input, name: 'CTO' })).toMatchObject({ ok: false, field: 'name' })
    expect(await demoRolesApi.remove('cto')).toMatchObject({ ok: false })
  })

  it('pins, and a deleted role\'s pin goes with it', async () => {
    expect(await demoRolesApi.setPinned('founding-engineer', true)).toEqual(['frontend-developer', 'cto', 'founding-engineer'])
    expect(demoRolesCatalog().pinned).toContain('founding-engineer')
    expect(await demoRolesApi.setPinned('cto', false)).toEqual(['frontend-developer', 'founding-engineer'])
    const id = ((await demoRolesApi.save(input)) as { role: { id: string } }).role.id
    await demoRolesApi.setPinned(id, true)
    await demoRolesApi.remove(id)
    expect(demoRolesCatalog().pinned).not.toContain(id)
  })

  it('cannot point at a folder in demo', async () => {
    expect(await demoRolesApi.setRepo()).toMatchObject({ ok: false })
    expect(await demoRolesApi.browse()).toBeNull()
  })
})
