import { useEffect, useRef, useState } from 'react'
import type { SessionDetail } from '@shared/detail'
import { useUi } from '@/store'
import { demoDetail } from '@/demo/snapshot'

export type Load = { state: 'loading' } | { state: 'missing' } | { state: 'ready'; detail: SessionDetail }

/** A busy session emits several events a second; each read runs SQLite queries on the collector's hook thread. */
const REFETCH_MS = 500

/**
 * What the collector knows of one session (plan, files, timeline, final message). Live: refetched when the session's last event moves,
 * at most every REFETCH_MS, so the panel follows it. A failed read (collector busy or restarting) keeps what is on screen. Demo: built
 * from the snapshot. `id` is the Claude Code session id, or null for a conversation that has not been named yet (nothing to read).
 */
export function useDetail(id: string | null): Load {
  const snapshot = useUi((s) => s.snapshot)
  const live = snapshot.sessions.find((s) => s.id === id)
  // Keyed by session, so switching rows never shows the previous session's detail.
  const [got, setGot] = useState<{ id: string; detail: SessionDetail | null } | null>(null)
  const last = useRef<{ id: string; at: number } | null>(null)
  const demo = snapshot.mode === 'demo' || !window.agentdeck
  const stamp = live?.lastEventAt

  useEffect(() => {
    if (!id || demo) return
    let current = true
    const wait = last.current?.id === id ? Math.max(0, last.current.at + REFETCH_MS - Date.now()) : 0
    const timer = setTimeout(() => {
      last.current = { id, at: Date.now() }
      void window.agentdeck!
        .getDetail(id)
        .catch(() => null)
        .then((detail) => {
          if (current) setGot((prev) => (detail === null && prev?.id === id && prev.detail ? prev : { id, detail }))
        })
    }, wait)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [id, demo, stamp])

  if (!id) return { state: 'missing' }
  if (demo) return live ? { state: 'ready', detail: demoDetail(live, snapshot) } : { state: 'missing' }
  if (got?.id !== id) return { state: 'loading' }
  if (!got.detail) return { state: 'missing' }
  // The snapshot's copy of the session is newer than the detail's between two fetches.
  return { state: 'ready', detail: live ? { ...got.detail, session: live } : got.detail }
}
