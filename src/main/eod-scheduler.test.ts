import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EodDayRow, WorkReq, WorkRes } from '@shared/collector'
import type { EodReport, EodSettings, EodWrite } from '@shared/work'
import { CHANGE_GAP_MS, IDLE_CHECK_MS, SETTLE_MS } from './eod-schedule'
import { createScheduler, logError, type SchedulerDeps } from './eod-scheduler'

const at = (day: number, h = 0, m = 0): number => new Date(2026, 10, day, h, m).getTime()
const MIN = 60_000
const FOLDER = 'D:\\reports'

const report = (day: string, busy = true, closed = false, minutes = 1): EodReport => ({
  day,
  generatedAt: 0,
  closed,
  totals: { agentTimeMs: busy ? minutes * MIN : 0, sessions: busy ? 1 : 0, turns: 0, filesChanged: 0, approvalsAnswered: 0, tasksDone: 0 },
  projects: [],
  sessions: [],
  tasksDone: [],
  carryOver: [],
  blockers: [],
  notes: ''
})
const row = (day: string, closed: boolean): EodDayRow => ({ day, agentTimeMs: MIN, sessions: 1, tasksDone: 0, hasFile: false, closed })

interface Rig {
  deps: SchedulerDeps
  clock: { now: number }
  settings: { current: EodSettings }
  asked: WorkReq[]
  written: string[]
  logs: string[]
  files: Set<string>
  collector: { up: boolean; days: EodDayRow[]; empty: Set<string>; closedBefore: Set<string>; changed: boolean; minutes: number }
  failWrites: { on: boolean }
  /** One-shot timers the scheduler asked for, in order. */
  timers: { ms: number; fn: () => void; cancelled: boolean }[]
  /** Timers still waiting. */
  pending(): number
  /** Moves the clock to the first waiting timer, runs it, and lets its tick settle. */
  fire(): Promise<void>
}

function rig(now: number, days: EodDayRow[] = []): Rig {
  const clock = { now }
  const settings = { current: { enabled: true, time: '18:00', folder: null } as EodSettings }
  const asked: WorkReq[] = []
  const written: string[] = []
  const logs: string[] = []
  const files = new Set<string>()
  const collector = { up: true, days, empty: new Set<string>(), closedBefore: new Set(days.filter((d) => d.closed).map((d) => d.day)), changed: true, minutes: 1 }
  const failWrites = { on: false }
  const timers: Rig['timers'] = []
  const deps: SchedulerDeps = {
    now: () => clock.now,
    settings: () => settings.current,
    folder: (s) => s.folder ?? FOLDER,
    ask: async (req): Promise<WorkRes | null> => {
      asked.push(req)
      if (!collector.up) return null
      if (req.kind === 'eod.days') return { kind: 'days', days: collector.days }
      if (req.kind === 'eod.get') return { kind: 'eod', report: report(req.day, !collector.empty.has(req.day), false, collector.minutes) }
      if (req.kind === 'eod.refresh') return { kind: 'refreshed', changed: collector.changed, report: report(req.day, !collector.empty.has(req.day), false, collector.minutes) }
      if (req.kind === 'eod.finalize') {
        const fresh = !collector.closedBefore.has(req.day)
        collector.closedBefore.add(req.day)
        collector.days = collector.days.map((d) => (d.day === req.day ? { ...d, closed: true } : d))
        return { kind: 'finalized', fresh, report: report(req.day, !collector.empty.has(req.day), true) }
      }
      return null
    },
    write: (folder, r): EodWrite => {
      if (failWrites.on) return { ok: false, error: `could not write ${r.day}` }
      written.push(r.day)
      files.add(r.day)
      return { ok: true, path: `${folder}\\${r.day}.md` }
    },
    fileExists: (_folder, day) => files.has(day),
    log: (m) => logs.push(m),
    after: (ms, fn) => {
      const timer = { ms, fn, cancelled: false }
      timers.push(timer)
      return () => void (timer.cancelled = true)
    }
  }
  const waiting = (): Rig['timers'] => timers.filter((t) => !t.cancelled)
  return {
    deps, clock, settings, asked, written, logs, files, collector, failWrites, timers,
    pending: () => waiting().length,
    fire: async () => {
      const t = waiting()[0]
      if (!t) throw new Error('no timer is waiting')
      t.cancelled = true
      clock.now += t.ms
      t.fn()
      await settle()
    }
  }
}

