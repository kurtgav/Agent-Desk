import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { dayKey } from '@shared/day'
import { hasContent, renderEodMarkdown } from '@shared/eod-markdown'
import { buildEod, eodDays, finalizeEod, firstLine, keepFuller, refreshEod, reportFor, SUMMARY_MAX } from './eod'
import type { AgentEvent } from './events'
import { normalizeHook } from './normalize'
import { RETENTION_MS, Store } from './store'
import { handleWork } from './work'
import { TASK_RETENTION_MS } from './work-store'

const dirs: string[] = []
const stores: Store[] = []
function open(file = ':memory:'): Store {
  const s = new Store(file)
  stores.push(s)
  return s
}
function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentdeck-work-'))
  dirs.push(dir)
  return join(dir, 'agentdeck.db')
}
afterEach(() => {
  for (const s of stores.splice(0)) s.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** Local wall-clock times, so the tests mean the same day in every time zone. */
const at = (day: number, h = 0, m = 0): number => new Date(2026, 10, day, h, m).getTime()
const DAY12 = '2026-11-12'
const DAY13 = '2026-11-13'
const NOW = at(13, 11, 30)
const MIN = 60_000

const AGENTDECK = 'D:\\code\\agentdeck'
const SITE = 'D:\\code\\site'
const hook = (sid: string, kind: string, ts: number, extra: Record<string, unknown> = {}): AgentEvent =>
  normalizeHook(JSON.stringify({ session_id: sid, hook_event_name: kind, cwd: AGENTDECK, ...extra }), ts)!
const stop = (sid: string, ts: number, message: string, extra: Record<string, unknown> = {}): AgentEvent =>
  hook(sid, 'Stop', ts, { stop_hook_active: false, last_assistant_message: message, ...extra })
const edit = (sid: string, ts: number, file: string, extra: Record<string, unknown> = {}): AgentEvent =>
  hook(sid, 'PostToolUse', ts, { tool_name: 'Edit', tool_use_id: `e${ts}`, tool_input: { file_path: file, old_string: 'x', new_string: 'y' }, ...extra })
const push = { tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'git push --force' } }

/**
 * Two days. Session a works across midnight (23:50 to 00:10) and again at 09:00; b is another project; c waits on an
 * approval; d is still working at NOW; p is only a poll row.
 */
function seeded(store = open()): Store {
  const poll: AgentEvent = {
    id: 'poll1', ts: at(13, 8), source: 'poll', sessionId: 'p', agentId: null, parentAgentId: null, agentType: null, kind: 'session.state',
    toolName: null, toolUseId: null, summary: 'Status: idle', payload: { name: 'p', cwd: 'D:\\code\\idle', kind: 'interactive', status: 'idle' },
    cwd: 'D:\\code\\idle', dedupeKey: null
  }
  const events = [
    hook('a', 'UserPromptSubmit', at(12, 23, 50), { prompt: 'go' }),
    stop('a', at(13, 0, 10), 'Moved the routes.'),
    poll,
    hook('a', 'UserPromptSubmit', at(13, 9), { prompt: 'again' }),
    edit('a', at(13, 9, 5), `${AGENTDECK}\\a.ts`),
    stop('a', at(13, 9, 30), '## Added the tasks table\n\nMore detail.'),
    hook('b', 'UserPromptSubmit', at(13, 10), { prompt: 'site', cwd: SITE }),
    edit('b', at(13, 10, 10), `${SITE}\\x.ts`, { cwd: SITE }),
    edit('b', at(13, 10, 12), `${AGENTDECK}\\A.TS`, { cwd: SITE }), // same file as a's, other casing (D-013)
    stop('b', at(13, 10, 20), 'Styled the site.', { cwd: SITE }),
    hook('c', 'UserPromptSubmit', at(13, 11), { prompt: 'push' }),
    hook('c', 'PreToolUse', at(13, 11, 1), push),
    hook('c', 'PermissionRequest', at(13, 11, 10), { tool_name: 'Bash', tool_input: push.tool_input }),
    hook('d', 'UserPromptSubmit', at(13, 11, 20), { prompt: 'long' })
  ].sort((x, y) => x.ts - y.ts)
  store.ingest(events)
  const row = (ts: number, outcome: 'approved' | 'rejected' | 'timed-out') => ({
    ts, requestedAt: ts - 1_000, itemId: `i${ts}`, sessionId: 'c', agentId: null, toolName: 'Bash', title: 'Run `ls`', riskFlags: [], inputHash: 'h', outcome
  })
  for (const r of [row(at(13, 11, 5), 'approved'), row(at(13, 11, 6), 'rejected'), row(at(13, 11, 7), 'timed-out'), row(at(12, 12), 'approved')]) store.audit(r)
  return store
}

describe('migration 4', () => {
  it('adds tasks, eod_notes and eod_reports', () => {
    const file = tempDb()
    open(file)
    const db = new DatabaseSync(file)
    expect(Number(db.prepare('PRAGMA user_version').get()?.user_version)).toBeGreaterThanOrEqual(4) // later migrations only add
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => String(r.name))
    expect(names).toEqual(expect.arrayContaining(['tasks', 'eod_notes', 'eod_reports']))
    db.close()
  })
})

