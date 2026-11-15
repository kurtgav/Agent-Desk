import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkTask } from '@shared/work'
import type { AgentEvent } from './events'
import { WORK_COALESCE_MS, TaskFollower, statusesOf, touchesReport, trailing } from './follow'
import { normalizeHook } from './normalize'
import { Store } from './store'
import { handleWork } from './work'

const stores: Store[] = []
afterEach(() => {
  vi.useRealTimers()
  for (const s of stores.splice(0)) s.close()
})

const T0 = new Date(2026, 10, 13, 10, 0).getTime()
const MIN = 60_000
const PROJECT = 'D:\\code\\agentdeck'
/** A hook-only session is named after its folder, and a task links to a session by that name (D-128). */
const NAME = 'agentdeck'

const hook = (sid: string, kind: string, ts: number, extra: Record<string, unknown> = {}, cwd = PROJECT): AgentEvent =>
  normalizeHook(JSON.stringify({ session_id: sid, hook_event_name: kind, cwd, ...extra }), ts)!
const prompt = (sid: string, ts: number, cwd = PROJECT): AgentEvent => hook(sid, 'UserPromptSubmit', ts, { prompt: `go at ${ts}` }, cwd)
const stop = (sid: string, ts: number, message = 'All done.', extra: Record<string, unknown> = {}, cwd = PROJECT): AgentEvent =>
  hook(sid, 'Stop', ts, { stop_hook_active: false, last_assistant_message: message, ...extra }, cwd)
const failure = (sid: string, ts: number): AgentEvent => hook(sid, 'StopFailure', ts, { error: 'rate_limit' })
const permission = (sid: string, ts: number): AgentEvent =>
  hook(sid, 'PermissionRequest', ts, { tool_name: 'Bash', tool_input: { command: 'git push --force' } })
const ended = (sid: string, ts: number): AgentEvent => hook(sid, 'SessionEnd', ts, { reason: 'other' })
/** `claude agents` listing the background session as done again, once the hook window has passed. */
const pollDone = (sid: string, ts: number): AgentEvent => ({
  id: `p${ts}`, ts, source: 'poll', sessionId: sid, agentId: null, parentAgentId: null, agentType: null, kind: 'session.state', toolName: null, toolUseId: null,
  summary: 'Status: done', payload: { kind: 'background', state: 'done', id: 'bg-1', cwd: PROJECT }, cwd: PROJECT, dedupeKey: null
})

interface Rig {
  store: Store
  follower: TaskFollower
  /** What app.ts does for a batch of events: read the statuses, ingest, then follow. */
  feed(...events: AgentEvent[]): boolean
  /** A task sent to an agent: In progress, linked to `name`. */
  send(title: string, name?: string | null, status?: 'todo' | 'doing'): WorkTask
  task(id: string): WorkTask
}

function rig(): Rig {
  const store = new Store(':memory:', T0)
  stores.push(store)
  const follower = new TaskFollower(store.work, () => store.eodLive().sessions)
  return {
    store,
    follower,
    feed: (...events) => {
      const before = statusesOf(store.eodLive().sessions, events)
      store.ingest(events)
      return follower.follow(events, before)
    },
    send: (title, name = NAME, status = 'doing') => {
      const added = store.work.addTask({ title, project: PROJECT }, T0)
      const r = store.work.updateTask(added.id, { status, sessionName: name }, T0)
      follower.invalidate()
      if (!r.ok) throw new Error(r.error)
      return r.task
    },
    task: (id) => store.work.task(id)!
  }
}

