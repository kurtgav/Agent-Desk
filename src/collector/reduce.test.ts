import { describe, expect, it } from 'vitest'
import type { AgentEvent, EventKind } from './events'
import { s1Deliveries } from './fixtures'
import { normalizeHook } from './normalize'
import { HOOK_PRECEDENCE_MS, closeStale, correlate, duePoll, reduceSession, toSession, type Reduced, type SessionState } from './reduce'

interface Replay {
  sessions: Map<string, SessionState>
  spans: [number, number][]
  finished: number[]
  files: string[]
  history: Map<string, SessionState[]>
}

function replay(events: AgentEvent[], start?: Map<string, SessionState>): Replay {
  const r: Replay = { sessions: new Map(start), spans: [], finished: [], files: [], history: new Map() }
  for (const raw of events) {
    const prev = r.sessions.get(raw.sessionId)
    const out: Reduced = reduceSession(prev, correlate(prev, raw))
    r.sessions.set(raw.sessionId, out.session)
    r.history.set(raw.sessionId, [...(r.history.get(raw.sessionId) ?? []), out.session])
    if (out.span) r.spans.push(out.span)
    if (out.finishedAt !== null) r.finished.push(out.finishedAt)
    if (out.file) r.files.push(out.file.path)
  }
  return r
}

let n = 0
function ev(kind: EventKind, fields: Partial<AgentEvent> & { ts: number }): AgentEvent {
  return {
    id: `e${n++}`, source: 'hook', sessionId: 's1', agentId: null, parentAgentId: null, agentType: null, kind,
    toolName: null, toolUseId: null, summary: kind, payload: {}, cwd: 'D:\\proj', dedupeKey: null, ...fields
  }
}
const poll = (ts: number, row: Record<string, unknown>) => ev('session.state', { ts, source: 'poll', payload: row })

const S1_MAIN = '2afb6f39-5dd7-4a3c-a86f-840775c89dd5'
const s1 = () => s1Deliveries().map((d) => normalizeHook(d.raw, d.ts)!)

describe('S1 replay (STATE_MACHINE § 6 test 1)', () => {
  const r = replay(s1())
  const main = r.history.get(S1_MAIN)!

  it('finishes the main turn as done before the session ends', () => {
    const done = main.findIndex((s) => s.status === 'done')
    expect(done).toBeGreaterThan(0)
    expect(main[done]!.activity).toBe('Finished')
    expect(main.at(-1)).toMatchObject({ ended: true, status: 'idle', inflight: [], agents: [] })
  })

  it('nests the Explore subagent under its parent with its task, then finishes it', () => {
    const running = main.find((s) => s.agents.length > 0)!
    expect(toSession(running).subagents).toEqual([
      expect.objectContaining({ id: 'adb875602d90356fb', agentType: 'Explore', task: 'Count files in scratch folder' })
    ])
    const stopped = main.findIndex((s, i) => i > main.indexOf(running) && s.agents.length === 0)
    expect(stopped).toBeGreaterThan(main.indexOf(running))
  })

  it('counts the plan: 1 task created and completed', () => {
    expect(toSession(main.at(-1)!).plan).toEqual({ done: 1, total: 1 })
  })

  it('records hello.txt as the only changed file', () => {
    expect(new Set(r.files.map((f) => f.split('\\').pop()))).toEqual(new Set(['hello.txt']))
  })

  it('counts one finished task per real prompt, never the <task-notification> one', () => {
    const prompts = s1().filter((e) => e.kind === 'session.prompt').length
    expect(prompts).toBe(6)
    expect(r.finished).toHaveLength(prompts)
  })

  it('leaves nothing in flight once every session has stopped', () => {
    for (const s of r.sessions.values()) expect(s.inflight).toEqual([])
  })

  it('logs working time between prompt and stop', () => {
    const total = r.spans.reduce((t, [a, b]) => t + (b - a), 0)
    expect(total).toBeGreaterThan(0)
    for (const [a, b] of r.spans) expect(b).toBeGreaterThan(a)
  })
})

describe('S4 permission sequences (test 2)', () => {
  const r = replay(s1())
  const statuses = (id: string) => r.history.get(id)!.map((s) => s.status)

  it('allow: waits on you with the exact command, then resumes and finishes', () => {
    const h = r.history.get('249e7bbb-edfc-4363-9007-d004c9cbe325')!
    const waiting = h.find((s) => s.status === 'needs_you')!
    expect(waiting.activity).toBe('Waiting to run `mkdir perm-allow`')
    expect(waiting.waitingSince).not.toBeNull()
    expect(statuses('249e7bbb-edfc-4363-9007-d004c9cbe325')).toEqual(['working', 'working', 'needs_you', 'working', 'done', 'idle'])
  })

  it.each(['25f5f1ab', 'bc3837ac'])('deny / no answer (%s): Stop with no Post ends the wait and empties the inflight set', (prefix) => {
    const id = [...r.sessions.keys()].find((k) => k.startsWith(prefix))!
    expect(statuses(id)).toEqual(['working', 'working', 'needs_you', 'done', 'idle'])
    expect(r.history.get(id)!.at(-2)!.inflight).toEqual([])
  })
})