describe('migration 7: the role of a task', () => {
  const columns = (db: DatabaseSync): string[] => db.prepare('PRAGMA table_info(tasks)').all().map((r) => String(r.name))

  it('adds role and role_name to tasks', () => {
    const file = tempDb()
    open(file)
    const db = new DatabaseSync(file)
    expect(columns(db)).toEqual(expect.arrayContaining(['role', 'role_name']))
    db.close()
  })

  it('upgrades a database that is at version 6 and keeps its tasks, with no role', () => {
    const file = tempDb()
    open(file).close()
    stores.length = 0
    const old = new DatabaseSync(file)
    old.exec("INSERT INTO tasks (id, title, project, status, created_at, done_at, session_name) VALUES ('t1', 'Old task', NULL, 'todo', 1, NULL, NULL)")
    old.exec('ALTER TABLE tasks DROP COLUMN role; ALTER TABLE tasks DROP COLUMN role_name; PRAGMA user_version = 6')
    expect(columns(old)).not.toContain('role')
    old.close()

    const { work } = open(file)
    expect(work.listTasks()).toEqual([expect.objectContaining({ id: 't1', title: 'Old task', role: null, roleName: null })])
    const db = new DatabaseSync(file)
    expect(columns(db)).toEqual(expect.arrayContaining(['role', 'role_name']))
    expect(Number(db.prepare('PRAGMA user_version').get()?.user_version)).toBeGreaterThanOrEqual(7)
    db.close()
  })

  it('does not stop a build that does not know the columns: its statements name theirs', () => {
    const file = tempDb()
    open(file)
    const db = new DatabaseSync(file)
    db.prepare('INSERT INTO tasks (id, title, project, status, created_at, done_at, session_name) VALUES (?, ?, ?, ?, ?, NULL, NULL)').run('t9', 'From an older build', null, 'todo', 5)
    db.prepare('UPDATE tasks SET title = ?, project = ?, status = ?, done_at = ?, session_name = ? WHERE id = ?').run('Edited', null, 'doing', null, 'n', 't9')
    expect(db.prepare('SELECT title, role, role_name FROM tasks WHERE id = ?').get('t9')).toEqual({ title: 'Edited', role: null, role_name: null })
    db.close()
  })
})