describe('a task follows the session it was sent to', () => {
  it('moves from To do to In progress when its session starts working', () => {
    const r = rig()
    const t = r.send('Write the importer', NAME, 'todo')
    expect(r.feed(prompt('s1', T0 + MIN))).toBe(true)
    expect(r.task(t.id)).toMatchObject({ status: 'doing', doneAt: null })
  })

  it('stays In progress while the session waits on you', () => {
    const r = rig()
    const t = r.send('Clean the repo')
    r.feed(prompt('s1', T0 + MIN))
    expect(r.feed(permission('s1', T0 + 2 * MIN))).toBe(false)
    expect(r.store.eodLive().sessions.get('s1')?.status).toBe('needs_you')
    expect(r.task(t.id)).toMatchObject({ status: 'doing', doneAt: null })
  })

  it('stays In progress when the session fails', () => {
    const r = rig()
    const t = r.send('Migrate the table')
    r.feed(prompt('s1', T0 + MIN))
    expect(r.feed(failure('s1', T0 + 2 * MIN))).toBe(false)
    expect(r.store.eodLive().sessions.get('s1')?.status).toBe('failed')
    expect(r.task(t.id)).toMatchObject({ status: 'doing', doneAt: null })
  })

  it('is done at the time the session finished, not when it was noticed', () => {
    const r = rig()
    const t = r.send('Add the export')
    r.feed(prompt('s1', T0 + MIN))
    expect(r.feed(stop('s1', T0 + 5 * MIN, 'Added the export.\n\n- touched two files'))).toBe(true)
    expect(r.task(t.id)).toMatchObject({ status: 'done', doneAt: T0 + 5 * MIN })
  })

  it('stays In progress when the session ended by asking you something, and is done once a later turn finishes cleanly', () => {
    const r = rig()
    const t = r.send('Pick a library')
    r.feed(prompt('s1', T0 + MIN))
    expect(r.feed(stop('s1', T0 + 2 * MIN, 'I can use A or B.\n\nWhich one do you want?'))).toBe(false)
    expect(r.task(t.id)).toMatchObject({ status: 'doing', doneAt: null })
    r.feed(prompt('s1', T0 + 3 * MIN))
    r.feed(stop('s1', T0 + 4 * MIN, 'Used A everywhere.'))
    expect(r.task(t.id)).toMatchObject({ status: 'done', doneAt: T0 + 4 * MIN })
  })

  it('does not count a Stop that a Stop hook turned into more work as a finish', () => {
    const r = rig()
    const t = r.send('Lint it')
    r.feed(prompt('s1', T0 + MIN))
    expect(r.feed(stop('s1', T0 + 2 * MIN, 'Almost.', { stop_hook_active: true }))).toBe(false)
    expect(r.task(t.id).status).toBe('doing')
  })

  it('finishes a task whose turn started and ended in one batch, or ended with the session in the same batch', () => {
    const r = rig()
    const quick = r.send('Quick one')
    expect(r.feed(prompt('s1', T0 + MIN), stop('s1', T0 + MIN + 5_000, 'Done.'))).toBe(true)
    expect(r.task(quick.id)).toMatchObject({ status: 'done', doneAt: T0 + MIN + 5_000 })

    const other = rig()
    const t = other.send('Ends with the session')
    other.feed(prompt('s2', T0 + MIN))
    other.feed(stop('s2', T0 + 2 * MIN, 'Done.'), ended('s2', T0 + 2 * MIN + 500))
    expect(other.store.eodLive().sessions.get('s2')?.status).toBe('idle')
    expect(other.task(t.id)).toMatchObject({ status: 'done', doneAt: T0 + 2 * MIN })
  })

  it('completes a task from the poll alone (no hooks), when it saw the session work', () => {
    const r = rig()
    const t = r.send('Untrusted folder')
    r.feed(prompt('s1', T0))
    // The turn ended without a Stop reaching us (Esc, or the folder was not trusted): the poll says done after the hook window.
    r.feed(pollDone('s1', T0 + MIN))
    expect(r.task(t.id)).toMatchObject({ status: 'done', doneAt: T0 + MIN })
  })

  it('names a session by the folder until the poll gives it a name: the task follows once the name matches', () => {
    const r = rig()
    const t = r.send('Named by the poll', 'brisk-otter-7')
    r.feed(prompt('s1', T0 + MIN))
    expect(r.task(t.id).status).toBe('doing')
    r.feed(stop('s1', T0 + 2 * MIN))
    expect(r.task(t.id).status).toBe('doing') // no session of that name yet
    const named: AgentEvent = { ...pollDone('s1', T0 + MIN + 20_000), payload: { kind: 'background', state: 'working', name: 'brisk-otter-7', id: 'bg-1', cwd: PROJECT } }
    r.feed(named) // working under its own name: the task has seen it work
    r.feed(prompt('s1', T0 + 3 * MIN), stop('s1', T0 + 4 * MIN, 'Done.'))
    expect(r.task(t.id)).toMatchObject({ status: 'done', doneAt: T0 + 4 * MIN })
  })
})

