import type { ConsoleState } from '@shared/console'
import type { SessionMetaState } from '@shared/session-meta'
import type { Session, Status } from '@shared/snapshot'
import { pathKey } from '@shared/paths'
import { projectName } from './selectors'
import { isArchived, isPinned, isUnread, nameOf, noteOf, shownIn } from './sessionMeta'

/**
 * One list of every session AgentDeck knows (IA § 1): the conversations it started itself (the Console's) and the ones it only
 * watches (started in a terminal, Claude Desktop, VS Code or with --bg). Pure: the sidebar, the palette, Ctrl+1..9 and the
 * "Recent sessions" on the new session screen all read the same entries.
 */

/** What this module needs of a conversation (console/store.ts `ConvView` satisfies it). */
export interface ConversationLike {
  info: { id: string; title: string; cwd: string; startedAt: number }
  thread: { state: ConsoleState; sessionId: string | null; error: string | null; lastAt: number; turnStartedAt: number | null }
  unread: boolean
}

export type Origin = 'here' | 'watching'

export interface SessionEntry {
  /** What the window selects (`nav.session`): the conversation's id for one started here (it exists before Claude Code names a session), else the session id. */
  key: string
  origin: Origin
  /** The snapshot's session, or one made from the conversation while the collector has not reported it. The session menu and the actions take this. */
  session: Session
  /** The Console conversation id; null for a session that is only watched. */
  conv: string | null
  /** The name you gave it, else Claude Code's (or the conversation's title). */
  name: string
  /** A roles catalog id, when the session was started as a role. */
  role: string | null
  pinned: boolean
  archived: boolean
  unread: boolean
  /** Last activity, ms epoch. */
  at: number
  /** Folder name, '' when unknown. */
  project: string
}

const STATUS_OF: Record<ConsoleState, Status> = { starting: 'working', working: 'working', idle: 'idle', ended: 'done', failed: 'failed' }
const ACTIVITY_OF: Record<ConsoleState, string> = { starting: 'Starting', working: 'Working', idle: 'Waiting for your reply', ended: 'Ended', failed: 'Failed' }

/** The role key a session carries in its local notes (set when it was started as a role); absent for most. */
export function roleOf(meta: SessionMetaState, id: string): string | null {
  const role = noteOf(meta, id)?.['role']
  return typeof role === 'string' && role ? role : null
}

function synthesize(conv: ConversationLike): Session {
  const { info, thread } = conv
  return {
    id: thread.sessionId ?? info.id,
    bgId: null,
    name: info.title,
    cwd: info.cwd,
    surface: 'sdk',
    status: STATUS_OF[thread.state],
    startedAt: info.startedAt,
    lastEventAt: Math.max(info.startedAt, thread.lastAt),
    activity: thread.state === 'failed' && thread.error ? thread.error : ACTIVITY_OF[thread.state],
    plan: null,
    waitingSince: null,
    subagents: []
  }
}

function hereEntry(conv: ConversationLike, seen: Session | undefined, meta: SessionMetaState): SessionEntry {
  // The collector's copy is richer (plan, subagents, status from hooks); the conversation's title and activity time still lead.
  const session: Session = seen ? { ...seen, name: conv.info.title, lastEventAt: Math.max(seen.lastEventAt, conv.thread.lastAt) } : synthesize(conv)
  return entry('here', conv.info.id, session, conv.info.id, meta, conv.unread)
}

function entry(origin: Origin, key: string, session: Session, conv: string | null, meta: SessionMetaState, unread = false): SessionEntry {
  return {
    key,
    origin,
    session,
    conv,
    name: nameOf(meta, session),
    role: roleOf(meta, session.id),
    pinned: isPinned(meta, session.id),
    archived: isArchived(meta, session.id),
    unread: unread || isUnread(meta, session.id),
    at: session.lastEventAt,
    project: projectName(session.cwd)
  }
}

/** Started-here conversations joined with the collector's sessions: a conversation Claude Code has named is one entry, not two. Newest activity first. */
export function mergeSessions(sessions: readonly Session[], convs: Readonly<Record<string, ConversationLike>>, meta: SessionMetaState): SessionEntry[] {
  const bySession = new Map(sessions.map((s) => [s.id, s]))
  const joined = new Set<string>()
  const here = Object.values(convs).map((c) => {
    const seen = c.thread.sessionId ? bySession.get(c.thread.sessionId) : undefined
    if (seen) joined.add(seen.id)
    return hereEntry(c, seen, meta)
  })
  const watching = sessions.filter((s) => !joined.has(s.id)).map((s) => entry('watching', s.id, s, null, meta))
  return [...here, ...watching].sort((a, b) => b.at - a.at)
}