describe('the role of a task', () => {
  it('is kept with the name it had when it was chosen', () => {
    const { work } = open()
    const t = work.addTask({ title: 'Plan', project: null, role: 'cto' }, 100, 'CTO')
    expect(t).toMatchObject({ role: 'cto', roleName: 'CTO' })
    expect(work.listTasks()[0]).toMatchObject({ role: 'cto', roleName: 'CTO' })
  })

  it('has no name without a role, and no role by default', () => {
    const { work } = open()
    expect(work.addTask({ title: 'a', project: null }, 1, 'Stray')).toMatchObject({ role: null, roleName: null })
    expect(work.addTask({ title: 'b', project: null, role: null }, 2, 'Stray')).toMatchObject({ role: null, roleName: null })
  })

  it('stays through other edits, changes with a new role and name, and comes off with null', () => {
    const { work } = open()
    const t = work.addTask({ title: 'Plan', project: null, role: 'cto' }, 100, 'CTO')
    expect(work.updateTask(t.id, { title: 'Plan it' }, 200)).toMatchObject({ ok: true, task: { role: 'cto', roleName: 'CTO' } })
    expect(work.updateTask(t.id, { status: 'done' }, 300)).toMatchObject({ ok: true, task: { role: 'cto', roleName: 'CTO', status: 'done' } })
    // The same role again with a newer name (it was renamed in the catalog) takes the newer name.
    expect(work.updateTask(t.id, { role: 'cto' }, 400, 'Chief Technology Officer')).toMatchObject({ ok: true, task: { role: 'cto', roleName: 'Chief Technology Officer' } })
    expect(work.updateTask(t.id, { role: 'qa' }, 500, 'QA Engineer')).toMatchObject({ ok: true, task: { role: 'qa', roleName: 'QA Engineer' } })
    expect(work.updateTask(t.id, { role: null }, 600)).toMatchObject({ ok: true, task: { role: null, roleName: null } })
    expect(work.listTasks()[0]).toMatchObject({ role: null, roleName: null })
  })

  it('keeps its old name when the same role is set again without one (the catalog has lost it)', () => {
    const { work } = open()
    const t = work.addTask({ title: 'Plan', project: null, role: 'cto' }, 100, 'CTO')
    expect(work.updateTask(t.id, { role: 'cto' }, 200)).toMatchObject({ ok: true, task: { role: 'cto', roleName: 'CTO' } })
  })

  it('travels through handleWork with the name main read from the catalog', () => {
    const store = open()
    const added = handleWork(store, { kind: 'tasks.add', input: { title: 'Plan', project: null, role: 'cto' }, roleName: 'CTO' }, 100)
    if (added.kind !== 'task' || !added.result.ok) throw new Error('not added')
    expect(added.result.task).toMatchObject({ role: 'cto', roleName: 'CTO' })
    expect(handleWork(store, { kind: 'tasks.update', id: added.result.task.id, patch: { role: 'qa' }, roleName: 'QA Engineer' }, 200)).toMatchObject({
      kind: 'task', result: { ok: true, task: { role: 'qa', roleName: 'QA Engineer' } }
    })
  })

  it('reads "as CTO" in the report of the day it was done', () => {
    const store = open()
    const t = store.work.addTask({ title: 'Plan the launch', project: null, role: 'cto' }, at(13, 9), 'CTO')
    store.work.updateTask(t.id, { status: 'done' }, at(13, 10))
    const r = buildEod(store.work, store.eodLive(), DAY13, NOW)
    expect(r.tasksDone).toEqual([expect.objectContaining({ title: 'Plan the launch', roleName: 'CTO' })])
    expect(renderEodMarkdown(r)).toContain('- [x] Plan the launch as CTO')
  })
})

describe('tasks', () => {
  it('adds, lists oldest first, edits and removes', () => {
    const { work } = open()
    const a = work.addTask({ title: 'First', project: null }, 100)
    const b = work.addTask({ title: 'Second', project: AGENTDECK }, 200)
    expect(a).toMatchObject({ title: 'First', status: 'todo', createdAt: 100, doneAt: null, sessionName: null })
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(work.listTasks()).toEqual([a, b])

    const r = work.updateTask(b.id, { title: 'Renamed', project: null, sessionName: 'bg-1', status: 'doing' }, 300)
    expect(r).toEqual({ ok: true, task: { ...b, title: 'Renamed', project: null, sessionName: 'bg-1', status: 'doing' } })
    expect(work.listTasks()[1]).toMatchObject({ title: 'Renamed', status: 'doing', sessionName: 'bg-1' })

    work.removeTask(a.id)
    expect(work.listTasks().map((t) => t.id)).toEqual([b.id])
    work.removeTask('nope') // nothing to remove is not an error
  })

  it('sets doneAt when a task is done, keeps it on later edits, and clears it when the task moves back', () => {
    const { work } = open()
    const t = work.addTask({ title: 'Ship', project: null }, 100)
    const done = work.updateTask(t.id, { status: 'done' }, 500)
    expect(done).toMatchObject({ ok: true, task: { status: 'done', doneAt: 500 } })
    expect(work.updateTask(t.id, { title: 'Ship it' }, 900)).toMatchObject({ ok: true, task: { status: 'done', doneAt: 500, title: 'Ship it' } })
    expect(work.updateTask(t.id, { status: 'done' }, 950)).toMatchObject({ ok: true, task: { doneAt: 500 } })
    expect(work.updateTask(t.id, { status: 'doing' }, 1_000)).toMatchObject({ ok: true, task: { status: 'doing', doneAt: null } })
    expect(work.updateTask(t.id, { status: 'done' }, 2_000)).toMatchObject({ ok: true, task: { doneAt: 2_000 } })
    expect(work.listTasks()[0]?.doneAt).toBe(2_000)
  })

  it('says so when the task is gone', () => {
    const r = open().work.updateTask('missing', { title: 'x' }, 1)
    expect(r).toMatchObject({ ok: false })
    expect(r.ok ? '' : r.error).toMatch(/no longer exists/)
  })
})

