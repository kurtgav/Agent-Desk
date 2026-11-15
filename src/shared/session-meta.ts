import { z } from 'zod'
import { ROLE_ID } from './roles'

/**
 * Local notes about sessions that Claude Code does not keep: pinned, unread, a display name, archived, a section.
 * They live in config.json (`sessionMeta` and `sections`), never in Claude Code's files (ADR-0009), and this module is
 * the one place that reads, checks and changes them, for main (what it stores) and the window (what it shows at once).
 * Pure: no Node, no Electron.
 */

export const META_MAX_ENTRIES = 2_000
export const SECTIONS_MAX = 20
export const SECTION_NAME_MAX = 40
export const ALIAS_MAX = 80
/** An entry for a session no snapshot has listed for this long is dropped. */
export const META_KEEP_MS = 90 * 86_400_000
/** A sighting is written back at most this often, so a busy snapshot stream never rewrites config.json. */
export const SEEN_REFRESH_MS = 6 * 3_600_000

/** Said in the menu's tooltip and by main when asked to delete a session Claude Code keeps: AgentDeck never deletes its files. */
export const NOT_DELETABLE = "Claude Code keeps this session's history. AgentDeck can archive it, but it never deletes Claude Code's files."

const PROTO = '__proto__'
const ID = /^[\w.:-]{1,128}$/
export const validId = (id: string): boolean => ID.test(id) && id !== PROTO

/** One line: control and direction characters become spaces, runs collapse, cut at `max` characters (not UTF-16 units). */
export function oneLine(raw: string, max: number): string {
  const line = raw.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim()
  return Array.from(line).slice(0, max).join('').trim()
}

// ---- What a session's entry holds ---------------------------------------------------------------------------------

/** A bad field reads as absent; keys this version does not know are kept as they are. */
const flag = z.boolean().optional().catch(undefined)
export const SessionMetaEntry = z.looseObject({
  pinned: flag,
  unread: flag,
  archived: flag,
  alias: z.string().optional().catch(undefined),
  section: z.string().optional().catch(undefined),
  /** When a snapshot last listed the session (ms epoch); the 90-day clock. */
  seenAt: z.number().int().nonnegative().optional().catch(undefined),
  /** The Roles catalog id this session runs as, for sessions AgentDeck started. Set by main only (the window cannot patch it). */
  role: z.string().regex(ROLE_ID).optional().catch(undefined)
})
export type SessionMetaEntry = z.infer<typeof SessionMetaEntry>

export interface SessionMetaState {
  sessions: Record<string, SessionMetaEntry>
  /** The user's sections, in the order they were made. */
  sections: string[]
}
export const EMPTY_META: SessionMetaState = { sessions: {}, sections: [] }

/** What the window may change. `false`, `null` and an empty alias take the note off. */
export const SessionMetaPatchSchema = z
  .object({
    pinned: z.boolean(),
    unread: z.boolean(),
    archived: z.boolean(),
    alias: z.string().max(500).nullable(),
    section: z.string().max(200).nullable()
  })
  .partial()
  .strict()
export type SessionMetaPatch = z.infer<typeof SessionMetaPatchSchema>

export const SectionOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), name: z.string().max(500) }).strict(),
  z.object({ op: z.literal('rename'), from: z.string().max(500), to: z.string().max(500) }).strict(),
  z.object({ op: z.literal('delete'), name: z.string().max(500) }).strict()
])
export type SectionOp = z.infer<typeof SectionOpSchema>

export type SessionMetaResult = { ok: true; state: SessionMetaState } | { ok: false; error: string }

// ---- Reading ------------------------------------------------------------------------------------------------------

const same = (a: string, b: string): boolean => a.toLocaleLowerCase() === b.toLocaleLowerCase()
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Cleaned, unique (ignoring case), at most SECTIONS_MAX. */
function cleanSections(raw: unknown): string[] {
  const out: string[] = []
  if (!Array.isArray(raw)) return out
  for (const v of raw) {
    const name = typeof v === 'string' ? oneLine(v, SECTION_NAME_MAX) : ''
    if (name && !out.some((o) => same(o, name)) && out.length < SECTIONS_MAX) out.push(name)
  }
  return out
}

