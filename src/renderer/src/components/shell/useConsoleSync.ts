import { useEffect } from 'react'
import { useUi } from '@/store'
import { findEntry } from '@/lib/sessionList'
import { NEW_SESSION } from '@/store'
import { connectConsole, selectView, useConsole } from '../console/store'
import { useEntries } from './useEntries'

/**
 * The Console store's `selected` is what its composer talks to; the window's nav says what is on screen. This keeps them in step:
 * opening a session started here selects its conversation, the new session screen selects none, and when the composer lets go of the
 * conversation itself (its "New conversation" button after one ends) the window goes to the new session screen. Also connects the
 * Console's events once, so a conversation keeps streaming whichever page is open.
 */
export function useConsoleSync(): void {
  const nav = useUi((s) => s.nav)
  const entries = useEntries()
  const selected = useConsole((s) => s.selected)
  const target = nav.page === 'session' ? (findEntry(entries, nav.session)?.conv ?? null) : nav.page === 'new' ? null : undefined

  useEffect(() => {
    connectConsole()
  }, [])

  // Nav to composer: only when what the page shows changed, not on every event of a streaming conversation.
  useEffect(() => {
    if (target !== undefined && useConsole.getState().selected !== target) selectView(target)
  }, [target, nav.page, nav.session])

  // Composer to nav.
  useEffect(() => {
    if (selected === null && target && useConsole.getState().selected === null) useUi.getState().go(NEW_SESSION)
    // Runs when the composer's selection changes; `target` is read as it is then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])
}