/** A timer starts its tick without awaiting it: let the tick and its asks finish. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

/** The real timer ticks every minute; a longer gap would look like the PC slept. */
async function tickFor(r: Rig, s: ReturnType<typeof createScheduler>, minutes: number): Promise<void> {
  for (let i = 0; i < minutes; i++) {
    r.clock.now += MIN
    await s.tick()
  }
}

const kinds = (r: Rig): string[] => r.asked.map((q) => (q.kind === 'eod.finalize' || q.kind === 'eod.get' || q.kind === 'eod.refresh' ? `${q.kind}:${q.day}` : q.kind))

afterEach(() => vi.restoreAllMocks())

describe('the report scheduler', () => {
  it('on startup after the daily time, closes the days it missed in the last 14 days, then publishes today', async () => {
    const r = rig(at(13, 19), [row('2026-11-12', false), row('2026-11-10', true), row('2026-10-01', false), row('2026-11-13', false)])
    const s = createScheduler(r.deps)
    await s.tick()
    expect(kinds(r)).toEqual(['eod.days', 'eod.finalize:2026-11-12', 'eod.refresh:2026-11-13'])
    expect(r.written).toEqual(['2026-11-12', '2026-11-13'])
    expect(s.state()).toMatchObject({ day: '2026-11-13', caughtUp: true, refreshedAt: at(13, 19) })
    await s.tick() // refreshed a moment ago
    expect(r.asked).toHaveLength(3)
  })

  it('writes nothing for today before the daily time', async () => {
    const r = rig(at(13, 9))
    const s = createScheduler(r.deps)
    await s.tick()
    await tickFor(r, s, 30)
    expect(kinds(r)).toEqual(['eod.days'])
    expect(r.written).toEqual([])
  })

  it('publishes today at the daily time, then asks only when something changed or ten quiet minutes passed', async () => {
    const r = rig(at(13, 17, 59))
    const s = createScheduler(r.deps)
    await s.tick()
    expect(r.written).toEqual([])
    await tickFor(r, s, 1) // 18:00
    expect(kinds(r)).toEqual(['eod.days', 'eod.refresh:2026-11-13'])
    expect(r.written).toEqual(['2026-11-13'])
    await tickFor(r, s, IDLE_CHECK_MS / MIN - 1)
    expect(r.asked).toHaveLength(2) // nothing reported: nothing asked
    await tickFor(r, s, 1) // 18:10, the safety check
    expect(kinds(r).slice(-1)).toEqual(['eod.refresh:2026-11-13'])
    expect(r.written).toEqual(['2026-11-13']) // it found nothing new, so it wrote nothing
  })

  it('keeps checking until midnight but rewrites the file only when what it says is new', async () => {
    const r = rig(at(13, 18))
    const s = createScheduler(r.deps)
    await s.tick() // publishes
    await tickFor(r, s, 30)
    expect(kinds(r).filter((k) => k.startsWith('eod.refresh'))).toHaveLength(4) // 18:00, 18:10, 18:20, 18:30
    expect(r.written).toEqual(['2026-11-13'])
    r.collector.minutes = 2 // late work
    await tickFor(r, s, 10)
    expect(r.written).toEqual(['2026-11-13', '2026-11-13'])
  })

  it('writes the file again when it was removed, even if nothing is new', async () => {
    const r = rig(at(13, 18))
    const s = createScheduler(r.deps)
    await s.tick()
    r.collector.changed = false
    r.files.clear()
    await tickFor(r, s, 10)
    expect(r.written).toEqual(['2026-11-13', '2026-11-13'])
  })

  it('writes no file for a day with nothing in it', async () => {
    const r = rig(at(13, 18))
    r.collector.empty.add('2026-11-13')
    await createScheduler(r.deps).tick()
    expect(r.written).toEqual([])
  })

  it('applies a changed time on the next tick, and does nothing while switched off', async () => {
    const r = rig(at(13, 12))
    const s = createScheduler(r.deps)
    r.settings.current = { enabled: false, time: '18:00', folder: null }
    await s.tick()
    expect(r.asked).toEqual([])
    r.settings.current = { enabled: true, time: '18:00', folder: 'E:\\elsewhere' }
    await tickFor(r, s, 1)
    expect(kinds(r)).toEqual(['eod.days'])
    r.settings.current = { enabled: true, time: '12:00', folder: 'E:\\elsewhere' }
    await tickFor(r, s, 1)
    expect(kinds(r)).toEqual(['eod.days', 'eod.refresh:2026-11-13'])
  })

  it('leaves the final file of a day closed on an earlier run alone, unless it is missing', async () => {
    const r = rig(at(13, 9), [row('2026-11-12', true)])
    r.collector.closedBefore = new Set(['2026-11-12'])
    r.files.add('2026-11-12')
    await createScheduler(r.deps).tick()
    expect(r.written).toEqual([]) // closed already, file there
    // The closed day's file is missing and the day is not marked closed in the list: closing it again finds it closed.
    const missing = rig(at(13, 9), [row('2026-11-12', false)])
    missing.collector.closedBefore = new Set(['2026-11-12'])
    await createScheduler(missing.deps).tick()
    expect(missing.written).toEqual(['2026-11-12'])
  })

  it('waits for the collector and tries again on the next tick', async () => {
    const r = rig(at(13, 19), [row('2026-11-12', false)])
    r.collector.up = false
    const s = createScheduler(r.deps)
    await s.tick()
    expect(r.written).toEqual([])
    expect(s.state()).toMatchObject({ caughtUp: false, refreshedAt: 0 })
    r.collector.up = true
    await tickFor(r, s, 1)
    expect(r.written).toEqual(['2026-11-12', '2026-11-13'])
    // A refresh the collector did not answer is tried again at the next tick, not in 10 minutes.
    const late = rig(at(13, 19))
    const t = createScheduler(late.deps)
    await t.tick()
    late.collector.up = false
    await tickFor(late, t, IDLE_CHECK_MS / MIN)
    expect(t.state().refreshedAt).toBe(at(13, 19))
    late.collector.up = true
    await tickFor(late, t, 1)
    expect(t.state().refreshedAt).toBe(late.clock.now)
  })

  it('keeps a closed day whose file could not be written, and writes it on a later tick, logging once', async () => {
    const r = rig(at(13, 19), [row('2026-11-12', false)])
    r.failWrites.on = true
    const s = createScheduler(r.deps)
    await s.tick()
    await tickFor(r, s, 1)
    expect(r.logs).toEqual(['could not write 2026-11-12']) // not once a minute
    expect(s.state()).toMatchObject({ caughtUp: false })
    r.failWrites.on = false
    await tickFor(r, s, 1)
    expect(r.written).toEqual(['2026-11-12', '2026-11-13'])
    expect(s.state()).toMatchObject({ caughtUp: true })
  })

  it('logs a failed write of today once and tries again at the next tick, even if the collector has nothing new', async () => {
    const r = rig(at(13, 18))
    r.failWrites.on = true
    const s = createScheduler(r.deps)
    await s.tick()
    expect(r.logs).toEqual(['could not write 2026-11-13'])
    expect(r.pending()).toBe(0) // no timer: a failing disk is not hammered
    r.collector.changed = false // the copy was kept, but the file is missing
    await tickFor(r, s, 2)
    expect(r.logs).toEqual(['could not write 2026-11-13'])
    r.failWrites.on = false
    await tickFor(r, s, 1)
    expect(r.written).toEqual(['2026-11-13'])
  })

  it('closes the finished day at midnight, with a last write of its file, and starts the new day over', async () => {
    const r = rig(at(13, 23, 57), [row('2026-11-13', false)])
    const s = createScheduler(r.deps)
    await s.tick()
    expect(r.written).toEqual(['2026-11-13']) // published and refreshed before midnight
    expect(kinds(r)).not.toContain('eod.finalize:2026-11-13')
    await tickFor(r, s, 4) // 23:58, 23:59, 00:00, 00:01
    expect(kinds(r)).toContain('eod.finalize:2026-11-13')
    expect(r.written).toEqual(['2026-11-13', '2026-11-13']) // the last refresh of the finished day
    expect(s.state()).toMatchObject({ day: '2026-11-14', caughtUp: true, refreshedAt: 0 })
    expect(kinds(r).filter((k) => k === 'eod.refresh:2026-11-14')).toEqual([]) // the new day waits for 18:00
  })

  it('closes a day it missed entirely when it starts the next morning', async () => {
    const r = rig(at(14, 8), [row('2026-11-13', false)])
    await createScheduler(r.deps).tick()
    expect(r.written).toEqual(['2026-11-13'])
  })

  it('checks the past days again after the PC slept', async () => {
    const r = rig(at(13, 9))
    const s = createScheduler(r.deps)
    await s.tick()
    r.clock.now = at(14, 8)
    r.collector.days = [row('2026-11-13', false)]
    await s.tick()
    expect(kinds(r)).toContain('eod.finalize:2026-11-13')
    expect(r.written).toEqual(['2026-11-13'])
  })

  it('runs one tick at a time', async () => {
    const r = rig(at(13, 9))
    const s = createScheduler(r.deps)
    await Promise.all([s.tick(), s.tick(), s.tick()])
    expect(kinds(r)).toEqual(['eod.days'])
  })

  it('logs a failure and carries on with the next tick', async () => {
    const r = rig(at(13, 18))
    let boom = true
    const s = createScheduler({
      ...r.deps,
      ask: async (req) => {
        if (boom) throw new Error('pipe closed')
        return r.deps.ask(req)
      }
    })
    await s.tick()
    expect(r.logs).toEqual(['The daily report check failed: pipe closed'])
    boom = false
    await tickFor(r, s, 1)
    expect(r.written).toEqual(['2026-11-13'])
  })

  it('logs a settings failure too, and is not stuck afterwards', async () => {
    const r = rig(at(13, 9))
    const bad = createScheduler({ ...r.deps, settings: () => { throw new Error('config unreadable') } })
    await bad.tick()
    await bad.tick() // busy was released
    expect(r.logs).toEqual(['The daily report check failed: config unreadable', 'The daily report check failed: config unreadable'])
  })
})

