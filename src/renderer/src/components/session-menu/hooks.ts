import type { SessionMetaEntry } from '@shared/session-meta'
import type { Session } from '@shared/snapshot'
import { useUi } from '@/store'
import { noteOf } from '@/lib/sessionMeta'

/** The local notes about one session. Only that session's row re-renders when they change. */
export function useNote(id: string): SessionMetaEntry | undefined {
  return useUi((s) => noteOf(s.sessionMeta, id))
}

/** The name you gave the session, otherwise Claude Code's ('' for no session). A string, so a row re-renders only when its own name changes. */
export function useDisplayName(session: Pick<Session, 'id' | 'name'> | null | undefined): string {
  return useUi((s) => (session ? noteOf(s.sessionMeta, session.id)?.alias || session.name : ''))
}
