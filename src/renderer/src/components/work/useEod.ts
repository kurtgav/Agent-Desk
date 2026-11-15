import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ActionResult } from '@shared/bridge'
import { EOD_DEFAULTS, type EodDay, type EodReport, type EodSettings, type WorkTask } from '@shared/work'
import { useUi } from '@/store'
import { demoEod, demoEodDays } from '@/demo/work'
import { dayKey } from '@/lib/work'
import { useTasks } from './tasksStore'
import { canFollowWork, useWorkPush } from './useWorkPush'

/** Without the push, today's report is read again when the snapshot changes, but not more often than this. */
const REFRESH_MIN_MS = 5_000
/** Notes are saved this long after the last key press. */
const AUTOSAVE_MS = 800

/** No bridge (a plain browser) or demo mode: the report is built from demo data and nothing is read or written. */
export function useIsDemo(): boolean {
  return useUi((s) => s.snapshot.mode === 'demo') || !window.agentdeck
}

/**
 * Runs `refresh` now, and again as the day moves (`follow`). The collector says when it moved (`work-changed`, at most
 * one read a second); the 30 s tick stays as the slow pace agent time moves at. Where there is no push (a plain browser),
 * the snapshot changing drives it instead, at most once every REFRESH_MIN_MS. With `follow` off (a closed day) it runs
 * once per `key`.
 */
function useRefresh(refresh: () => void, enabled: boolean, follow: boolean, key: string): void {
  const at = useUi((s) => s.snapshot.generatedAt)
  const now = useUi((s) => s.now)
  const pushed = canFollowWork()
  const last = useRef({ key: '', at: 0 })
  const stamp = follow ? (pushed ? String(now) : `${at}:${now}`) : 'once'
  useEffect(() => {
    if (!enabled) return
    // A new key (another day) is read at once; only repeats for the same key are held back.
    const wait = last.current.key === key ? Math.max(0, last.current.at + REFRESH_MIN_MS - Date.now()) : 0
    const t = setTimeout(() => {
      last.current = { key, at: Date.now() }
      refresh()
    }, wait)
    return () => clearTimeout(t)
  }, [enabled, stamp, key, refresh])
  useWorkPush(refresh, enabled && follow && pushed)
}

/** The tasks the demo report is built from. Seeded here too, so the report is whole without a visit to Tasks first. */
function useDemoTasks(demo: boolean): WorkTask[] {
  const tasks = useTasks((s) => s.tasks)
  const refresh = useTasks((s) => s.refresh)
  useEffect(() => {
    if (demo) void refresh()
  }, [demo, refresh])
  return tasks
}

/** The page follows the collector's pushes, so what it shows is live (not the demo, not a page without the bridge). */
export function useEodLive(): boolean {
  const demo = useIsDemo()
  return !demo && canFollowWork()
}

/** Days that have a report, newest first as the collector lists them. Null while the first read is out. */
export function useEodDays(): EodDay[] | null {
  const demo = useIsDemo()
  const snapshot = useUi((s) => s.snapshot)
  const now = useUi((s) => s.now)
  const tasks = useDemoTasks(demo)
  const [got, setGot] = useState<EodDay[] | null>(null)
  const refresh = useCallback(() => {
    void window.agentdeck!
      .listEodDays()
      .catch(() => null)
      .then((list) => setGot((prev) => list ?? prev ?? []))
  }, [])
  useRefresh(refresh, !demo, true, 'days')
  const demoDays = useMemo(() => (demo ? demoEodDays(snapshot, tasks, Math.max(now, snapshot.generatedAt)) : null), [demo, snapshot, tasks, now])
  return demo ? demoDays : got
}

/**
 * One day's report. Today's follows the snapshot; a closed day is read once. A failed read keeps the report on screen
 * and says so only when there is none.
 */