describe('a change reported by the collector', () => {
  /** Published at 18:00 sharp; the clock then moves `seconds` on. */
  async function afterPublish(seconds = 0): Promise<{ r: Rig; s: ReturnType<typeof createScheduler> }> {
    const r = rig(at(13, 18))
    const s = createScheduler(r.deps)
    await s.tick()
    expect(r.written).toEqual(['2026-11-13'])
    r.clock.now += seconds * 1_000
    return { r, s }
  }
  const refreshes = (r: Rig): number => r.asked.filter((q) => q.kind === 'eod.refresh').length

  it('rewrites the file 30 s after the last rewrite, with the new content', async () => {
    const { r, s } = await afterPublish(5)
    r.collector.minutes = 2
    s.changed()
    expect(r.pending()).toBe(1)
    expect(r.timers[0]?.ms).toBe(CHANGE_GAP_MS - 5_000)
    await r.fire()
    expect(kinds(r).slice(-1)).toEqual(['eod.refresh:2026-11-13'])
    expect(r.written).toEqual(['2026-11-13', '2026-11-13'])
    expect(s.state()).toMatchObject({ dirty: false, refreshedAt: r.clock.now })
    expect(r.pending()).toBe(0)
  })

  it('turns a burst into one timer and one rewrite', async () => {
    const { r, s } = await afterPublish(10)
    r.collector.minutes = 2
    for (let i = 0; i < 50; i++) s.changed()
    expect(r.pending()).toBe(1)
    await r.fire()
    expect(refreshes(r)).toBe(2) // the publish and this one
    expect(r.written).toHaveLength(2)
    expect(r.pending()).toBe(0)
  })

  it('waits only for the burst to settle when the last rewrite is long ago', async () => {
    const { r, s } = await afterPublish(300)
    r.collector.minutes = 2
    s.changed()
    expect(r.timers[0]?.ms).toBe(SETTLE_MS)
    await r.fire()
    expect(r.written).toHaveLength(2)
  })

  it('never writes closer than 30 s apart, however steadily the day changes', async () => {
    const { r, s } = await afterPublish()
    const times = [r.clock.now]
    for (let i = 0; i < 10; i++) {
      for (let burst = 0; burst < 20; burst++) {
        r.collector.minutes += 1
        s.changed()
      }
      const before = r.written.length
      await r.fire()
      if (r.written.length > before) times.push(r.clock.now)
    }
    expect(times).toHaveLength(11) // the publish and one rewrite per window, five minutes of change
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(CHANGE_GAP_MS)
  })

  it('does not write content it already wrote, even when the collector says the report changed', async () => {
    const { r, s } = await afterPublish(40)
    s.changed() // the collector's JSON differs (a timestamp, a count), the markdown does not
    await r.fire()
    expect(refreshes(r)).toBe(2)
    expect(r.written).toHaveLength(1)
  })

  it('arms nothing before the daily time, and the publish at it covers what changed meanwhile', async () => {
    const r = rig(at(13, 9))
    const s = createScheduler(r.deps)
    await s.tick()
    s.changed()
    s.changed()
    expect(r.pending()).toBe(0)
    expect(r.written).toEqual([])
    r.clock.now = at(13, 18)
    await s.tick()
    expect(r.written).toEqual(['2026-11-13'])
  })

  it('is ignored before the first tick and while the report is switched off', async () => {
    const r = rig(at(13, 19))
    const s = createScheduler(r.deps)
    s.changed()
    expect(r.pending()).toBe(0)
    r.settings.current = { enabled: false, time: '18:00', folder: null }
    await s.tick()
    s.changed()
    expect(r.pending()).toBe(0)
    expect(r.asked).toEqual([])
  })

  it('keeps a change that arrives while a refresh is in flight for the next one', async () => {
    const r = rig(at(13, 18))
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const s = createScheduler({
      ...r.deps,
      ask: async (req) => {
        if (req.kind === 'eod.refresh') await gate
        return r.deps.ask(req)
      }
    })
    const running = s.tick()
    await settle() // the publish is asked and waits
    s.changed()
    release()
    await running
    expect(s.state().dirty).toBe(true)
    expect(r.pending()).toBe(1)
    r.collector.minutes = 2
    await r.fire() // settled, but the last rewrite is not 30 s old yet
    await r.fire()
    expect(refreshes(r)).toBe(2)
    expect(r.written).toHaveLength(2)
    expect(s.state().dirty).toBe(false)
  })

  it('leaves a collector that does not answer to the next minute tick, not to a timer', async () => {
    const { r, s } = await afterPublish(40)
    r.collector.minutes = 2
    s.changed()
    r.collector.up = false
    await r.fire()
    expect(r.pending()).toBe(0)
    expect(s.state().dirty).toBe(true)
    r.collector.up = true
    await tickFor(r, s, 1)
    expect(r.written).toEqual(['2026-11-13', '2026-11-13'])
    expect(s.state().dirty).toBe(false)
  })

  it('stop() cancels the timer', async () => {
    const { r, s } = await afterPublish(5)
    r.collector.minutes = 2
    s.changed()
    expect(r.pending()).toBe(1)
    s.stop()
    expect(r.pending()).toBe(0)
  })
})

describe('logError', () => {
  it('writes one tagged line to stderr', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    logError('disk full')
    expect(write).toHaveBeenCalledWith('[eod] disk full\n')
  })
})