describe('the Daily report', () => {
  it('adds up one day from work spans, turns, files, approvals and sessions', () => {
    const store = seeded()
    const r = buildEod(store.work, store.eodLive(), DAY13, NOW)
    expect(r).toMatchObject({ day: DAY13, generatedAt: NOW, closed: false, notes: '' })
    expect(r.totals).toEqual({
      agentTimeMs: (10 + 30 + 20 + 10 + 10) * MIN, // a: 00:00-00:10 and 09:00-09:30; b; c until its request; d still open at NOW
      sessions: 4, // not the poll-only p
      turns: 3,
      filesChanged: 2, // a.ts twice, in two casings, is one file
      approvalsAnswered: 2, // approved and rejected; the timeout and yesterday's answer don't count
      tasksDone: 0
    })
    expect(r.sessions.map((s) => [s.id, s.status, s.agentTimeMs / MIN])).toEqual([
      ['d', 'working', 10], ['c', 'needs_you', 10], ['b', 'done', 20], ['a', 'done', 40]
    ])
    expect(r.projects).toEqual([
      { cwd: AGENTDECK, name: 'agentdeck', agentTimeMs: 60 * MIN, sessions: 3, turns: 2, files: 1 },
      { cwd: SITE, name: 'site', agentTimeMs: 20 * MIN, sessions: 1, turns: 1, files: 2 }
    ])
  })

  it('takes the first line of the last Stop message as the summary, without its markdown', () => {
    const store = seeded()
    const byId = Object.fromEntries(buildEod(store.work, store.eodLive(), DAY13, NOW).sessions.map((s) => [s.id, s.summary]))
    expect(byId).toEqual({ a: 'Added the tasks table', b: 'Styled the site.', c: null, d: null })
  })

  it('clips a stretch that crosses midnight to each day and counts the open one up to now', () => {
    const store = seeded()
    const yesterday = buildEod(store.work, store.eodLive(), DAY12, NOW)
    expect(yesterday.totals).toMatchObject({ agentTimeMs: 10 * MIN, sessions: 1, turns: 0, filesChanged: 0, approvalsAnswered: 1 })
    expect(yesterday).toMatchObject({ closed: true, blockers: [] })
    expect(yesterday.sessions[0]).toMatchObject({ id: 'a', summary: null, status: 'idle', agentTimeMs: 10 * MIN }) // the Stop came after midnight
    // An hour later d's stretch is an hour longer; a past day does not grow.
    const later = buildEod(store.work, store.eodLive(), DAY13, NOW + 60 * MIN)
    expect(later.totals.agentTimeMs).toBe((10 + 30 + 20 + 10 + 70) * MIN)
    expect(buildEod(store.work, store.eodLive(), DAY12, NOW + 60 * MIN).totals.agentTimeMs).toBe(10 * MIN)
  })

  it('reports how a session that went on after midnight had left the day: finished, failed or neither', () => {
    const store = open()
    store.ingest([
      hook('ok', 'UserPromptSubmit', at(12, 10), { prompt: 'a' }),
      stop('ok', at(12, 10, 5), 'Fine.'),
      hook('bad', 'UserPromptSubmit', at(12, 11), { prompt: 'b' }),
      hook('bad', 'StopFailure', at(12, 11, 5), { error: 'rate_limit' }),
      hook('mid', 'UserPromptSubmit', at(12, 12), { prompt: 'c' }),
      hook('ok', 'UserPromptSubmit', at(13, 9), { prompt: 'd' }),
      hook('bad', 'UserPromptSubmit', at(13, 9, 1), { prompt: 'e' }),
      hook('mid', 'UserPromptSubmit', at(13, 9, 2), { prompt: 'f' })
    ])
    const status = Object.fromEntries(buildEod(store.work, store.eodLive(), DAY12, NOW).sessions.map((s) => [s.id, s.status]))
    expect(status).toEqual({ ok: 'done', bad: 'failed', mid: 'idle' })
    // The failed turn has no Stop, so no summary; the finished one keeps its first line.
    const summary = Object.fromEntries(buildEod(store.work, store.eodLive(), DAY12, NOW).sessions.map((s) => [s.id, s.summary]))
    expect(summary).toEqual({ ok: 'Fine.', bad: null, mid: null })
  })

  it('lists every open attention item, oldest first, today only', () => {
    const store = seeded()
    const today = buildEod(store.work, store.eodLive(), DAY13, NOW)
    expect(today.blockers).toEqual([
      { itemId: expect.any(String), kind: 'review', title: 'Added the tasks table', sessionId: 'a', project: AGENTDECK, openedAt: at(13, 9, 30) },
      { itemId: expect.any(String), kind: 'review', title: 'Styled the site.', sessionId: 'b', project: SITE, openedAt: at(13, 10, 20) },
      { itemId: expect.any(String), kind: 'approval', title: 'Run `git push --force`', sessionId: 'c', project: AGENTDECK, openedAt: at(13, 11, 10) }
    ])
    expect(buildEod(store.work, store.eodLive(), DAY13, at(14, 9)).blockers).toEqual([])
  })

  it('reports tasks finished that day and the ones still open at its end', () => {
    const store = seeded()
    const { work } = store
    const old = work.addTask({ title: 'Old and open', project: null }, at(11, 9))
    const doneToday = work.addTask({ title: 'Done today', project: AGENTDECK }, at(12, 9))
    work.updateTask(doneToday.id, { status: 'done' }, at(13, 10))
    const doneYesterday = work.addTask({ title: 'Done yesterday', project: null }, at(12, 9))
    work.updateTask(doneYesterday.id, { status: 'done' }, at(12, 15))
    const later = work.addTask({ title: 'Made after the day', project: null }, at(14, 1))

    const day13 = buildEod(work, store.eodLive(), DAY13, at(14, 2))
    expect(day13.tasksDone.map((t) => t.title)).toEqual(['Done today'])
    expect(day13.totals.tasksDone).toBe(1)
    expect(day13.carryOver.map((t) => t.id)).toEqual([old.id])
    const day12 = buildEod(work, store.eodLive(), DAY12, at(14, 2))
    expect(day12.tasksDone.map((t) => t.title)).toEqual(['Done yesterday'])
    expect(day12.carryOver.map((t) => t.title)).toEqual(['Old and open', 'Done today']) // not finished until the 13th
    expect(day13.carryOver.map((t) => t.id)).not.toContain(later.id)
  })

  it('keeps the notes, across a restart, and drops them when saved blank', () => {
    const file = tempDb()
    const first = seeded(open(file))
    first.work.setNotes(DAY13, 'Talked to Sam.\nFollow up Monday.', NOW)
    first.close()
    stores.pop()
    const again = open(file)
    expect(buildEod(again.work, again.eodLive(), DAY13, NOW).notes).toBe('Talked to Sam.\nFollow up Monday.')
    expect(again.work.noteDays()).toEqual([DAY13])
    again.work.setNotes(DAY13, '  \n', NOW)
    expect(buildEod(again.work, again.eodLive(), DAY13, NOW).notes).toBe('')
    expect(again.work.noteDays()).toEqual([])
  })

  it('treats a day with nothing in it as empty, and keeps nothing for it', () => {
    const store = open()
    const r = buildEod(store.work, store.eodLive(), DAY13, NOW)
    expect(r.totals).toEqual({ agentTimeMs: 0, sessions: 0, turns: 0, filesChanged: 0, approvalsAnswered: 0, tasksDone: 0 })
    expect(hasContent(r)).toBe(false)
    expect(refreshEod(store.work, store.eodLive(), DAY13, NOW)).toMatchObject({ changed: false })
    expect(finalizeEod(store.work, store.eodLive(), DAY12, NOW)).toMatchObject({ fresh: true, report: { closed: true } })
    expect(store.work.keptDays()).toEqual([])
  })
})