export function useEodReport(day: string): { report: EodReport | null; failed: boolean; reload(): void } {
  const demo = useIsDemo()
  const snapshot = useUi((s) => s.snapshot)
  const now = useUi((s) => s.now)
  const today = dayKey(now)
  const tasks = useDemoTasks(demo)
  const [got, setGot] = useState<{ day: string; report: EodReport | null } | null>(null)
  const seq = useRef(0)
  const refresh = useCallback(() => {
    const n = ++seq.current
    void window.agentdeck!
      .getEod(day)
      .catch(() => null)
      .then((report) => {
        if (n === seq.current) setGot((prev) => (report ? { day, report } : prev?.day === day ? prev : { day, report: null }))
      })
  }, [day])
  useRefresh(refresh, !demo, day === today, day)
  const demoReport = useMemo(() => (demo ? demoEod(day, snapshot, tasks, demoNotes, Math.max(now, snapshot.generatedAt)) : null), [demo, day, snapshot, tasks, now])
  if (demo) return { report: demoReport, failed: demoReport === null, reload: () => undefined }
  const mine = got?.day === day ? got.report : null
  return { report: mine, failed: got?.day === day && mine === null, reload: refresh }
}

/** `config.json` → `eod`, for the status line. Null until read; the defaults when there is no bridge. */
export function useEodSettings(): EodSettings | null {
  const [eod, setEod] = useState<EodSettings | null>(() => (window.agentdeck ? null : EOD_DEFAULTS))
  useEffect(() => {
    if (!window.agentdeck) return
    let current = true
    void window.agentdeck
      .getSettings()
      .then((s) => current && setEod(s.eod))
      .catch(() => current && setEod(EOD_DEFAULTS))
    return () => {
      current = false
    }
  }, [])
  return eod
}

// ---- Notes -------------------------------------------------------------------------------------------------------

/** Notes typed in this demo run; replaced, never edited in place. */
let demoNotes: ReadonlyMap<string, string> = new Map()

async function persistNotes(day: string, notes: string, demo: boolean): Promise<ActionResult> {
  if (demo) {
    demoNotes = new Map(demoNotes).set(day, notes)
    return { ok: true }
  }
  return window.agentdeck!.saveEodNotes(day, notes).catch((): ActionResult => ({ ok: false, error: 'AgentDeck could not save the notes.' }))
}

export type NotesState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * The notes field's text and its autosave. The text lives here, not in the report, so a refresh of the report never
 * replaces what is being typed and a failed save never loses it: it stays, the state says `error`, and the next
 * key press (or `retry`) tries again. Whatever is unsaved is sent when the field goes away.
 */
export function useNotes(day: string, initial: string): { text: string; state: NotesState; edit(next: string): void; retry(): void } {
  const demo = useIsDemo()
  const [text, setText] = useState(initial)
  const [state, setState] = useState<NotesState>('idle')
  // Bookkeeping that must not re-render: the newest text, the last text known saved, the pending timer.
  const [box] = useState(() => ({ latest: initial, saved: initial, timer: undefined as ReturnType<typeof setTimeout> | undefined, mounted: true }))

  const save = useCallback(async (): Promise<void> => {
    clearTimeout(box.timer)
    const value = box.latest
    if (value === box.saved) return setState('saved')
    setState('saving')
    const r = await persistNotes(day, value, demo)
    if (!box.mounted) return
    if (!r.ok) return setState('error')
    box.saved = value
    if (box.latest === value) setState('saved') // typing since then keeps "Saving…" until its own save lands
  }, [box, day, demo])

  const edit = (next: string): void => {
    setText(next)
    box.latest = next
    setState('saving')
    clearTimeout(box.timer)
    box.timer = setTimeout(() => void save(), AUTOSAVE_MS)
  }

  useEffect(() => {
    box.mounted = true
    return () => {
      box.mounted = false
      clearTimeout(box.timer)
      if (box.latest !== box.saved) {
        void persistNotes(day, box.latest, demo).then((r) => {
          if (!r.ok) useUi.getState().notify(`Your notes for ${day} could not be saved: ${r.error}`, 'error')
        })
      }
    }
  }, [box, day, demo])

  return { text, state, edit, retry: () => void save() }
}