describe('what an agent never does', () => {
  it('does not complete a task the user moved back after the automatic completion', () => {
    const r = rig()
    const t = r.send('Fix the build')
    r.feed(prompt('s1', T0 + MIN))
    r.feed(stop('s1', T0 + 2 * MIN))
    expect(r.task(t.id).status).toBe('done')

    // The user moves it back (through the same request the window sends).
    const back = handleWork(r.store, { kind: 'tasks.update', id: t.id, patch: { status: 'doing' } }, T0 + 3 * MIN, r.follower)
    expect(back).toMatchObject({ kind: 'task', result: { ok: true, task: { status: 'doing', doneAt: null } } })

    // The same session ends and is listed as done again, then carries on and finishes once more: still the user's.
    r.feed(ended('s1', T0 + 4 * MIN))
    r.feed(pollDone('s1', T0 + 5 * MIN))
    r.feed(prompt('s1', T0 + 6 * MIN))
    r.feed(stop('s1', T0 + 7 * MIN, 'Fixed it.'))
    expect(r.task(t.id)).toMatchObject({ status: 'doing', doneAt: null })
  })

  it('does not complete a task by a finish it never saw start: the poll listing an old session as done again', () => {
    const r = rig()
    r.feed(prompt('s1', T0), stop('s1', T0 + MIN)) // finished before any task was linked
    const t = r.send('Linked afterwards')
    r.feed(ended('s1', T0 + 2 * MIN))
    r.feed(pollDone('s1', T0 + 3 * MIN)) // idle to done: a "finish" the task has no part in
    expect(r.task(t.id)).toMatchObject({ status: 'doing', doneAt: null })
  })

  it('leaves tasks without a linked session alone, and a task linked to a name no session has', () => {
    const r = rig()
    const plain = r.store.work.addTask({ title: 'Plain', project: PROJECT }, T0)
    const doing = r.store.work.updateTask(r.store.work.addTask({ title: 'Started by hand', project: null }, T0).id, { status: 'doing' }, T0)
    const stranger = r.send('Somebody else\'s session', 'no-such-session')
    r.follower.invalidate()
    expect(r.feed(prompt('s1', T0 + MIN))).toBe(false)
    expect(r.feed(stop('s1', T0 + 2 * MIN))).toBe(false)
    expect(r.task(plain.id)).toMatchObject({ status: 'todo', doneAt: null })
    expect(doing.ok && r.task(doing.task.id)).toMatchObject({ status: 'doing', doneAt: null })
    expect(r.task(stranger.id)).toMatchObject({ status: 'doing', doneAt: null })
  })

  it('never reopens or re-times a task that is done, whoever finished it', () => {
    const r = rig()
    const t = r.send('Already ticked')
    r.store.work.updateTask(t.id, { status: 'done' }, T0 + MIN)
    r.follower.invalidate()
    expect(r.feed(prompt('s1', T0 + 2 * MIN), stop('s1', T0 + 3 * MIN))).toBe(false)
    expect(r.task(t.id)).toMatchObject({ status: 'done', doneAt: T0 + MIN })
  })

  it('follows the most recently active session when two share a name', () => {
    const r = rig()
    r.feed(prompt('old', T0), stop('old', T0 + MIN, 'Done.'))
    const t = r.send('Second run')
    r.feed(prompt('new', T0 + 10 * MIN))
    expect(r.task(t.id).status).toBe('doing')
    r.feed(ended('old', T0 + 11 * MIN)) // the old session's late events are not the task's
    r.feed(pollDone('old', T0 + 12 * MIN))
    expect(r.task(t.id).status).toBe('doing')
    r.feed(stop('new', T0 + 20 * MIN, 'Done.'))
    expect(r.task(t.id)).toMatchObject({ status: 'done', doneAt: T0 + 20 * MIN })
  })

  it('forgets a deleted task, so a new one with its name starts clean', () => {
    const r = rig()
    const t = r.send('Gone soon')
    r.feed(prompt('s1', T0 + MIN))
    handleWork(r.store, { kind: 'tasks.remove', id: t.id }, T0 + 2 * MIN, r.follower)
    expect(r.feed(stop('s1', T0 + 3 * MIN))).toBe(false)
  })
})