/** The entry a selection names. It may be the entry's key or the session id of one started here (a Needs-you row knows only the session). */
export function findEntry(entries: readonly SessionEntry[], key: string | undefined): SessionEntry | undefined {
  if (!key) return undefined
  return entries.find((e) => e.key === key) ?? entries.find((e) => e.session.id === key)
}

/** What the sidebar lists: archived sessions stay out (a waiting one is still in Needs you). */
export function listable(entries: readonly SessionEntry[], meta: SessionMetaState): SessionEntry[] {
  return entries.filter((e) => shownIn('sessions', e.session, meta))
}

// ---- Grouping -----------------------------------------------------------------------------------------------------

export type TimeBucket = 'today' | 'yesterday' | 'week' | 'earlier'
const BUCKET_TITLE: Record<TimeBucket, string> = { today: 'Today', yesterday: 'Yesterday', week: 'This week', earlier: 'Earlier' }
const BUCKETS: readonly TimeBucket[] = ['today', 'yesterday', 'week', 'earlier']
const DAY = 86_400_000

/** Local midnight `back` calendar days before `ms`: setDate, not 24 h steps, because a daylight-saving day is 23 or 25 hours long. */
function startOfDay(ms: number, back = 0): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - back)
  return d.getTime()
}

/** By local calendar day: today, yesterday, the days before that back to six days ago ("this week"), then everything older. */
export function timeBucket(at: number, now: number): TimeBucket {
  if (at >= startOfDay(now)) return 'today'
  if (at >= startOfDay(now, 1)) return 'yesterday'
  return at >= startOfDay(now, 6) ? 'week' : 'earlier'
}

export interface SessionSection {
  key: string
  title: string
  entries: SessionEntry[]
}

export interface SidebarList {
  pinned: SessionEntry[]
  sections: SessionSection[]
}

export type GroupBy = 'time' | 'project'

/** Pinned first (newest activity first), then the rest by time bucket or by project. Empty sections are left out. */
export function buildList(entries: readonly SessionEntry[], now: number, by: GroupBy): SidebarList {
  const pinned = entries.filter((e) => e.pinned).sort((a, b) => b.at - a.at)
  const rest = entries.filter((e) => !e.pinned).sort((a, b) => b.at - a.at)
  if (by === 'project') {
    const groups = new Map<string, SessionSection>()
    for (const e of rest) {
      const key = e.session.cwd ? pathKey(e.session.cwd) : ''
      const g = groups.get(key) ?? { key: `project:${key}`, title: e.project || 'No folder', entries: [] }
      g.entries.push(e)
      groups.set(key, g)
    }
    // Insertion order is newest activity first, because `rest` is sorted.
    return { pinned, sections: [...groups.values()] }
  }
  const sections = BUCKETS.map((b): SessionSection => ({ key: `time:${b}`, title: BUCKET_TITLE[b], entries: rest.filter((e) => timeBucket(e.at, now) === b) }))
  return { pinned, sections: sections.filter((s) => s.entries.length > 0) }
}

/** The order the sidebar shows them in: what Ctrl+1..9 counts. */
export const displayOrder = (list: SidebarList): SessionEntry[] => [...list.pinned, ...list.sections.flatMap((s) => s.entries)]

/** The sessions in the order the sidebar shows them: what Ctrl+1..9 counts, and what a search jumps through. */
export const sidebarOrder = (entries: readonly SessionEntry[], meta: SessionMetaState, now: number, by: GroupBy): SessionEntry[] => displayOrder(buildList(listable(entries, meta), now, by))

/** The relative time a row shows: "now", "5m", "3h", "Tue", "Nov 4". */
export function shortAgo(at: number, now: number): string {
  const ms = Math.max(0, now - at)
  if (ms < 60_000) return 'now'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`
  if (timeBucket(at, now) === 'today') return `${Math.floor(ms / 3_600_000)}h`
  if (ms < 6 * DAY) return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(at)
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(at)
}
