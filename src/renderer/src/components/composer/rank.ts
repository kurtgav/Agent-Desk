import { searchRoles, words } from '@shared/role-search'
import { SYNONYMS } from '@shared/role-synonyms'
import { LEADERSHIP_DIVISION, type RoleDivision, type RoleSummary } from '@shared/roles'

/**
 * What the `@` menu lists, in order. No typing: Pinned, Recent, then every division (Leadership first) with its roles. Typing:
 * a ranked list. A handle you are typing beats everything else, so `@c` brings the CTO first and `@qa` the QA roles, then what
 * `searchRoles` finds through synonyms and descriptions (`@fe`, `@marketing`, `@growth`). Pinned and recent roles break ties.
 */

export interface RankContext {
  pinned: readonly string[]
  /** Most recent first. */
  recent: readonly string[]
}

export type MenuRow = { kind: 'header'; id: string; label: string; count: number } | { kind: 'role'; role: RoleSummary }

export const RECENT_SHOWN = 5
export const RANKED_MAX = 80

const compact = (s: string): string => s.replace(/[^a-z0-9]/g, '')

/**
 * How well one role answers what was typed after the `@`, in bands 100 apart so a boost never lifts a role over a better kind of match.
 * A short word that is a known alias (`fe`, `qa`, `ui`) means what the alias list says, so a name that merely begins with it
 * (Feedback Synthesizer for `fe`) comes after the roles `searchRoles` finds through the alias.
 */
function band(role: RoleSummary, q: string, qc: string): number {
  const idc = compact(role.id)
  const nameWords = words(role.name)
  const name = nameWords.join(' ')
  const alias = qc.length <= 3 && q in SYNONYMS
  const prefix = (n: number): number => (alias ? 380 : n)
  if (role.id === q || idc === qc) return 1000
  if (name === q) return 950
  // Initials count unless the word is a known alias: `fe` means frontend, not Founding Engineer.
  if (qc.length >= 2 && nameWords.map((w) => w[0]).join('') === qc) return alias ? 350 : 900
  if (nameWords.includes(q)) return 700
  if (idc.startsWith(qc)) return prefix(800 - Math.min(idc.length, 60))
  if (name.startsWith(q)) return prefix(780 - Math.min(name.length, 60))
  if (nameWords.some((w) => w.startsWith(q))) return prefix(600 - Math.min(name.length, 60))
  if (name.includes(q)) return prefix(560 - Math.min(name.length, 60))
  if (qc.length >= 2 && idc.includes(qc)) return 300
  return 0
}

/** Pinned and recent first, then Leadership: tie-breakers, worth less than any difference in how well a role matches. */
function boost(role: RoleSummary, ctx: RankContext): number {
  let b = role.division === LEADERSHIP_DIVISION ? 8 : 0
  if (ctx.pinned.includes(role.id)) b += 12
  const r = ctx.recent.indexOf(role.id)
  if (r >= 0) b += Math.max(4, 10 - r * 2)
  return b
}

/** What a hit `searchRoles` made (synonyms, one-liners, descriptions) is worth: weak ones count for little, and for a short word they do not count at all. */
function foundBand(score: number | undefined, qc: string): number {
  if (score === undefined || (qc.length <= 3 && score < 2)) return 0
  return 400 + Math.min(score * 10, 95)
}

/** Roles for what follows the `@`, best first. An empty query ranks nothing: the menu shows the groups instead. */
export function rankMentions(roles: readonly RoleSummary[], query: string, ctx: RankContext, limit = RANKED_MAX): RoleSummary[] {
  const q = words(query).join(' ')
  const qc = compact(q)
  if (!qc) return []
  const found = new Map(searchRoles(roles, query).map((h) => [h.id, h.score]))
  const scored: [RoleSummary, number][] = []
  for (const role of roles) {
    const typed = band(role, q, qc)
    const base = Math.max(typed, foundBand(found.get(role.id), qc))
    if (base > 0) scored.push([role, base + boost(role, ctx)])
  }
  return scored
    .sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name))
    .slice(0, limit)
    .map(([role]) => role)
}

/**
 * The menu with nothing typed: Pinned, then Recent, then each division in the catalog's order with the count it shows. A role is
 * listed once, in the first group that has it, as on the Roles page.
 */
export function groupRows(roles: readonly RoleSummary[], divisions: readonly RoleDivision[], ctx: RankContext): MenuRow[] {
  const byId = new Map(roles.map((r) => [r.id, r]))
  const seen = new Set<string>()
  const rows: MenuRow[] = []
  const group = (id: string, label: string, list: readonly RoleSummary[]): void => {
    const fresh = list.filter((r) => !seen.has(r.id))
    if (!fresh.length) return
    rows.push({ kind: 'header', id, label, count: fresh.length })
    for (const role of fresh) {
      seen.add(role.id)
      rows.push({ kind: 'role', role })
    }
  }
  const known = (ids: readonly string[]): RoleSummary[] => ids.flatMap((id) => byId.get(id) ?? [])
  group('pinned', 'Pinned', known(ctx.pinned))
  group('recent', 'Recent', known(ctx.recent.filter((id) => !ctx.pinned.includes(id))).slice(0, RECENT_SHOWN))
  for (const d of divisions) group(d.id, d.label, roles.filter((r) => r.division === d.id))
  return rows
}

/** What the menu shows for a query: the ranked roles, or the groups when nothing is typed. */
export function menuRows(roles: readonly RoleSummary[], divisions: readonly RoleDivision[], query: string, ctx: RankContext): MenuRow[] {
  if (!compact(words(query).join(' '))) return groupRows(roles, divisions, ctx)
  return rankMentions(roles, query, ctx).map((role): MenuRow => ({ kind: 'role', role }))
}

/** The roles in a list of rows, in the order the keys walk them. */
export const optionsOf = (rows: readonly MenuRow[]): RoleSummary[] => rows.flatMap((r) => (r.kind === 'role' ? [r.role] : []))