describe('the cost of following', () => {
  it('reads the linked tasks once, not once per batch, and not at all for a batch that touches no linked session', () => {
    const r = rig()
    const linked = vi.spyOn(r.store.work, 'linkedOpen')
    for (let i = 0; i < 100; i++) r.feed(hook('s1', 'PreToolUse', T0 + i * 3_000, { tool_name: 'Bash', tool_use_id: `u${i}`, tool_input: { command: `echo ${i}` } }))
    expect(linked).toHaveBeenCalledTimes(1) // nothing linked: the empty answer is kept
    r.send('Now there is one')
    for (let i = 0; i < 100; i++) r.feed(hook('s9', 'PreToolUse', T0 + i * 3_000, { tool_name: 'Bash', tool_use_id: `v${i}`, tool_input: { command: `echo ${i}` } }, 'D:\\code\\other'))
    expect(linked).toHaveBeenCalledTimes(2) // read once more after the task changed, then kept
  })

  it('does not look at the database for a batch while no task is linked', () => {
    const r = rig()
    const query = vi.spyOn(r.store.work.db, 'prepare')
    r.feed(prompt('s1', T0))
    r.feed(prompt('s1', T0 + 10_000))
    const selects = query.mock.calls.filter(([sql]) => String(sql).includes('FROM tasks') || String(sql).includes("kind = 'turn.stopped' ORDER"))
    expect(selects).toHaveLength(1) // the one read of the linked tasks
  })
})

describe('what counts as a change to the report', () => {
  const t = (kind: string, extra: Record<string, unknown> = {}): AgentEvent => hook('s1', kind, T0, extra)
  it('is a finished or failed turn, a poll row, an end, and an edit that finished: not every tool call', () => {
    expect(touchesReport(t('Stop', { last_assistant_message: 'x' }))).toBe(true)
    expect(touchesReport(t('StopFailure', { error: 'x' }))).toBe(true)
    expect(touchesReport(t('SessionEnd'))).toBe(true)
    expect(touchesReport(pollDone('s1', T0))).toBe(true)
    expect(touchesReport(t('PostToolUse', { tool_name: 'Edit', tool_use_id: 'e1', tool_input: { file_path: 'D:\\x.ts' } }))).toBe(true)
    expect(touchesReport(t('PostToolUse', { tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'ls' } }))).toBe(false)
    expect(touchesReport(t('PreToolUse', { tool_name: 'Edit', tool_use_id: 'e2', tool_input: { file_path: 'D:\\x.ts' } }))).toBe(false)
  })

  it('reads the statuses of the sessions a batch mentions, before they change', () => {
    const r = rig()
    r.feed(prompt('s1', T0))
    const events = [stop('s1', T0 + MIN), prompt('fresh', T0 + MIN)]
    expect([...statusesOf(r.store.eodLive().sessions, events)]).toEqual([['s1', 'working']])
  })
})

describe('trailing', () => {
  it('fires once, 400 ms after the first poke, however many came', () => {
    vi.useFakeTimers()
    const fire = vi.fn()
    const t = trailing(WORK_COALESCE_MS, fire)
    for (let i = 0; i < 200; i++) {
      t.poke()
      vi.advanceTimersByTime(1)
    }
    expect(fire).toHaveBeenCalledTimes(0) // 200 ms in
    vi.advanceTimersByTime(WORK_COALESCE_MS - 200)
    expect(fire).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10_000)
    expect(fire).toHaveBeenCalledTimes(1)
    t.poke() // a later burst is a new message
    vi.advanceTimersByTime(WORK_COALESCE_MS)
    expect(fire).toHaveBeenCalledTimes(2)
  })

  it('cancel drops a message that has not gone out yet', () => {
    vi.useFakeTimers()
    const fire = vi.fn()
    const t = trailing(WORK_COALESCE_MS, fire)
    t.poke()
    t.cancel()
    vi.advanceTimersByTime(5_000)
    expect(fire).not.toHaveBeenCalled()
    expect(WORK_COALESCE_MS).toBe(400)
  })
})
