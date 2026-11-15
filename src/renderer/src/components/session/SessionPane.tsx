import { useEffect } from 'react'
import { useUi } from '@/store'
import { findEntry, type SessionEntry } from '@/lib/sessionList'
import { markSeen } from '../console/store'
import { Button, EmptyState, Skeleton } from '../ui'
import { ComposerSlot } from '../shell/ComposerSlot'
import { newSession } from '../shell/actions'
import { useEntries } from '../shell/useEntries'
import { useRoleIndex } from '../shell/useRoleIndex'
import { HereBody } from './HereBody'
import { SessionHeader } from './SessionHeader'
import { WatchedBody, WatchedDock } from './WatchedBody'

/** A selection that matches no session: it ended and left the list, was deleted, or the collector has not listed it yet. */
function NotFound({ loading }: { loading: boolean }) {
  const go = useUi((s) => s.go)
  if (loading) {
    return (
      <div role="status" aria-label="Loading the session" className="mx-auto flex w-full max-w-[760px] flex-col gap-3 px-8 pt-10">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-5" />
        <Skeleton className="h-5 w-5/6" />
      </div>
    )
  }
  return (
    <div role="status" className="mx-auto flex max-w-[460px] flex-col items-center px-6 py-20 text-center">
      <EmptyState center>This session is not in the list any more. It may have been deleted, or it is older than the sessions AgentDeck keeps.</EmptyState>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" onClick={newSession}>
          New session
        </Button>
        <Button onClick={() => go({ page: 'sessions' })}>All sessions</Button>
      </div>
    </div>
  )
}

/** Opening a session reads it: its unread mark goes, in the list and in the notes. */
function useMarkRead(entry: SessionEntry | undefined): void {
  const key = entry?.key
  const unread = entry?.unread === true
  useEffect(() => {
    if (!entry || !unread) return
    const { sessionMeta, setSessionMeta } = useUi.getState()
    if (sessionMeta.sessions[entry.session.id]?.unread) setSessionMeta(entry.session.id, { unread: false })
    if (entry.conv) markSeen(entry.conv)
    // `entry` itself changes on every event; only a different session or a new unread mark is a reason to run again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, unread])
}

/**
 * The session open in the main pane (IA § 4): its header, then the conversation for one started here, or what it did for one AgentDeck
 * only watches, and at the bottom the composer (here) or the two things that work for a session in someone else's window (watched).
 */
export function SessionPane({ sessionKey }: { sessionKey: string }) {
  const entries = useEntries()
  const link = useUi((s) => s.link)
  const roles = useRoleIndex()
  const entry = findEntry(entries, sessionKey)
  useMarkRead(entry)
  if (!entry) return <NotFound loading={link === 'connecting'} />
  const role = entry.role ? roles.get(entry.role) : undefined
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <SessionHeader entry={entry} role={role} />
      {entry.origin === 'here' && entry.conv ? <HereBody conv={entry.conv} /> : <WatchedBody entry={entry} />}
      {entry.origin === 'here' ? <ComposerSlot variant="reply" conv={entry.conv} /> : <WatchedDock entry={entry} />}
    </div>
  )
}
