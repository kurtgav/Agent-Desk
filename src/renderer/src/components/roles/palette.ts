import { Users } from 'lucide-react'
import { searchRoles } from '@shared/role-search'
import { useUi } from '@/store'
import type { Command } from '../Palette'
import { useRolesCatalog } from './store'

/** Roles shown in the palette for a typed query. Few, because the palette is for jumping, and the Roles page is for browsing. */
const SHOWN = 6

/**
 * Ctrl+K finds roles by what you type (a name, a title like "cto", a word from what it does) and opens that role's detail on the
 * Roles page. Nothing is offered until something is typed: with 350 roles an empty box would bury the pages and actions.
 */
export function useRoleCommands(query: string): Command[] {
  const { catalog } = useRolesCatalog()
  // The catalog loads the first time the palette is used (useRolesCatalog), and this re-renders when it arrives.
  if (!catalog || !query.trim()) return []
  const byId = new Map(catalog.roles.map((r) => [r.id, r]))
  return searchRoles(catalog.roles, query, SHOWN).flatMap((hit) => {
    const r = byId.get(hit.id)
    return r
      ? [{ id: `role:${r.id}`, group: 'Roles' as const, label: r.name, meta: r.divisionLabel, icon: Users, role: r, emoji: r.emoji, run: () => useUi.getState().go({ page: 'roles', role: r.id }) }]
      : []
  })
}