/** Drops what says nothing (a false flag, an empty alias, a section that is gone); null when nothing else is left. */
function tidy(e: SessionMetaEntry, sections: readonly string[]): SessionMetaEntry | null {
  const out = Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined && v !== false)) as SessionMetaEntry
  const alias = typeof out.alias === 'string' ? oneLine(out.alias, ALIAS_MAX) : ''
  if (alias) out.alias = alias
  else delete out.alias
  const section = typeof out.section === 'string' ? sections.find((s) => same(s, out.section as string)) : undefined
  if (section) out.section = section
  else delete out.section
  const left = Object.keys(out).filter((k) => k !== 'seenAt')
  return left.length ? out : null
}

/** What config.json holds, checked entry by entry: one bad entry never costs the rest. */
export function readMeta(raw: { sessionMeta?: unknown; sections?: unknown }, now: number): SessionMetaState {
  const sections = cleanSections(raw.sections)
  const sessions: Record<string, SessionMetaEntry> = {}
  if (isRecord(raw.sessionMeta)) {
    for (const [id, value] of Object.entries(raw.sessionMeta)) {
      if (!validId(id)) continue
      const parsed = SessionMetaEntry.safeParse(value)
      const entry = parsed.success ? tidy(parsed.data, sections) : null
      if (entry) sessions[id] = { ...entry, seenAt: entry.seenAt ?? now }
    }
  }
  return prune({ sessions, sections }, now)
}

/** The config.json keys for `state`. */
export const toConfig = (state: SessionMetaState): { sessionMeta: Record<string, SessionMetaEntry>; sections: string[] } => ({
  sessionMeta: state.sessions,
  sections: state.sections
})

/** Entries not seen for META_KEEP_MS go; past META_MAX_ENTRIES the pinned and the most recently seen stay. */
export function prune(state: SessionMetaState, now: number): SessionMetaState {
  const kept = Object.entries(state.sessions).filter(([, e]) => (e.seenAt ?? now) >= now - META_KEEP_MS)
  if (kept.length === Object.keys(state.sessions).length && kept.length <= META_MAX_ENTRIES) return state
  const rank = ([, e]: [string, SessionMetaEntry]): number => (e.pinned ? Number.MAX_SAFE_INTEGER : (e.seenAt ?? now))
  const top = kept.sort((a, b) => rank(b) - rank(a)).slice(0, META_MAX_ENTRIES)
  return { ...state, sessions: Object.fromEntries(top) }
}

// ---- Changing -----------------------------------------------------------------------------------------------------

const fail = (error: string): SessionMetaResult => ({ ok: false, error })

// ---- Roles of sessions AgentDeck started ----------------------------------------------------------------------------

/**
 * Where a session's role is kept. A Console conversation is known by its Claude Code session id (`init`); a `--bg` dispatch is known
 * first by the name AgentDeck gave it and by the id `claude --bg` printed, before the poll has seen its session id. A page looks a
 * session up with `roleOf`, which tries all three.
 * shortcut: the `name:` and `bg:` entries are not refreshed by `touchSessions`, so they expire 90 days after they were written; the
 * session lists only show the last week, so no badge is lost that could still be on screen.
 */
export const nameKey = (name: string): string => `name:${name}`
export const bgKey = (bgId: string): string => `bg:${bgId}`

/** The role id of a session, if AgentDeck started it with one. */
export function roleOf(state: SessionMetaState, s: { id: string; bgId?: string | null; name?: string }): string | null {
  const keys = [s.id, ...(s.bgId ? [bgKey(s.bgId)] : []), ...(s.name ? [nameKey(s.name)] : [])]
  for (const k of keys) {
    const r = state.sessions[k]?.role
    if (r) return r
  }
  return null
}

