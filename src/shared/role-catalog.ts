import {
  CUSTOM_DIVISION, LEADERSHIP_DIVISION, YOURS_DIVISION, isSafeAgentName, slugify,
  type RoleDivision, type RoleSource, type RoleSummary
} from './roles'

/**
 * Putting roles from four places into one catalog: which file names the same role as which, what each role's id is, and what the
 * division rail shows. Pure (no files): main reads the files into `RawRole`s, the demo catalog makes them up, the tests build them.
 */

export interface RawRole {
  source: RoleSource
  /** Where it came from, stable per file (a relative path); main maps an id back to its file by this. */
  key: string
  /** The file name without `.md`. An installed copy of a clone file keeps its name. */
  stem: string
  name: string
  description: string
  vibe: string
  emoji: string
  /** A division id; installed agents and custom roles are given theirs by the builder. */
  division: string
  promptChars: number
}

export interface DivisionMeta {
  label: string
  icon: string
  color: string
}

/** The agency-agents `divisions.json` as of its October 2026 head: used when the clone's own file is missing or unreadable. */
export const DEFAULT_DIVISIONS: Record<string, DivisionMeta> = {
  academic: { label: 'Academic', icon: 'GraduationCap', color: '#8B5CF6' },
  design: { label: 'Design', icon: 'PenTool', color: '#EC4899' },
  engineering: { label: 'Engineering', icon: 'Code', color: '#3B82F6' },
  finance: { label: 'Finance', icon: 'DollarSign', color: '#22C55E' },
  'game-development': { label: 'Game Development', icon: 'Gamepad2', color: '#A855F7' },
  gis: { label: 'GIS', icon: 'Map', color: '#14B8A6' },
  healthcare: { label: 'Healthcare', icon: 'Stethoscope', color: '#0D9488' },
  marketing: { label: 'Marketing', icon: 'Megaphone', color: '#F97316' },
  'paid-media': { label: 'Paid Media', icon: 'Target', color: '#EAB308' },
  product: { label: 'Product', icon: 'Box', color: '#D946EF' },
  'project-management': { label: 'Project Management', icon: 'ClipboardList', color: '#0EA5E9' },
  research: { label: 'Research', icon: 'Search', color: '#7C3AED' },
  sales: { label: 'Sales', icon: 'TrendingUp', color: '#10B981' },
  security: { label: 'Security', icon: 'ShieldCheck', color: '#EF4444' },
  'spatial-computing': { label: 'Spatial Computing', icon: 'Boxes', color: '#06B6D4' },
  specialized: { label: 'Specialized', icon: 'Sparkles', color: '#6366F1' },
  support: { label: 'Support', icon: 'LifeBuoy', color: '#84CC16' },
  testing: { label: 'Testing', icon: 'FlaskConical', color: '#F59E0B' }
}

/** The divisions AgentDeck makes up. Leadership is bronze, Custom slate, Your agents zinc: none is a division colour of the clone. */
export const OWN_DIVISIONS: Record<string, DivisionMeta> = {
  [LEADERSHIP_DIVISION]: { label: 'Leadership', icon: 'Crown', color: '#B45309' },
  [CUSTOM_DIVISION]: { label: 'Custom', icon: 'PencilRuler', color: '#64748B' },
  [YOURS_DIVISION]: { label: 'Your agents', icon: 'UserRound', color: '#71717A' }
}

const PALETTE = ['#3B82F6', '#EC4899', '#22C55E', '#F97316', '#A855F7', '#14B8A6', '#EAB308', '#EF4444', '#06B6D4', '#6366F1']
const FALLBACK_ICON = 'Folder'

/** A folder name the clone adds later still gets a label, an icon and a colour. */
export function divisionMeta(id: string, known: Record<string, DivisionMeta>): DivisionMeta {
  const hit = known[id] ?? OWN_DIVISIONS[id]
  if (hit) return hit
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return { label: id.split(/[-_]+/).filter(Boolean).map((w) => `${w[0]!.toUpperCase()}${w.slice(1)}`).join(' ') || id, icon: FALLBACK_ICON, color: PALETTE[h % PALETTE.length]! }
}

/** Same name, whatever the case and spacing. */
const norm = (name: string): string => name.toLowerCase().replace(/\s+/g, ' ').trim()
/** `agency-frontend-developer` (a conversion tool's prefix) names the same role as `Frontend Developer`. */
const AGENCY_PREFIX = /^agency[-_ ]/i
const unprefixed = (name: string): string => norm(name.replace(AGENCY_PREFIX, '').replace(/[-_]+/g, ' '))
const sameName = (a: string, b: string): boolean => norm(a) === norm(b) || (AGENCY_PREFIX.test(a) !== AGENCY_PREFIX.test(b) && unprefixed(a) === unprefixed(b))

const RANK: Record<RoleSource, number> = { builtin: 0, custom: 1, agency: 2, installed: 3 }

export interface BuiltRole extends RoleSummary {
  /** `RawRole.key` of the file the role's text comes from. */
  key: string
}

export interface Built {
  roles: BuiltRole[]
  divisions: RoleDivision[]
  /** Files dropped because a role of the same name was already listed. */
  duplicates: number
}

