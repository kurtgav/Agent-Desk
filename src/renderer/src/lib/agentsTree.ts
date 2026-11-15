import { searchRoles } from '@shared/role-search'
import { LEADERSHIP_DIVISION, type RoleDivision, type RoleSummary, type RolesCatalog } from '@shared/roles'

/**
 * The sidebar's Agents panel as rows (IA § 3): Favourites (pinned, then recently used), Leadership, then every division with its
 * count. A filter keeps the structure and shows only the agents that match, best match first. Pure: the panel only windows and draws it.
 */

export const FAVOURITES = 'favourites'
/** How many recently used agents join the pinned ones. */
export const RECENT_MAX = 5

export type AgentRow =
  | { kind: 'heading'; id: string; label: string; count: number; open: boolean; color: string | null }
  | { kind: 'role'; id: string; section: string; role: RoleSummary }

export interface AgentsView {
  rows: AgentRow[]
  /** Agents in the tree (Favourites repeat agents that live in a division: they count once). */
  total: number
  /** Agents the filter kept; equal to `total` with no filter. */
  matches: number
}

/** The sections that start open: the ones a person looks for first. Every other division starts closed, so 350 agents are a short list until asked for. */
export const DEFAULT_OPEN: readonly string[] = [FAVOURITES, LEADERSHIP_DIVISION]

function favourites(roles: readonly RoleSummary[], pinned: readonly string[], recent: readonly string[]): RoleSummary[] {
  const byId = new Map(roles.map((r) => [r.id, r]))
  const ids = [...new Set([...pinned, ...recent.slice(0, RECENT_MAX)])]
  return ids.flatMap((id) => {
    const role = byId.get(id)
    return role ? [role] : []
  })
}

export function agentRows(catalog: RolesCatalog, opts: { query: string; open: ReadonlySet<string>; recent: readonly string[] }): AgentsView {
  const query = opts.query.trim()
  // Best match first inside every section: the score order of one search over the whole catalog.
  const rank = query ? new Map(searchRoles(catalog.roles, query).map((h, i) => [h.id, i])) : null
  const keep = (r: RoleSummary): boolean => rank === null || rank.has(r.id)
  const order = (list: RoleSummary[]): RoleSummary[] => (rank ? [...list].sort((a, b) => rank.get(a.id)! - rank.get(b.id)!) : list)

  const sections: { id: string; label: string; color: string | null; roles: RoleSummary[] }[] = [
    { id: FAVOURITES, label: 'Favourites', color: null, roles: favourites(catalog.roles, catalog.pinned, opts.recent) },
    ...catalog.divisions.map((d: RoleDivision) => ({ id: d.id, label: d.label, color: d.color, roles: catalog.roles.filter((r) => r.division === d.id) }))
  ]

  const rows: AgentRow[] = []
  for (const s of sections) {
    const roles = order(s.roles.filter(keep))
    if (roles.length === 0) continue
    // A filter opens everything it found: a match inside a closed division would otherwise look like no match.
    const open = rank !== null || opts.open.has(s.id)
    rows.push({ kind: 'heading', id: s.id, label: s.label, count: roles.length, open, color: s.color })
    if (open) for (const role of roles) rows.push({ kind: 'role', id: `${s.id}:${role.id}`, section: s.id, role })
  }
  const matches = catalog.roles.filter(keep).length
  return { rows, total: catalog.roles.length, matches }
}

/** The agents a person used lately, newest first, from the roles their sessions were started as. */
export function recentRoleIds(sessionRoles: readonly (string | null)[]): string[] {
  return [...new Set(sessionRoles.filter((r): r is string => r !== null))].slice(0, RECENT_MAX)
}
