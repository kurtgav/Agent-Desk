import type { RoleDivision, RoleSummary, RolesCatalog } from '@shared/roles'
import { useRolesCatalog } from '../roles/store'
import type { RoleLookup } from './types'

/**
 * The catalog as the composer uses it: by id, with the lookups the plans need. One answer per catalog *content*: the demo catalog is
 * rebuilt on every read, and a hook or effect keyed on it would run on every render, so the same roles give the same index.
 */
export interface RoleIndex {
  ready: boolean
  roles: RoleSummary[]
  divisions: RoleDivision[]
  pinned: string[]
  get(id: string): RoleSummary | undefined
  has(id: string): boolean
  lookup: RoleLookup
}

const NONE: RoleSummary[] = []
const NO_DIVISIONS: RoleDivision[] = []
const NO_PINS: string[] = []

function build(catalog: RolesCatalog | null): RoleIndex {
  const roles = catalog?.roles ?? NONE
  const byId = new Map(roles.map((r) => [r.id, r]))
  return {
    ready: catalog !== null,
    roles,
    divisions: catalog?.divisions ?? NO_DIVISIONS,
    pinned: catalog?.pinned ?? NO_PINS,
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    lookup: { name: (id) => byId.get(id)?.name ?? id, agent: (id) => byId.get(id)?.agentName ?? null }
  }
}

const signature = (c: RolesCatalog | null): string => (c ? `${c.pinned.join(',')}|${c.roles.map((r) => `${r.id}:${r.name}:${r.emoji}:${r.agentName ?? ''}`).join('|')}` : '')

let last: { sig: string; index: RoleIndex } | null = null

export function indexFor(catalog: RolesCatalog | null): RoleIndex {
  const sig = signature(catalog)
  if (last && last.sig === sig) return last.index
  last = { sig, index: build(catalog) }
  return last.index
}

export function useRoleIndex(): RoleIndex {
  return indexFor(useRolesCatalog().catalog)
}
