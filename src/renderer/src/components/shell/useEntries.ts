import { useMemo } from 'react'
import { useUi } from '@/store'
import { mergeSessions, type SessionEntry } from '@/lib/sessionList'
import { useConsole } from '../console/store'

/** Every session AgentDeck knows, started here or watched, newest activity first. The one source the sidebar, the palette and the pane read. */
export function useEntries(): SessionEntry[] {
  const sessions = useUi((s) => s.snapshot.sessions)
  const meta = useUi((s) => s.sessionMeta)
  const convs = useConsole((s) => s.convs)
  return useMemo(() => mergeSessions(sessions, convs, meta), [sessions, convs, meta])
}

/** The same, read once outside a component (the palette and the shortcuts run from events). */
export function currentEntries(): SessionEntry[] {
  return mergeSessions(useUi.getState().snapshot.sessions, useConsole.getState().convs, useUi.getState().sessionMeta)
}
