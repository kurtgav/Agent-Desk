import type { WorkReq, WorkRes } from '@shared/collector'
import { eodDays, finalizeEod, refreshEod, reportFor } from './eod'
import type { TaskFollower } from './follow'
import type { Store } from './store'

/** Requests that change what the Tasks page or the report show. A refresh or a close only keeps a copy, so it is not one. */
const CHANGES_WORK = new Set<WorkReq['kind']>(['tasks.add', 'tasks.update', 'tasks.remove', 'eod.notes'])
export const changesWork = (req: WorkReq): boolean => CHANGES_WORK.has(req.kind)

/**
 * One request from main (shared/collector.ts § WorkReq) against the store. Throws on a database error; the caller reports it.
 * `follow` is told when the user moves a task, so an agent never completes again what the user moved back.
 */
export function handleWork(store: Store, req: WorkReq, now: number, follow?: TaskFollower): WorkRes {
  const { work } = store
  switch (req.kind) {
    case 'tasks.list':
      return { kind: 'tasks', tasks: work.listTasks() }
    case 'tasks.add':
      follow?.invalidate()
      return { kind: 'task', result: { ok: true, task: work.addTask(req.input, now, req.roleName ?? null) } }
    case 'tasks.update': {
      const before = work.task(req.id)
      const result = work.updateTask(req.id, req.patch, now, req.roleName ?? null)
      if (before?.status === 'done' && result.ok && result.task.status !== 'done') follow?.release(req.id)
      follow?.invalidate()
      return { kind: 'task', result }
    }
    case 'tasks.remove':
      work.removeTask(req.id)
      follow?.forget(req.id)
      return { kind: 'ok', result: { ok: true } }
    case 'eod.get':
      return { kind: 'eod', report: reportFor(work, store.eodLive(), req.day, now) }
    case 'eod.days':
      return { kind: 'days', days: eodDays(work, store.eodLive(), now) }
    case 'eod.notes':
      work.setNotes(req.day, req.notes, now)
      return { kind: 'ok', result: { ok: true } }
    case 'eod.refresh': {
      const { report, changed } = refreshEod(work, store.eodLive(), req.day, now)
      return { kind: 'refreshed', report, changed }
    }
    case 'eod.finalize': {
      const { report, fresh } = finalizeEod(work, store.eodLive(), req.day, now)
      return { kind: 'finalized', report, fresh }
    }
  }
}
