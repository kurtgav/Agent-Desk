import { createHash } from 'node:crypto'
import type { WorkReq, WorkRes } from '@shared/collector'
import { dayKey } from '@shared/day'
import { hasContent, renderEodMarkdown } from '@shared/eod-markdown'
import type { EodReport, EodSettings, EodWrite } from '@shared/work'
import { changeDelay, dueAction, inCatchUpWindow, initialState, published, rollState, type EodAction, type EodState } from './eod-schedule'

/** Everything the scheduler touches outside itself, so a test can stand in for the collector, the disk and the clock. */
export interface SchedulerDeps {
  now(): number
  /** Read on every tick, so a change in Settings applies without any wiring. */
  settings(): EodSettings
  folder(settings: EodSettings): string
  /** Null when the collector is down or demo data is on. */
  ask(req: WorkReq): Promise<WorkRes | null>
  write(folder: string, report: EodReport): EodWrite
  fileExists(folder: string, day: string): boolean
  log(message: string): void
  /** A one-shot timer; returns the way to cancel it. Defaults to `setTimeout`. */
  after?(ms: number, fn: () => void): () => void
}

/** Nothing in main writes a log file yet (ARCHITECTURE § 8); until it does, a scheduler problem goes to stderr, like the other `[hooks]` and `[collector]` lines. */
export const logError = (message: string): void => void process.stderr.write(`[eod] ${message}
`)

const defaultAfter = (ms: number, fn: () => void): (() => void) => {
  const t = setTimeout(fn, ms)
  t.unref()
  return () => clearTimeout(t)
}

const fingerprint = (report: EodReport): string => createHash('sha256').update(renderEodMarkdown(report)).digest('hex')

export interface Scheduler {
  tick(): Promise<void>
  /** The collector said tasks or the report changed. Marks today's file stale and arms the one timer that rewrites it. */
  changed(): void
  /** Cancels the timer. */
  stop(): void
  state(): EodState
}

/**
 * Runs the decisions of `dueAction`: the past days are closed (catch-up), and from the daily time on today's file is
 * refreshed: when the collector reports a change (no more than every 30 s, after a short settle), and once in a while
 * without one. One tick at a time, so one write at a time; a failure is retried on a later tick, never lost silently.
 */
export function createScheduler(deps: SchedulerDeps): Scheduler {
  const after = deps.after ?? defaultAfter
  let state = initialState()
  let busy = false
  /** The settings the last tick read, so a change can tell whether the daily time has come without reading the config again. */
  let seen: EodSettings | null = null
  let cancelTimer: (() => void) | null = null
  /** The refresh could not be done (collector silent, write failed): the next minute's tick tries again, not a timer. */
  let retryOnTick = false
  /** Closed days whose file did not get written; the next catch-up tries them again. */
  const unwritten = new Set<string>()
  /** What was last written for each day, so identical content is never written twice; a day whose write failed is written next time. */
  const written = new Map<string, string>()
  const failedToday = new Set<string>()

  /** Closes a day that is over (once) and writes its file for the last time. True when nothing is left to do for it. */
  async function close(day: string, folder: string): Promise<boolean> {
    const res = await deps.ask({ kind: 'eod.finalize', day })
    if (res?.kind !== 'finalized') return false
    if (!hasContent(res.report)) return true
    // A day closed on an earlier run already has its final file: leave it.
    if (!res.fresh && deps.fileExists(folder, day)) return true
    const w = deps.write(folder, res.report)
    if (w.ok) {
      unwritten.delete(day)
      written.delete(day)
      failedToday.delete(day)
      return true
    }
    if (!unwritten.has(day)) deps.log(w.error)
    unwritten.add(day)
    return false
  }

  async function catchUp(now: number, folder: string): Promise<boolean> {
    const res = await deps.ask({ kind: 'eod.days' })
    if (res?.kind !== 'days') return false
    let all = true
    for (const d of res.days) {
      if (!inCatchUpWindow(d.day, now) || (d.closed && !unwritten.has(d.day))) continue
      all = (await close(d.day, folder)) && all
    }
    return all
  }

  /**
   * Rewrites today's file when what it says is new (or the file is gone, or the last write failed). False when the
   * collector did not answer. Changes that arrive while this runs are kept for the next one.
   */
  async function refresh(day: string, folder: string): Promise<boolean> {
    state = { ...state, dirty: false }
    const res = await deps.ask({ kind: 'eod.refresh', day })
    if (res?.kind !== 'refreshed') {
      state = { ...state, dirty: true }
      return false
    }
    if (!hasContent(res.report)) return true
    const print = fingerprint(res.report)
    const missing = !deps.fileExists(folder, day)
    if (!missing && !failedToday.has(day) && !(res.changed && print !== written.get(day))) return true
    const w = deps.write(folder, res.report)
    if (w.ok) {
      written.set(day, print)
      failedToday.delete(day)
      return true
    }
    if (!failedToday.has(day)) deps.log(w.error)
    failedToday.add(day)
    state = { ...state, dirty: true }
    retryOnTick = true
    return true
  }

  /** Whether the action got done; false stops the tick until the next one. */
  async function run(action: EodAction, now: number, folder: string): Promise<boolean> {
    if (action.type === 'catch-up') {
      const done = await catchUp(now, folder)
      state = { ...state, caughtUp: done }
      return done
    }
    if (action.type === 'refresh') {
      const done = await refresh(action.day, folder)
      if (done) state = { ...state, refreshedAt: now }
      return done
    }
    return false
  }

  function arm(): void {
    cancelTimer ??= after(changeDelay(deps.now(), state), () => {
      cancelTimer = null
      void tick()
    })
  }

  async function tick(): Promise<void> {
    if (busy) return
    busy = true
    retryOnTick = false
    let settled = true
    try {
      const now = deps.now()
      state = rollState(state, now)
      const settings = deps.settings()
      seen = settings
      const folder = deps.folder(settings)
      for (const day of written.keys()) if (day !== state.day) written.delete(day)
      // Catching up may be followed at once by today's refresh; four steps is more than any tick needs.
      for (let i = 0; i < 4; i++) {
        const action = dueAction(now, settings, state)
        if (action.type === 'none') break
        if (!(await run(action, now, folder))) {
          settled = false
          break
        }
      }
    } catch (err) {
      settled = false
      deps.log(`The daily report check failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      busy = false
    }
    // A change that came in meanwhile, or came too soon after the last rewrite, waits on the timer.
    if (settled && !retryOnTick && state.dirty) arm()
  }

  return {
    tick,
    changed: () => {
      if (!seen?.enabled) return // before the first tick, which publishes anyway; or switched off
      state = { ...state, dirty: true }
      if (published(deps.now(), seen) && dayKey(deps.now()) === state.day) arm()
    },
    stop: () => {
      cancelTimer?.()
      cancelTimer = null
    },
    state: () => state
  }
}