describe('PermissionRequest correlation (test 3)', () => {
  const pre = (ts: number, id: string, command: string) =>
    ev('tool.started', { ts, toolName: 'Bash', toolUseId: id, payload: { tool_input: { command } } })
  const ask = (ts: number, command: string) => ev('permission.requested', { ts, toolName: 'Bash', payload: { tool_input: { command } } })

  it('picks the parallel call whose input matches, not just the latest one', () => {
    const { sessions } = replay([pre(1, 'a', 'npm test'), pre(2, 'b', 'rm -rf dist')])
    const s = sessions.get('s1')!
    expect(correlate(s, ask(3, 'npm test')).toolUseId).toBe('a')
    expect(correlate(s, ask(3, 'rm -rf dist')).toolUseId).toBe('b')
    expect(correlate(s, ask(3, 'something else')).toolUseId).toBeNull()
  })

  it('takes the latest open call when inputs are equal, and ignores other agents', () => {
    const { sessions } = replay([pre(1, 'a', 'ls'), pre(2, 'b', 'ls'), { ...pre(3, 'c', 'ls'), agentId: 'sub' }])
    expect(correlate(sessions.get('s1')!, ask(4, 'ls')).toolUseId).toBe('b')
  })
})

describe('poll-only sessions (test 4)', () => {
  it('a background session goes idle → working → needs_you → working → done → idle, from the poll alone', () => {
    const bg = { kind: 'background', id: 'afc61673', sessionId: 's1', cwd: 'D:\\proj', name: 'fix-bug', pid: 42, startedAt: 500 }
    const r = replay([
      poll(1_000, { ...bg, state: 'working', status: 'busy' }),
      poll(4_000, { ...bg, state: 'blocked', status: 'waiting', waitingFor: 'permission prompt' }),
      poll(7_000, { ...bg, state: 'working', status: 'busy' }),
      poll(10_000, { ...bg, state: 'done', status: 'idle' }),
      poll(13_000, { ...bg, state: 'done', status: 'idle' }),
      poll(16_000, { ...bg, state: 'stopped', status: 'idle' })
    ])
    expect(r.history.get('s1')!.map((s) => s.status)).toEqual(['working', 'needs_you', 'working', 'done', 'done', 'done'])
    expect(r.history.get('s1')![1]!.activity).toBe('Waiting for your OK')
    expect(r.sessions.get('s1')).toMatchObject({ name: 'fix-bug', bgId: 'afc61673', pid: 42, startedAt: 500 })
    expect(r.finished).toEqual([10_000]) // bg state=done counts once (D-010)
    expect(r.spans).toEqual([[1_000, 4_000], [7_000, 10_000]]) // waiting time is not agent time (D-012)
  })

  it('an interactive session that goes idle mid-turn (Esc) shows Idle; session.gone ends it', () => {
    const row = { kind: 'interactive', sessionId: 's1', cwd: 'D:\\proj', name: 'web', pid: 7 }
    const r = replay([poll(1_000, { ...row, status: 'busy' }), poll(4_000, { ...row, status: 'idle' }), ev('session.gone', { ts: 9_000, source: 'poll' })])
    expect(r.history.get('s1')!.map((s) => [s.status, s.activity])).toEqual([['working', 'Working'], ['idle', 'Idle'], ['idle', 'Ended']])
    expect(r.sessions.get('s1')!.ended).toBe(true)
    expect(r.sessions.get('s1')!.lastEventAt).toBe(4_000) // gone says "ended since", not "ended at 9 s"
  })
})

describe('held-back polls (D-058)', () => {
  const row = { kind: 'interactive', sessionId: 's1', cwd: 'D:\\proj', pid: 7 }

  it('a poll inside the hook window is kept, and due once the window has passed', () => {
    const r = replay([ev('session.prompt', { ts: 1_000 }), poll(3_300, { ...row, status: 'idle' })])
    const s = r.sessions.get('s1')!
    expect(s).toMatchObject({ status: 'working', pollPending: true })
    expect(duePoll(s, 1_000 + HOOK_PRECEDENCE_MS - 1)).toBeNull()
    const due = duePoll(s, 1_000 + HOOK_PRECEDENCE_MS)!
    expect(due).toMatchObject({ kind: 'session.state', source: 'poll', payload: { status: 'idle' } })
    const after = replay([due], r.sessions).sessions.get('s1')!
    expect(after).toMatchObject({ status: 'idle', activity: 'Idle', pollPending: false })
    expect(duePoll(after, 60_000)).toBeNull()
  })

  it('an ended session has nothing due', () => {
    const r = replay([ev('session.prompt', { ts: 1_000 }), poll(2_000, { ...row, status: 'idle' }), ev('session.ended', { ts: 2_500 })])
    expect(duePoll(r.sessions.get('s1')!, 60_000)).toBeNull()
  })
})