/** The role without the key main uses to find its file: what the page gets. */
export function toSummary(r: BuiltRole): RoleSummary {
  return {
    id: r.id, name: r.name, division: r.division, divisionLabel: r.divisionLabel, emoji: r.emoji, color: r.color, vibe: r.vibe,
    description: r.description, source: r.source, installed: r.installed, agentName: r.agentName, promptChars: r.promptChars
  }
}

/** One of each name. The copy that is also installed wins (it is the one Claude Code runs), otherwise the first by key. */
function dedupe(raws: RawRole[], installedStems: ReadonlySet<string>): { kept: RawRole[]; dropped: number } {
  const sorted = [...raws].sort((a, b) => Number(installedStems.has(b.stem)) - Number(installedStems.has(a.stem)) || a.key.localeCompare(b.key))
  const seen = new Set<string>()
  const kept: RawRole[] = []
  for (const r of sorted) {
    const k = norm(r.name)
    if (seen.has(k)) continue
    seen.add(k)
    kept.push(r)
  }
  return { kept, dropped: raws.length - kept.length }
}

/**
 * Builds the catalog.
 *
 * - An installed agent that is a copy of a clone file (same file name, or the same role name) is that role, flagged installed, and
 *   its exact name is what `claude --agent` takes. Installed agents the clone does not have are listed under "Your agents".
 * - Two files naming one role keep one (the installed copy, else the first by path); `duplicates` counts the rest.
 * - Ids are slugs of the name (a custom role's, of its file name). Two different roles with one slug (an agency "Code Reviewer" and
 *   an installed `code-reviewer`) both stay: the higher source keeps the plain slug, the other gets `-<source>`.
 */
export function buildCatalog(raws: RawRole[], known: Record<string, DivisionMeta> = DEFAULT_DIVISIONS): Built {
  const installedAll = raws.filter((r) => r.source === 'installed')
  const installedStems = new Set(installedAll.map((r) => r.stem))
  const agency = dedupe(raws.filter((r) => r.source === 'agency'), installedStems)
  const installed = dedupe(installedAll, new Set())

  const byStem = new Map(agency.kept.map((r) => [r.stem, r]))
  const flagged = new Map<RawRole, RawRole>()
  const yours: RawRole[] = []
  for (const inst of installed.kept) {
    const twin = byStem.get(inst.stem) ?? agency.kept.find((a) => sameName(a.name, inst.name))
    if (twin && !flagged.has(twin)) flagged.set(twin, inst)
    else yours.push({ ...inst, division: YOURS_DIVISION })
  }

  const candidates: { raw: RawRole; installedAs: RawRole | null; base: string }[] = [
    ...raws.filter((r) => r.source === 'builtin').map((raw) => ({ raw, installedAs: null, base: slugify(raw.name) })),
    ...raws.filter((r) => r.source === 'custom').map((raw) => ({ raw: { ...raw, division: CUSTOM_DIVISION }, installedAs: null, base: slugify(raw.stem) })),
    ...agency.kept.map((raw) => ({ raw, installedAs: flagged.get(raw) ?? null, base: slugify(raw.name) })),
    ...yours.map((raw) => ({ raw, installedAs: raw, base: slugify(raw.name) }))
  ].sort((a, b) => RANK[a.raw.source] - RANK[b.raw.source] || a.raw.key.localeCompare(b.raw.key))

  const taken = new Set<string>()
  const roles = candidates.map(({ raw, installedAs, base }): BuiltRole => {
    let id = base
    if (taken.has(id)) id = `${base}-${raw.source}`
    for (let n = 2; taken.has(id); n++) id = `${base}-${raw.source}-${n}`
    taken.add(id)
    const meta = divisionMeta(raw.division, known)
    // Only an installed definition is run by name; a custom or built-in role is handed to Claude Code as text.
    const flaggedInstalled = installedAs !== null && raw.source !== 'custom' && raw.source !== 'builtin'
    const exact = installedAs?.name ?? null
    return {
      id,
      key: raw.key,
      name: raw.name,
      division: raw.division,
      divisionLabel: meta.label,
      emoji: raw.emoji,
      color: meta.color,
      vibe: raw.vibe,
      description: raw.description,
      source: raw.source,
      installed: flaggedInstalled,
      agentName: flaggedInstalled && exact !== null && isSafeAgentName(exact) ? exact : null,
      promptChars: raw.promptChars
    }
  })

  const order = (id: string): number => (id === LEADERSHIP_DIVISION ? 0 : id === CUSTOM_DIVISION ? 2 : id === YOURS_DIVISION ? 3 : 1)
  const counts = new Map<string, number>()
  for (const r of roles) counts.set(r.division, (counts.get(r.division) ?? 0) + 1)
  const divisions = [...new Set([...counts.keys(), CUSTOM_DIVISION])]
    .map((id): RoleDivision => ({ id, ...divisionMeta(id, known), count: counts.get(id) ?? 0 }))
    .filter((d) => d.count > 0 || d.id === CUSTOM_DIVISION)
    .sort((a, b) => order(a.id) - order(b.id) || a.label.localeCompare(b.label))
  const rank = new Map(divisions.map((d, i) => [d.id, i]))
  roles.sort((a, b) => rank.get(a.division)! - rank.get(b.division)! || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
  return { roles, divisions, duplicates: agency.dropped + installed.dropped }
}
