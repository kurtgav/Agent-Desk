import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDemoRoles } from '@/demo/roles'
import { demoSnapshot } from '@/demo/snapshot'
import { useUi } from '@/store'
import { useRolesStore } from './store'

const NOW = Date.UTC(2026, 10, 5, 14, 0)
const store = () => useRolesStore.getState()

beforeEach(() => {
  resetDemoRoles()
  // No bridge: the page runs on the in-memory demo roles, the same path demo mode takes.
  vi.stubGlobal('window', {})
  useUi.setState({ snapshot: demoSnapshot(NOW), notice: null })
  useRolesStore.setState({ catalog: null, phase: 'idle', refreshing: false })
})
afterEach(() => vi.unstubAllGlobals())

describe('the roles store (demo data)', () => {
  it('loads once into ready, then reloads over what is on screen', async () => {
    await store().load()
    expect(store().phase).toBe('ready')
    expect(store().catalog!.roles.length).toBeGreaterThan(40)
    const first = store().catalog
    await store().reload()
    expect(store().catalog).not.toBe(first)
    expect(store().refreshing).toBe(false)
  })

  it('pins at once and keeps main\'s answer; unpins the same way', async () => {
    await store().load()
    const before = store().catalog!.pinned
    const p = store().togglePin('founding-engineer')
    expect(store().catalog!.pinned).toEqual([...before, 'founding-engineer']) // optimistic, before the answer
    await p
    expect(store().catalog!.pinned).toContain('founding-engineer')
    await store().togglePin('founding-engineer')
    expect(store().catalog!.pinned).not.toContain('founding-engineer')
  })

  it('installs roles as skills and removes them, with the catalog following main', async () => {
    await store().load()
    expect(store().catalog!.skills).toEqual([])
    expect(store().catalog!.skillsPath).toMatch(/skills$/)
    expect(await store().setSkills(['cto', 'frontend-developer'], true)).toEqual({ ok: true, skills: ['cto', 'frontend-developer'] })
    expect(store().catalog!.skills).toEqual(['cto', 'frontend-developer'])
    await store().setSkills(['cto'], false)
    expect(store().catalog!.skills).toEqual(['frontend-developer'])
  })

  it('does nothing for a pin before the catalog is there', async () => {
    await store().togglePin('cto')
    expect(store().catalog).toBeNull()
  })

  it('saves, duplicates and removes, and the catalog follows each change', async () => {
    await store().load()
    const input = { name: 'Support Triage Lead', emoji: '🛟', description: 'Sorts tickets.', prompt: 'You sort tickets.' }
    const saved = await store().save(input)
    expect(saved.ok).toBe(true)
    const id = (saved as { role: { id: string } }).role.id
    expect(store().catalog!.roles.some((r) => r.id === id)).toBe(true)

    const copy = await store().duplicate(id)
    expect(copy).toMatchObject({ ok: true, role: { name: 'Support Triage Lead (copy)' } })

    expect(await store().remove(id)).toBe(true)
    expect(store().catalog!.roles.some((r) => r.id === id)).toBe(false)
    expect(await store().remove('cto')).toBe(false)
  })

  it('answers a refused save with the reason and leaves the catalog alone', async () => {
    await store().load()
    const before = store().catalog
    const r = await store().save({ name: 'CTO', emoji: '🧭', description: 'x', prompt: 'x' })
    expect(r).toMatchObject({ ok: false, field: 'name' })
    expect(store().catalog).toBe(before)
  })

  it('cannot point at a folder in demo, and says so', async () => {
    await store().load()
    expect(await store().setRepo('C:\\somewhere')).toMatchObject({ ok: false, error: expect.stringMatching(/demo/i) })
  })
})