describe('closeStale (D-057)', () => {
  it('ends a working stretch at the last event and leaves the rest alone', () => {
    const r = replay([ev('session.prompt', { ts: 1_000 }), ev('tool.started', { ts: 4_000, toolName: 'Bash', toolUseId: 't', summary: 'Running `x`' })])
    const { session, span } = closeStale(r.sessions.get('s1')!)
    expect(span).toEqual([1_000, 4_000])
    expect(session).toMatchObject({ status: 'idle', workingSince: null, activity: 'Idle', inflight: [], agents: [] })
    const done = replay([ev('session.prompt', { ts: 1_000 }), ev('turn.stopped', { ts: 2_000, payload: { stop_hook_active: false } })]).sessions.get('s1')!
    expect(closeStale(done)).toEqual({ session: done, span: null })
  })
})

describe('hooks win over a lagging poll (test 6)', () => {
  const row = { kind: 'interactive', sessionId: 's1', cwd: 'D:\\proj', pid: 7 }
  const base = [ev('session.prompt', { ts: 1_000 }), ev('turn.stopped', { ts: 3_000, payload: { stop_hook_active: false } })]

  it('a busy poll within 5 s of Stop does not undo done', () => {
    const r = replay([...base, poll(3_000 + HOOK_PRECEDENCE_MS - 1, { ...row, status: 'busy' })])
    expect(r.sessions.get('s1')!.status).toBe('done')
    expect(r.finished).toEqual([3_000])
  })

  it('an idle poll never undoes done (latest turn outcome beats an idle poll)', () => {
    const r = replay([...base, poll(60_000, { ...row, status: 'idle' })])
    expect(r.sessions.get('s1')!.status).toBe('done')
  })

  it('after the window the poll is trusted again', () => {
    const r = replay([...base, poll(3_000 + HOOK_PRECEDENCE_MS, { ...row, status: 'busy' })])
    expect(r.sessions.get('s1')!.status).toBe('working')
  })

  it('a Stop that a Stop hook continued is not a finished turn', () => {
    const r = replay([ev('session.prompt', { ts: 1_000 }), ev('turn.stopped', { ts: 2_000, payload: { stop_hook_active: true } })])
    expect(r.sessions.get('s1')!.status).toBe('working')
    expect(r.finished).toEqual([])
  })
})

describe('ordering (test 7, reducer side)', () => {
  it('a Post that arrives before its Pre leaves nothing in flight after Stop', () => {
    const r = replay([
      ev('session.prompt', { ts: 1 }),
      ev('tool.finished', { ts: 2, toolName: 'Read', toolUseId: 't1' }),
      ev('tool.started', { ts: 3, toolName: 'Read', toolUseId: 't1' }),
      ev('turn.stopped', { ts: 4, payload: {} })
    ])
    expect(r.sessions.get('s1')!.inflight).toEqual([])
  })

  it('a repeated tool.started is tracked once', () => {
    const pre = ev('tool.started', { ts: 2, toolName: 'Read', toolUseId: 't1' })
    const r = replay([pre, { ...pre, id: 'dup' }])
    expect(r.sessions.get('s1')!.inflight).toHaveLength(1)
  })
})

describe('subagents do not change the pill', () => {
  it('a subagent tool call updates its row, not the session activity', () => {
    const r = replay([
      ev('session.prompt', { ts: 1 }),
      ev('tool.started', { ts: 2, toolName: 'Agent', toolUseId: 'a1', summary: 'Delegating to Explore', payload: { tool_input: { subagent_type: 'Explore', description: 'Find callers' } } }),
      ev('subagent.started', { ts: 3, agentId: 'x', agentType: 'Explore' }),
      ev('tool.started', { ts: 4, agentId: 'x', toolName: 'Grep', toolUseId: 'g', summary: 'Searching "auth"' }),
      ev('turn.stopped', { ts: 5, payload: {} })
    ])
    const s = r.sessions.get('s1')!
    expect(s.activity).toBe('Finished')
    expect(s.agents).toEqual([expect.objectContaining({ task: 'Find callers', activity: 'Searching "auth"' })])
    expect(s.inflight.map((t) => t.toolUseId)).toEqual(['g']) // Stop clears only the main thread's calls
  })
})
