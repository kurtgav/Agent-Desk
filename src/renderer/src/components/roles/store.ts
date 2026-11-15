import { useEffect } from 'react'
import { create } from 'zustand'
import type { RoleSaveResult, RoleRepoResult, RoleSkillsResult, RolesCatalog, CustomRoleInput } from '@shared/roles'
import { demoRolesCatalog } from '@/demo/roles'
import { rolesApi } from '@/lib/roles'
import { useUi } from '@/store'

/** The catalog the Roles page, the palette and (later) the pickers share. Loaded when first needed, then kept; every write refreshes it. */
interface RolesStore {
  catalog: RolesCatalog | null
  phase: 'idle' | 'loading' | 'ready' | 'error'
  /** A reload is running over a catalog that is already on screen. */
  refreshing: boolean
  load(): Promise<void>
  reload(): Promise<void>
  togglePin(id: string): Promise<void>
  /** Install (on) or remove these roles as Claude Code skills, then read the catalog again: main says what is installed. */
  setSkills(ids: string[], on: boolean): Promise<RoleSkillsResult>
  save(input: CustomRoleInput): Promise<RoleSaveResult>
  remove(id: string): Promise<boolean>
  duplicate(id: string): Promise<RoleSaveResult>
  setRepo(path: string | null): Promise<RoleRepoResult>
}

const SAVED_FAILED = 'AgentDeck could not save that. Try again.'

export const useRolesStore = create<RolesStore>((set, get) => {
  const read = async (fresh: boolean): Promise<void> => {
    const had = get().catalog !== null
    set(had ? { refreshing: true } : { phase: 'loading' })
    try {
      const api = rolesApi()
      set({ catalog: await (fresh ? api.reload() : api.list()), phase: 'ready', refreshing: false })
    } catch {
      set(had ? { refreshing: false } : { phase: 'error', refreshing: false })
    }
  }
  const after = async <T extends { ok: boolean }>(r: T): Promise<T> => {
    if (r.ok) await read(false)
    return r
  }
  return {
    catalog: null,
    phase: 'idle',
    refreshing: false,
    load: () => read(false),
    reload: () => read(true),
    togglePin: async (id) => {
      const cat = get().catalog
      if (!cat) return
      const on = !cat.pinned.includes(id)
      // Optimistic: the pin shows at once, and main's answer replaces it.
      set({ catalog: { ...cat, pinned: on ? [...cat.pinned, id] : cat.pinned.filter((p) => p !== id) } })
      try {
        const pinned = await rolesApi().setPinned(id, on)
        set((s) => (s.catalog ? { catalog: { ...s.catalog, pinned } } : {}))
      } catch {
        set({ catalog: cat })
        useUi.getState().notify('AgentDeck could not save that pin. Try again.', 'error')
      }
    },
    setSkills: async (ids, on) => {
      const r = await rolesApi().setSkills(ids, on)
      await read(false)
      return r
    },
    save: async (input) => after(await rolesApi().save(input).catch((): RoleSaveResult => ({ ok: false, error: SAVED_FAILED }))),
    remove: async (id) => (await after(await rolesApi().remove(id).catch(() => ({ ok: false as const, error: SAVED_FAILED })))).ok,
    duplicate: async (id) => after(await rolesApi().duplicate(id).catch((): RoleSaveResult => ({ ok: false, error: SAVED_FAILED }))),
    setRepo: async (path) => {
      const r = await rolesApi().setRepo(path).catch((): RoleRepoResult => ({ ok: false, error: SAVED_FAILED }))
      if (r.ok) set({ catalog: r.catalog, phase: 'ready' })
      return r
    }
  }
})

/**
 * The catalog for a component, loading it on first use. In demo mode (and in the server render the tests do) the sample catalog is
 * there from the first paint, so a page never shows an empty frame for data that needs no wait.
 */
export function useRolesCatalog(): { catalog: RolesCatalog | null; phase: RolesStore['phase']; refreshing: boolean } {
  const stored = useRolesStore((s) => s.catalog)
  const phase = useRolesStore((s) => s.phase)
  const refreshing = useRolesStore((s) => s.refreshing)
  const demo = useUi((s) => s.snapshot.mode === 'demo') || !window.agentdeck
  useEffect(() => {
    if (useRolesStore.getState().phase === 'idle' || useRolesStore.getState().phase === 'error') void useRolesStore.getState().load()
  }, [])
  if (!stored && demo) return { catalog: demoRolesCatalog(), phase: 'ready', refreshing: false }
  return { catalog: stored, phase, refreshing }
}
