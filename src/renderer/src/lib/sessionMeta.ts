import type { SessionMetaEntry, SessionMetaState } from '@shared/session-meta'
import type { Session } from '@shared/snapshot'

/** What the window shows from the local notes about sessions (shared/session-meta.ts): names, order, what is hidden, groups. */

export const noteOf = (meta: SessionMetaState, id: string): SessionMetaEntry | undefined => (Object.hasOwn(meta.sessions, id) ? meta.sessions[id] : undefined)

/** The name you gave it, otherwise the one Claude Code gave it. */
export const nameOf = (meta: SessionMetaState, s: Pick<Session, 'id' | 'name'>): string => noteOf(meta, s.id)?.alias || s.name

export const isPinned = (meta: SessionMetaState, id: string): boolean => noteOf(meta, id)?.pinned === true
export const isUnread = (meta: SessionMetaState, id: string): boolean => noteOf(meta, id)?.unread === true
export const isArchived = (meta: SessionMetaState, id: string): boolean => noteOf(meta, id)?.archived === true

/** Working, or waiting for you: the sessions an archive never hides from where you answer them. */
export const isRunning = (s: Pick<Session, 'status'>): boolean => s.status === 'working' || s.status === 'needs_you'

/** The places a session is listed. `running` is Home's Running now, `needs-you` the rows of Needs you and Approvals. */
export type Place = 'sessions' | 'agents' | 'running' | 'needs-you'

/**
 * Archive hides a session from Sessions, and from Your agents once it is not running. A running or waiting session stays
 * in Running now and in Needs you, so archiving never hides something that is asking for you.
 */
export function shownIn(place: Place, s: Pick<Session, 'id' | 'status'>, meta: SessionMetaState): boolean {
  if (!isArchived(meta, s.id)) return true
  return place === 'sessions' ? false : place === 'agents' ? isRunning(s) : true
}

/** Pinned sessions first, every other order kept as it was. */
export function pinnedFirst<T extends Pick<Session, 'id'>>(list: readonly T[], meta: SessionMetaState): T[] {
  return [...list.filter((s) => isPinned(meta, s.id)), ...list.filter((s) => !isPinned(meta, s.id))]
}

export interface SessionGroup {
  /** Stable across renders: `pinned`, `rest`, or `section:<name>`. */
  key: string
  /** The heading; null for a list with no sections, which needs none. */
  title: string | null
  kind: 'pinned' | 'section' | 'rest'
  sessions: Session[]
}

/**
 * The Sessions page's groups. With no sections it is one list, pinned first. With sections: Pinned, then each section in
 * the order it was made (empty ones too, so they can be renamed or deleted), then the rest. A pinned session lives in Pinned.
 */
export function groupSessions(list: readonly Session[], meta: SessionMetaState): SessionGroup[] {
  const pinned = list.filter((s) => isPinned(meta, s.id))
  const others = list.filter((s) => !isPinned(meta, s.id))
  if (!meta.sections.length) return [{ key: 'all', title: null, kind: 'rest', sessions: [...pinned, ...others] }]
  const filed = (name: string): Session[] => others.filter((s) => noteOf(meta, s.id)?.section === name)
  const inSection = new Set(meta.sections.flatMap((name) => filed(name).map((s) => s.id)))
  return [
    ...(pinned.length ? [{ key: 'pinned', title: 'Pinned', kind: 'pinned' as const, sessions: pinned }] : []),
    ...meta.sections.map((name) => ({ key: `section:${name}`, title: name, kind: 'section' as const, sessions: filed(name) })),
    { key: 'rest', title: 'Not in a section', kind: 'rest' as const, sessions: others.filter((s) => !inSection.has(s.id)) }
  ]
}

/** Pinned sessions the snapshot lists, the most recently active first (the sidebar's Pinned group). */
export function pinnedSessions(sessions: readonly Session[], meta: SessionMetaState): Session[] {
  return sessions.filter((s) => isPinned(meta, s.id)).sort((a, b) => b.lastEventAt - a.lastEventAt)
}
