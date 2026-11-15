import { mkdirSync, existsSync } from 'node:fs'
import { clipboard, shell } from 'electron'
import { z } from 'zod'
import { IPC, type ActionResult } from '@shared/bridge'
import type { WorkReq, WorkRes } from '@shared/collector'
import { isDay } from '@shared/day'
import {
  DayKey, EOD_NOTES_MAX, TaskInput, TaskPatch, type EodDay, type EodReport, type EodSettings, type EodWrite, type TaskResult, type WorkTask
} from '@shared/work'
import { readConfig } from './config'
import type { Dispose, MainCtx } from './ctx'
import { roles } from './roles'
import { eodFile, eodFileDays, eodFolder, writeEodFile } from './eod-file'
import { TICK_MS, parseEodSettings } from './eod-schedule'
import { createScheduler, logError } from './eod-scheduler'

/** Tasks and the Daily report (EOD): IPC handlers, the report scheduler and the markdown file writer. */

/** The first check after launch, once the collector has had time to start; later ones follow every minute. */
const FIRST_TICK_MS = 15_000
const COPY_MAX = 100_000
const NOT_READY = 'AgentDeck is still starting its collector. Try again in a moment.'
const DEMO = 'Demo data: nothing was saved.'

const Id = z.string().min(1).max(64)
const Day = DayKey.refine(isDay)
const Notes = z.string().max(EOD_NOTES_MAX)
const Text = z.string().max(COPY_MAX)

let announce: (() => void) | null = null

/** The collector reported that tasks or the report changed. Does nothing before `registerWork` has run. */
export function workChanged(): void {
  announce?.()
}

