import { searchRoles, suggestRoles, words } from '@shared/role-search'
import type { RoleDivision, RoleHit, RoleSummary } from '@shared/roles'

/** What the Roles page shows is a function of these four choices and the catalog: no state hides in the markup. */
export type InstallFilter = 'any' | 'installed' | 'not-installed'

export interface RolesView {
  /** A division id, or null for all of them. */
  division: string | null
  pinnedOnly: boolean
  install: InstallFilter
  query: string
}

export const ALL_ROLES: RolesView = { division: null, pinnedOnly: false, install: 'any', query: '' }

export interface Shown {
  roles: RoleSummary[]
  /** The words that found each role, when the view is a search. */
  hits: ReadonlyMap<string, RoleHit> | null
  /** `search`: what was typed is part of a name or description. `suggest`: it reads like a task, so roles are ranked by fit. */
  mode: 'search' | 'suggest' | null
}

/** Typed words past this many read as a task ("write landing page copy"), not as a name. */
const TASK_WORDS = 4
const SUGGEST_MAX = 24

/**
 * The roles the view shows, in the order they show: best match first for a search, otherwise the catalog's order (division, then
 * name). A short query is a search; a sentence, or a query nothing matches word for word, is ranked as a task (suggestRoles).
 */
export function applyView(roles: readonly RoleSummary[], pinned: readonly string[], view: RolesView): Shown {
  const pins = new Set(pinned)
  const q = view.query.trim()
  let found = q ? searchRoles(roles, q) : null
  let mode: Shown['mode'] = q ? 'search' : null
  if (q && (words(q).length >= TASK_WORDS || found!.length === 0)) {
    const suggested = suggestRoles(roles, q, SUGGEST_MAX)
    if (suggested.length) {
      found = suggested
      mode = 'suggest'
    }
  }
  const hits = found ? new Map(found.map((h) => [h.id, h])) : null
  const byId = new Map(roles.map((r) => [r.id, r]))
  const base = hits ? [...hits.keys()].map((id) => byId.get(id)!) : [...roles]
  const out = base.filter(
    (r) =>
      (view.division === null || r.division === view.division) &&
      (!view.pinnedOnly || pins.has(r.id)) &&
      (view.install === 'any' || (view.install === 'installed') === r.installed)
  )
  return { roles: out, hits, mode }
}

export interface Section {
  id: string
  label: string
  /** All of the section's roles; the page shows the first row of them until "Show all". */
  roles: RoleSummary[]
  division: RoleDivision | null
}

/** Leadership is the page's first answer, so it shows two rows before "Show all". */
const LEADERSHIP_ROWS = 2

/** How many of a section's roles fit its collapsed form: Pinned in full, Leadership two rows, every other division one row. */
export function capFor(s: Section, columns: number): number {
  return s.id === 'pinned' ? s.roles.length : Math.max(1, columns) * (s.id === 'leadership' ? LEADERSHIP_ROWS : 1)
}

/** The unfiltered page: Pinned first (all of them), then each division in the catalog's order, Leadership first. A pinned role moves up: it is not repeated below. */
export function sectionsFor(roles: readonly RoleSummary[], divisions: readonly RoleDivision[], pinned: readonly string[]): Section[] {
  const pins = new Set(pinned)
  const pinnedRoles = roles.filter((r) => pins.has(r.id))
  const sections: Section[] = pinnedRoles.length ? [{ id: 'pinned', label: 'Pinned', roles: pinnedRoles, division: null }] : []
  for (const d of divisions) {
    const own = roles.filter((r) => r.division === d.id && !pins.has(r.id))
    if (own.length) sections.push({ id: d.id, label: d.label, roles: own, division: d })
  }
  return sections
}

export interface Box {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export type NavKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'

/**
 * Which card an arrow key moves to, by where the cards are on screen (the page has several grids, so a column count would not do).
 * Left and right walk reading order. Up and down go to the nearest row above or below, at the card whose centre is closest across.
 * Returns the id to focus, or the current one when there is nowhere to go.
 */
export function nextCard(boxes: readonly Box[], current: string, key: NavKey): string {
  const i = boxes.findIndex((b) => b.id === current)
  if (i < 0) return boxes[0]?.id ?? current
  const cur = boxes[i]!
  if (key === 'Home') return boxes[0]!.id
  if (key === 'End') return boxes.at(-1)!.id
  if (key === 'ArrowLeft') return boxes[Math.max(0, i - 1)]!.id
  if (key === 'ArrowRight') return boxes[Math.min(boxes.length - 1, i + 1)]!.id
  const down = key === 'ArrowDown'
  const centre = cur.x + cur.w / 2
  const candidates = boxes.filter((b) => (down ? b.y >= cur.y + cur.h - 1 : b.y + b.h <= cur.y + 1))
  if (!candidates.length) return current
  // The nearest row first (smallest vertical gap), then the closest across.
  const gap = (b: Box): number => (down ? b.y - cur.y : cur.y - b.y)
  const rowGap = Math.min(...candidates.map(gap))
  const row = candidates.filter((b) => gap(b) - rowGap < cur.h / 2)
  return row.reduce((best, b) => (Math.abs(b.x + b.w / 2 - centre) < Math.abs(best.x + best.w / 2 - centre) ? b : best)).id
}

/** "Good for" aside, the one sentence under a search: how many roles and for what. */
export function summary(n: number, view: RolesView, divisionLabel: string | null): string {
  const what = view.query.trim() ? `matching “${view.query.trim()}”` : view.pinnedOnly ? 'pinned' : divisionLabel ? `in ${divisionLabel}` : ''
  const install = view.install === 'installed' ? 'installed' : view.install === 'not-installed' ? 'not installed' : ''
  return [`${n} ${n === 1 ? 'role' : 'roles'}`, install, what].filter(Boolean).join(' · ')
}