/** Notes the role under each key (written by main when the id or the name becomes known). Invalid keys or ids change nothing. */
export function setRole(state: SessionMetaState, keys: readonly string[], role: string, now: number): SessionMetaState {
  if (!ROLE_ID.test(role)) return state
  const sessions = { ...state.sessions }
  for (const key of keys) if (validId(key)) sessions[key] = { ...sessions[key], role, seenAt: now }
  return prune({ ...state, sessions }, now)
}

/** Applies one patch to one session; the answer carries a sentence the window can show when it is refused. */
export function applyPatch(state: SessionMetaState, id: string, patch: SessionMetaPatch, now: number): SessionMetaResult {
  if (!validId(id)) return fail('AgentDeck does not know this session.')
  const next: SessionMetaEntry = { ...state.sessions[id], seenAt: now }
  if (patch.pinned !== undefined) next.pinned = patch.pinned
  if (patch.unread !== undefined) next.unread = patch.unread
  if (patch.archived !== undefined) next.archived = patch.archived
  if (patch.alias !== undefined) next.alias = patch.alias === null ? undefined : oneLine(patch.alias, ALIAS_MAX)
  if (patch.section !== undefined) {
    const section = patch.section === null ? undefined : state.sections.find((s) => same(s, patch.section as string))
    if (patch.section !== null && !section) return fail('That section is gone. Pick another one.')
    next.section = section
  }
  const entry = tidy(next, state.sections)
  const others = Object.entries(state.sessions).filter(([k]) => k !== id)
  return { ok: true, state: prune({ ...state, sessions: Object.fromEntries(entry ? [...others, [id, entry]] : others) }, now) }
}

/** Adds, renames or deletes a section. Deleting only un-files its sessions; renaming moves them along. */
export function applySectionOp(state: SessionMetaState, op: SectionOp, now: number): SessionMetaResult {
  if (op.op === 'add') {
    const name = oneLine(op.name, SECTION_NAME_MAX)
    if (!name) return fail('Give the section a name.')
    if (state.sections.some((s) => same(s, name))) return fail(`There is already a section called ${name}.`)
    if (state.sections.length >= SECTIONS_MAX) return fail(`AgentDeck keeps up to ${SECTIONS_MAX} sections. Delete one first.`)
    return { ok: true, state: { ...state, sections: [...state.sections, name] } }
  }
  const from = state.sections.find((s) => same(s, op.op === 'rename' ? op.from : op.name))
  if (!from) return fail('That section is gone.')
  const refile = (to: string | undefined): SessionMetaState['sessions'] =>
    Object.fromEntries(
      Object.entries(state.sessions).flatMap(([id, e]) => {
        const moved = e.section === from ? tidy({ ...e, section: to }, to ? [to] : []) : e
        return moved ? [[id, moved]] : []
      })
    )
  if (op.op === 'delete') return { ok: true, state: prune({ sections: state.sections.filter((s) => s !== from), sessions: refile(undefined) }, now) }
  const to = oneLine(op.to, SECTION_NAME_MAX)
  if (!to) return fail('Give the section a name.')
  if (state.sections.some((s) => s !== from && same(s, to))) return fail(`There is already a section called ${to}.`)
  return { ok: true, state: { sections: state.sections.map((s) => (s === from ? to : s)), sessions: refile(to) } }
}

/** Notes that these sessions are listed now. Returns `state` itself when nothing needs writing. */
export function touch(state: SessionMetaState, ids: readonly string[], now: number): SessionMetaState {
  let changed = false
  const sessions = { ...state.sessions }
  for (const id of ids) {
    const e = sessions[id]
    if (e && (e.seenAt === undefined || now - e.seenAt > SEEN_REFRESH_MS)) {
      sessions[id] = { ...e, seenAt: now }
      changed = true
    }
  }
  return changed ? { ...state, sessions } : state
}