describe('keeping today fresh', () => {
  it('keeps an open copy, and says "changed" only when the day has something new', () => {
    const store = seeded()
    const { work } = store
    store.ingest([stop('d', at(13, 12), 'Finished the long one.')]) // nothing is working any more
    const first = refreshEod(work, store.eodLive(), DAY13, at(13, 12, 5))
    expect(first.changed).toBe(true)
    expect(first.report).toMatchObject({ closed: false, generatedAt: at(13, 12, 5), totals: { sessions: 4 } })
    expect(work.kept(DAY13)).toMatchObject({ closed: false, report: { totals: { sessions: 4 } } })
    expect(refreshEod(work, store.eodLive(), DAY13, at(13, 12, 15)).changed).toBe(false) // ten quiet minutes

    work.setNotes(DAY13, 'a note', at(13, 12, 16))
    expect(refreshEod(work, store.eodLive(), DAY13, at(13, 12, 25))).toMatchObject({ changed: true, report: { notes: 'a note' } })

    store.ingest([hook('a', 'UserPromptSubmit', at(13, 13), { prompt: 'more' }), edit('a', at(13, 13, 5), `${AGENTDECK}\\new.ts`), stop('a', at(13, 13, 10), 'More.')])
    const late = refreshEod(work, store.eodLive(), DAY13, at(13, 13, 15))
    expect(late.changed).toBe(true)
    expect(late.report.totals.filesChanged).toBe(3)
    expect(work.kept(DAY13)?.report.totals.filesChanged).toBe(3)
  })

  it('has something new every time while a session is working', () => {
    const store = seeded()
    expect(refreshEod(store.work, store.eodLive(), DAY13, NOW).changed).toBe(true)
    expect(refreshEod(store.work, store.eodLive(), DAY13, NOW).changed).toBe(false) // same instant
    expect(refreshEod(store.work, store.eodLive(), DAY13, NOW + 10 * MIN).changed).toBe(true) // d worked ten more minutes
  })

  it('never says the report is closed while the day is going', () => {
    const store = seeded()
    expect(refreshEod(store.work, store.eodLive(), DAY13, at(13, 23, 59)).report.closed).toBe(false)
    expect(reportFor(store.work, store.eodLive(), DAY13, at(13, 23, 59)).closed).toBe(false)
  })
})