export function registerWork(ctx: MainCtx): Dispose {
  const settings = (): EodSettings => parseEodSettings(readConfig(ctx.configFile()).eod)
  const folder = (s: EodSettings = settings()): string => eodFolder(s, ctx.userData())
  const unavailable = (): string => (ctx.demo() ? DEMO : NOT_READY)

  /** One request to the collector; null in demo, while it starts or restarts, or when it could not answer. */
  async function ask(req: WorkReq): Promise<WorkRes | null> {
    const c = ctx.demo() ? null : ctx.collector()
    if (!c) return null
    const m = await c.request((reqId) => ({ type: 'work', reqId, req }))
    return m?.type === 'work' ? m.res : null
  }
  const failed = (message: string): { ok: false; error: string } => ({ ok: false, error: message })
  const answer = (res: WorkRes | null): ActionResult => (res?.kind === 'ok' ? res.result : failed(unavailable()))

  /** The catalog's name for a role id, kept with the task. A role the catalog does not have can not be chosen. */
  async function roleNameOf(role: string | null | undefined): Promise<{ ok: true; name: string | null } | { ok: false; error: string }> {
    if (!role) return { ok: true, name: null }
    const found = await roles()?.summary(role)
    return found ? { ok: true, name: found.name } : { ok: false, error: 'That role no longer exists. Reload the roles and pick it again.' }
  }

  async function addTask(raw: unknown): Promise<TaskResult> {
    const input = TaskInput.safeParse(raw)
    if (!input.success) return failed('A task needs a title of 1 to 200 characters, and a project folder or none.')
    const named = await roleNameOf(input.data.role)
    if (!named.ok) return failed(named.error)
    const res = await ask({ kind: 'tasks.add', input: input.data, ...(named.name ? { roleName: named.name } : {}) })
    return res?.kind === 'task' ? res.result : failed(unavailable())
  }

  async function updateTask(rawId: unknown, rawPatch: unknown): Promise<TaskResult> {
    const id = Id.safeParse(rawId)
    const patch = TaskPatch.safeParse(rawPatch)
    if (!id.success || !patch.success) return failed('That change to the task was not understood.')
    const named = await roleNameOf(patch.data.role)
    if (!named.ok) return failed(named.error)
    const res = await ask({ kind: 'tasks.update', id: id.data, patch: patch.data, ...(named.name ? { roleName: named.name } : {}) })
    return res?.kind === 'task' ? res.result : failed(unavailable())
  }

  async function getEod(rawDay: unknown): Promise<EodReport | null> {
    const day = Day.safeParse(rawDay)
    if (!day.success) return null
    const res = await ask({ kind: 'eod.get', day: day.data })
    return res?.kind === 'eod' ? res.report : null
  }

  /** The collector's days, plus any day that only has a file in the folder (reports from before the database was reset). */
  async function listEodDays(): Promise<EodDay[] | null> {
    const res = await ask({ kind: 'eod.days' })
    if (res?.kind !== 'days') return null
    const dir = folder()
    const files = new Set(eodFileDays(dir))
    const known = new Set(res.days.map((d) => d.day))
    const rows: EodDay[] = [
      ...res.days.map(({ day, agentTimeMs, sessions, tasksDone }) => ({ day, agentTimeMs, sessions, tasksDone, hasFile: files.has(day) })),
      ...[...files].filter((day) => !known.has(day)).map((day) => ({ day, agentTimeMs: 0, sessions: 0, tasksDone: 0, hasFile: true }))
    ]
    return rows.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
  }

  async function saveEodNotes(rawDay: unknown, rawNotes: unknown): Promise<ActionResult> {
    const day = Day.safeParse(rawDay)
    if (!day.success) return failed('That is not a day AgentDeck can save notes for.')
    const notes = Notes.safeParse(rawNotes)
    if (!notes.success) return failed(`Notes can be up to ${EOD_NOTES_MAX.toLocaleString('en-US')} characters.`)
    return answer(await ask({ kind: 'eod.notes', day: day.data, notes: notes.data }))
  }

  async function writeEod(rawDay: unknown): Promise<EodWrite> {
    const day = Day.safeParse(rawDay)
    if (!day.success) return failed('That is not a day AgentDeck can write a report for.')
    const report = await getEod(day.data)
    return report ? writeEodFile(folder(), report) : failed(unavailable())
  }

  async function openEodFolder(): Promise<ActionResult> {
    const dir = folder()
    try {
      mkdirSync(dir, { recursive: true })
    } catch (err) {
      return failed(`AgentDeck could not create ${dir}: ${err instanceof Error ? err.message : String(err)}`)
    }
    const problem = await shell.openPath(dir)
    return problem ? failed(problem) : { ok: true }
  }

  function copyText(raw: unknown): ActionResult {
    const text = Text.safeParse(raw)
    if (!text.success) return failed(`That text is too long to copy (the limit is ${COPY_MAX.toLocaleString('en-US')} characters).`)
    clipboard.writeText(text.data)
    return { ok: true }
  }

  async function listTasks(): Promise<WorkTask[] | null> {
    const res = await ask({ kind: 'tasks.list' })
    return res?.kind === 'tasks' ? res.tasks : null
  }

  ctx.handle(IPC.listTasks, () => listTasks())
  ctx.handle(IPC.addTask, (_e, input) => addTask(input))
  ctx.handle(IPC.updateTask, (_e, id, patch) => updateTask(id, patch))
  ctx.handle(IPC.removeTask, async (_e, id) => {
    const parsed = Id.safeParse(id)
    return parsed.success ? answer(await ask({ kind: 'tasks.remove', id: parsed.data })) : failed('That task was not understood.')
  })
  ctx.handle(IPC.getEod, (_e, day) => getEod(day))
  ctx.handle(IPC.listEodDays, () => listEodDays())
  ctx.handle(IPC.saveEodNotes, (_e, day, notes) => saveEodNotes(day, notes))
  ctx.handle(IPC.writeEod, (_e, day) => writeEod(day))
  ctx.handle(IPC.openEodFolder, () => openEodFolder())
  ctx.handle(IPC.copyText, (_e, text) => copyText(text))

  const scheduler = createScheduler({
    now: Date.now,
    settings,
    folder,
    ask,
    write: writeEodFile,
    fileExists: (dir, day) => existsSync(eodFile(dir, day)),
    log: logError
  })
  const first = setTimeout(() => void scheduler.tick(), FIRST_TICK_MS)
  const timer = setInterval(() => void scheduler.tick(), TICK_MS)
  first.unref()
  timer.unref()
  // The collector's `work-changed` (index.ts calls `workChanged`): the window refetches what it shows, and the file is
  // rewritten soon, no more often than every 30 s.
  announce = () => {
    const w = ctx.window()
    if (w && !w.isDestroyed()) w.webContents.send(IPC.workChanged)
    scheduler.changed()
  }
  return () => {
    announce = null
    clearTimeout(first)
    clearInterval(timer)
    scheduler.stop()
  }
}