describe('closing a day', () => {
  it('keeps the final report once, only after the day is over, and answers from it afterwards', () => {
    const store = seeded()
    const early = finalizeEod(store.work, store.eodLive(), DAY13, at(13, 23))
    expect(early).toMatchObject({ fresh: false, report: { closed: false } })
    expect(store.work.closedDays()).toEqual([])

    const closeAt = at(14, 0, 1)
    const first = finalizeEod(store.work, store.eodLive(), DAY13, closeAt)
    expect(first).toMatchObject({ fresh: true, report: { closed: true, generatedAt: closeAt } })
    expect(store.work.closedDays()).toEqual([DAY13])

    store.ingest([hook('a', 'UserPromptSubmit', at(14, 8), { prompt: 'next day' }), stop('a', at(14, 9), 'Next day.')])
    const second = finalizeEod(store.work, store.eodLive(), DAY13, at(14, 10))
    expect(second.fresh).toBe(false)
    expect(second.report).toEqual(first.report) // the kept report, not a rebuild
    expect(refreshEod(store.work, store.eodLive(), DAY13, at(14, 10))).toMatchObject({ changed: false }) // a closed day stays closed
  })

  it('serves a closed day from storage with its notes still editable, while the new day is live and open', () => {
    const store = seeded()
    const closed = finalizeEod(store.work, store.eodLive(), DAY13, at(14, 0, 1)).report
    const next = at(14, 9)
    expect(reportFor(store.work, store.eodLive(), DAY13, next)).toEqual(closed)
    store.work.setNotes(DAY13, 'Added the next morning', next)
    expect(reportFor(store.work, store.eodLive(), DAY13, next).notes).toBe('Added the next morning')
    expect(reportFor(store.work, store.eodLive(), '2026-11-14', next)).toMatchObject({ closed: false, generatedAt: next })
  })

  it('rebuilds a day that is over but was never closed, from the events still on disk', () => {
    const store = seeded()
    const r = reportFor(store.work, store.eodLive(), DAY13, at(15, 9))
    expect(r).toMatchObject({ closed: true, totals: { sessions: 4, turns: 3 } })
    expect(store.work.keptDays()).toEqual([])
  })

  it('never closes a day emptier than the copy kept while it went: what aged out of memory stays', () => {
    const store = seeded()
    const { work } = store
    const kept = refreshEod(work, store.eodLive(), DAY13, at(13, 23, 50)).report
    const task = work.addTask({ title: 'Done late', project: null }, at(13, 9))
    work.updateTask(task.id, { status: 'done' }, at(13, 23, 55))
    const gone: ReturnType<Store['eodLive']> = { sessions: new Map(), attention: [] } // its sessions are no longer known
    const final = finalizeEod(work, gone, DAY13, at(14, 0, 5)).report
    expect(final.sessions).toEqual(kept.sessions)
    expect(final.projects).toEqual(kept.projects)
    expect(final.totals).toEqual({ ...kept.totals, tasksDone: 1 }) // the task table is current
    expect(final.tasksDone.map((t) => t.title)).toEqual(['Done late'])
    expect(work.kept(DAY13)).toMatchObject({ closed: true, report: { sessions: kept.sessions } })

    const other = seeded(open())
    const keptOther = refreshEod(other.work, other.eodLive(), DAY13, at(13, 23, 50)).report
    expect(reportFor(other.work, gone, DAY13, at(15, 9)).sessions).toEqual(keptOther.sessions) // same rule for a day not yet closed
  })

  it('keepFuller keeps the new report when it is as full, and the kept agent part when it is not', () => {
    const store = seeded()
    const full = buildEod(store.work, store.eodLive(), DAY13, NOW)
    const nothing = open()
    const empty = buildEod(nothing.work, nothing.eodLive(), DAY13, NOW)
    expect(keepFuller(full, empty)).toBe(full)
    expect(keepFuller(full, full)).toBe(full)
    expect(keepFuller({ ...empty, notes: 'n' }, full)).toMatchObject({ notes: 'n', sessions: full.sessions, projects: full.projects })
  })

  it('lists days newest first, with the ones that were closed marked', () => {
    const store = seeded()
    store.work.setNotes('2026-11-01', 'only notes', NOW)
    finalizeEod(store.work, store.eodLive(), DAY12, at(13, 8))
    const days = eodDays(store.work, store.eodLive(), NOW)
    expect(days.map((d) => [d.day, d.closed])).toEqual([[DAY13, false], [DAY12, true], ['2026-11-01', false]])
    expect(days[0]).toEqual({ day: DAY13, agentTimeMs: 80 * MIN, sessions: 4, tasksDone: 0, hasFile: false, closed: false })
    expect(days[1]).toMatchObject({ day: DAY12, agentTimeMs: 10 * MIN, sessions: 1 })
  })

  it('rebuilds at most the last 30 days for the list; older days appear only through a closed report', () => {
    const store = open()
    const { work } = store
    const DAY_MS = 86_400_000
    const daysAgo = (n: number): number => NOW - n * DAY_MS
    const worked = (sid: string, ts: number): AgentEvent[] => [hook(sid, 'UserPromptSubmit', ts, { prompt: sid }), stop(sid, ts + 5 * MIN, sid)]
    store.ingest([...worked('new', daysAgo(29)), ...worked('closed-old', daysAgo(35)), ...worked('open-old', daysAgo(40))])
    const olderTask = work.addTask({ title: 'Long ago', project: null }, daysAgo(60))
    work.updateTask(olderTask.id, { status: 'done' }, daysAgo(45))
    work.setNotes(dayKey(daysAgo(50)), 'old notes', daysAgo(50))
    finalizeEod(work, store.eodLive(), dayKey(daysAgo(35)), NOW) // closed while its events existed

    expect(eodDays(work, store.eodLive(), NOW).map((d) => [d.day, d.closed])).toEqual([[dayKey(daysAgo(29)), false], [dayKey(daysAgo(35)), true]])
    // A day past 30 days that was never closed is not listed, but can still be opened by its date.
    expect(reportFor(work, store.eodLive(), dayKey(daysAgo(40)), NOW).totals.sessions).toBe(1)
    expect(reportFor(work, store.eodLive(), dayKey(daysAgo(50)), NOW).notes).toBe('old notes')
  })
})

describe('retention', () => {
  it('prunes events but keeps tasks, notes and closed reports; only old finished tasks age out', () => {
    const file = tempDb()
    const store = seeded(open(file))
    const open1 = store.work.addTask({ title: 'Still open', project: null }, at(1))
    const recent = store.work.addTask({ title: 'Done a while ago', project: null }, at(1))
    store.work.updateTask(recent.id, { status: 'done' }, at(2))
    const ancient = store.work.addTask({ title: 'Done long ago', project: null }, at(1))
    store.work.updateTask(ancient.id, { status: 'done' }, at(2) - TASK_RETENTION_MS)
    store.work.setNotes(DAY13, 'keep me', NOW)
    const closed = finalizeEod(store.work, store.eodLive(), DAY13, at(14, 1)).report

    const later = at(13) + RETENTION_MS + 2 * 86_400_000
    store.prune(later)

    const db = new DatabaseSync(file)
    const count = (table: string): number => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n)
    for (const t of ['events', 'sessions', 'work_spans', 'finished_turns', 'files', 'attention_items', 'approvals']) expect(count(t), t).toBe(0)
    expect(count('eod_notes')).toBe(1)
    expect(count('eod_reports')).toBe(1)
    expect(db.prepare('SELECT title FROM tasks ORDER BY title').all()).toEqual([{ title: 'Done a while ago' }, { title: 'Still open' }])
    db.close()

    expect(store.work.listTasks().map((t) => t.id)).toEqual([open1.id, recent.id])
    expect(reportFor(store.work, store.eodLive(), DAY13, later)).toEqual({ ...closed, notes: 'keep me' })
    // Only the closed report is listed: the rest is older than the 30 days the list rebuilds.
    expect(eodDays(store.work, store.eodLive(), later)).toEqual([expect.objectContaining({ day: DAY13, closed: true, sessions: 4 })])
  })
})

describe('handleWork', () => {
  it('answers every request kind', () => {
    const store = seeded()
    const now = NOW
    const added = handleWork(store, { kind: 'tasks.add', input: { title: 'Write tests', project: null } }, now)
    expect(added).toMatchObject({ kind: 'task', result: { ok: true, task: { title: 'Write tests', createdAt: now } } })
    const id = added.kind === 'task' && added.result.ok ? added.result.task.id : ''
    expect(handleWork(store, { kind: 'tasks.list' }, now)).toMatchObject({ kind: 'tasks', tasks: [{ id }] })
    expect(handleWork(store, { kind: 'tasks.update', id, patch: { status: 'done' } }, now + 5)).toMatchObject({ kind: 'task', result: { ok: true, task: { doneAt: now + 5 } } })
    expect(handleWork(store, { kind: 'eod.notes', day: DAY13, notes: 'hi' }, now)).toEqual({ kind: 'ok', result: { ok: true } })
    expect(handleWork(store, { kind: 'eod.get', day: DAY13 }, now)).toMatchObject({ kind: 'eod', report: { day: DAY13, notes: 'hi', totals: { sessions: 4, tasksDone: 1 } } })
    expect(handleWork(store, { kind: 'eod.days' }, now)).toMatchObject({ kind: 'days', days: [{ day: DAY13 }, { day: DAY12 }] })
    expect(handleWork(store, { kind: 'eod.refresh', day: DAY13 }, now)).toMatchObject({ kind: 'refreshed', changed: true, report: { day: DAY13, closed: false } })
    expect(handleWork(store, { kind: 'eod.refresh', day: DAY13 }, now)).toMatchObject({ kind: 'refreshed', changed: false })
    expect(handleWork(store, { kind: 'eod.finalize', day: DAY12 }, now)).toMatchObject({ kind: 'finalized', fresh: true, report: { day: DAY12, closed: true } })
    expect(handleWork(store, { kind: 'eod.finalize', day: DAY12 }, now)).toMatchObject({ kind: 'finalized', fresh: false })
    expect(handleWork(store, { kind: 'tasks.remove', id }, now)).toEqual({ kind: 'ok', result: { ok: true } })
    expect(handleWork(store, { kind: 'tasks.list' }, now)).toEqual({ kind: 'tasks', tasks: [] })
  })

  it('throws on a day that is not a day, for the caller to report', () => {
    expect(() => handleWork(open(), { kind: 'eod.get', day: '2026-02-31' }, NOW)).toThrow(RangeError)
  })
})

describe('firstLine', () => {
  it('skips blank lines, fences and markdown marks, and collapses spaces', () => {
    expect(firstLine('\n\n## Heading  with   gaps\nnext')).toBe('Heading with gaps')
    expect(firstLine('- a bullet\n- another')).toBe('a bullet')
    expect(firstLine('> quoted')).toBe('quoted')
    expect(firstLine('```ts\ncode\n```\nThe real line')).toBe('code')
    expect(firstLine('   \n  ')).toBeNull()
    expect(firstLine('')).toBeNull()
    expect(firstLine(null)).toBeNull()
  })

  it('cuts a long line to 160 characters with an ellipsis', () => {
    const line = firstLine('x'.repeat(500))!
    expect(line).toHaveLength(SUMMARY_MAX)
    expect(line.endsWith('…')).toBe(true)
    expect(firstLine('y'.repeat(SUMMARY_MAX))).toBe('y'.repeat(SUMMARY_MAX))
  })
})
