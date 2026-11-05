import { isDeepStrictEqual } from 'node:util'
import type { Session, Status, Surface } from '@shared/snapshot'
import { projectName } from '@shared/paths'
import { ulid, type AgentEvent } from './events'

/** STATE_MACHINE § 1: hook events win over the poll for this long after they arrive. */
export const HOOK_PRECEDENCE_MS = 5_000

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])
const DELEGATE_TOOLS = new Set(['Agent', 'Task'])

export interface Inflight {
  toolUseId: string
  agentId: string | null
  toolName: string
  input: unknown
  summary: string
  /** For the "one tool running > M min" stall rule (STATE_MACHINE § 3 P3). Absent in pre-M3 rows. */
  startedAt?: number
}

export interface AgentRun {
  id: string
  agentType: string
  task: string
  activity: string
  startedAt: number
  /** The delegating Agent call, so two parallel launches of one type get their own task text. */
  toolUseId: string | null
}

/** Everything the reducers know about one session; persisted as JSON in `sessions.state`. */
export interface SessionState {
  id: string
  bgId: string | null
  name: string
  /** A poll-supplied name beats the project-folder default. */
  named: boolean
  cwd: string
  surface: Surface
  pid: number | null
  status: Status
  ended: boolean
  startedAt: number
  lastEventAt: number
  /** Last hook event; 0 = this session never sent one (poll-only, e.g. an untrusted folder). */
  hookAt: number
  activity: string
  tasks: Record<string, boolean>
  waitingSince: number | null
  /** The agent whose permission request is open (STATE_MACHINE § 3 P1 stand-in until M3's attention engine). */
  waitingOn: { agentId: string | null } | null
  /** What opened the current turn; synthetic `<task-notification>` turns never count as finished (D-010). */
  turn: 'prompt' | 'notified' | null
  workingSince: number | null
  agents: AgentRun[]
  inflight: Inflight[]
  /** The latest poll row; the Poller only reports changes, so this is still what `claude agents` says. */
  poll?: Record<string, unknown> | null
  /** The hook window held `poll` back; it is applied once the window has passed (duePoll). Absent in pre-M2 rows. */
  pollPending?: boolean
}

export interface Reduced {
  session: SessionState
  /** A closed stretch of `working` time (D-012). */
  span: [number, number] | null
  /** A finished task (D-010). */
  finishedAt: number | null
  /** An edit-tool change (D-011). */
  file: { path: string; tool: string } | null
}

const str = (o: Record<string, unknown>, k: string): string | null => (typeof o[k] === 'string' ? (o[k] as string) : null)
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

function fresh(ev: AgentEvent): SessionState {
  const cwd = ev.cwd ?? ''
  return {
    id: ev.sessionId,
    bgId: null,
    name: projectName(cwd) || 'Session',
    named: false,
    cwd,
    surface: 'cli',
    pid: null,
    status: 'idle',
    ended: false,
    startedAt: ev.ts,
    lastEventAt: ev.ts,
    hookAt: 0,
    activity: 'Idle',
    tasks: {},
    waitingSince: null,
    waitingOn: null,
    turn: null,
    workingSince: null,
    agents: [],
    inflight: []
  }
}

/** PermissionRequest has no tool_use_id: take the latest open call of that agent and tool with an equal input (S4). */
export function correlate(s: SessionState | undefined, ev: AgentEvent): AgentEvent {
  if (ev.kind !== 'permission.requested' || !s || ev.toolUseId) return ev
  const input = ev.payload.tool_input
  for (let i = s.inflight.length - 1; i >= 0; i--) {
    const t = s.inflight[i]!
    if (t.agentId === ev.agentId && t.toolName === ev.toolName && isDeepStrictEqual(t.input, input)) {
      return { ...ev, toolUseId: t.toolUseId }
    }
  }
  return ev
}

const WAIT_VERBS: [RegExp, string][] = [
  [/^Running /, 'Waiting to run '],
  [/^Editing /, 'Waiting to edit '],
  [/^Reading /, 'Waiting to read '],
  [/^Fetching /, 'Waiting to fetch '],
  [/^Searching /, 'Waiting to search ']
]

function waitingText(summary: string | null): string {
  if (!summary) return 'Waiting for your OK'
  for (const [re, to] of WAIT_VERBS) if (re.test(summary)) return summary.replace(re, to)
  return 'Waiting for your OK'
}

/** `claude agents` waitingFor values (agent-view table; S7). */
function pollWaitingText(waitingFor: string | null): string {
  switch (waitingFor) {
    case 'permission prompt':
    case 'sandbox request':
      return 'Waiting for your OK'
    case 'input needed':
    case 'worker request':
      return 'Waiting for your answer'
    case 'dialog open':
      return 'Waiting on a dialog'
    default:
      return waitingFor ? `Waiting: ${waitingFor}` : 'Waiting for you'
  }
}

/** Poll row → the status it implies. Background rows report `state`; interactive rows report `status`. */
export function pollTarget(p: Record<string, unknown>): Status | null {
  if (p.kind === 'background') {
    switch (p.state) {
      case 'working':
        return 'working'
      case 'blocked':
        return 'needs_you'
      case 'done':
        return 'done'
      case 'failed':
        return 'failed'
      case 'stopped':
        return 'idle'
    }
  }
  switch (p.status) {
    case 'busy':
      return 'working'
    case 'waiting':
      return 'needs_you'
    case 'idle':
      return 'idle'
  }
  return null
}

/** Pure: (state, event) → state, plus the derived rows the event produced. */
export function reduceSession(prev: SessionState | undefined, ev: AgentEvent): Reduced {
  const out: Reduced = { session: prev ?? fresh(ev), span: null, finishedAt: null, file: null }
  // A vanished poll row says the session ended at some point since its last event, not when we noticed.
  const seen = ev.kind === 'session.gone' ? out.session.lastEventAt : ev.ts
  let s: SessionState = { ...out.session, lastEventAt: Math.max(out.session.lastEventAt, seen) }

  const setStatus = (next: Status): void => {
    if (s.status === next) return
    if (s.status === 'working' && s.workingSince !== null && ev.ts > s.workingSince) out.span = [s.workingSince, ev.ts]
    s = {
      ...s,
      status: next,
      workingSince: next === 'working' ? ev.ts : null,
      waitingSince: next === 'needs_you' ? (s.waitingSince ?? ev.ts) : null
    }
  }
  const end = (activity: string): void => {
    s = { ...s, ended: true, inflight: [], agents: [], waitingOn: null, turn: null, activity, pollPending: false }
    setStatus('idle')
  }

  if (ev.source === 'hook') {
    s = { ...s, hookAt: ev.ts, ended: ev.kind === 'session.ended' ? s.ended : false }
    if (ev.cwd && !s.cwd) s = { ...s, cwd: ev.cwd, name: s.named ? s.name : projectName(ev.cwd) }
    // Any later event of the agent we were waiting on, except a notification, means the request was answered.
    if (s.waitingOn && s.waitingOn.agentId === ev.agentId && ev.kind !== 'notification' && ev.kind !== 'permission.requested') {
      s = { ...s, waitingOn: null }
      if (s.status === 'needs_you') setStatus('working')
    }
  }

  const main = ev.agentId === null
  const p = ev.payload
  switch (ev.kind) {
    case 'session.prompt':
      s = { ...s, turn: 'prompt', activity: 'Thinking' }
      setStatus('working')
      break
    case 'session.notified':
      if (!s.turn) s = { ...s, turn: 'notified', activity: 'Thinking' }
      setStatus('working')
      break
    case 'tool.started': {
      if (ev.toolUseId && ev.toolName && !s.inflight.some((t) => t.toolUseId === ev.toolUseId)) {
        const call: Inflight = {
          toolUseId: ev.toolUseId, agentId: ev.agentId, toolName: ev.toolName, input: p.tool_input, summary: ev.summary, startedAt: ev.ts
        }
        s = { ...s, inflight: [...s.inflight, call] }
      }
      if (main) {
        s = { ...s, activity: ev.summary }
        if (s.status !== 'needs_you') setStatus('working')
      } else {
        s = { ...s, agents: s.agents.map((a) => (a.id === ev.agentId ? { ...a, activity: ev.summary } : a)) }
      }
      break
    }
    case 'tool.finished':
    case 'tool.failed': {
      s = { ...s, inflight: s.inflight.filter((t) => t.toolUseId !== ev.toolUseId) }
      const path = str(obj(p.tool_input), 'file_path') ?? str(obj(p.tool_input), 'notebook_path')
      if (ev.kind === 'tool.finished' && ev.toolName && EDIT_TOOLS.has(ev.toolName) && path) out.file = { path, tool: ev.toolName }
      break
    }
    case 'permission.requested': {
      const call = s.inflight.find((t) => t.toolUseId === ev.toolUseId)
      s = { ...s, waitingOn: { agentId: ev.agentId } }
      if (main || s.status === 'working') s = { ...s, activity: waitingText(call?.summary ?? null) }
      setStatus('needs_you')
      break
    }
    case 'turn.stopped':
      if (!main) break
      s = { ...s, inflight: s.inflight.filter((t) => t.agentId !== null) } // denied calls never get a Post (S4)
      if (p.stop_hook_active === true) break // a Stop hook made Claude carry on
      if (s.turn === 'prompt') out.finishedAt = ev.ts
      s = { ...s, turn: null, activity: 'Finished' }
      setStatus('done')
      break
    case 'turn.failed':
      if (!main) break
      s = { ...s, inflight: s.inflight.filter((t) => t.agentId !== null), turn: null, activity: `Stopped: ${str(p, 'error') ?? 'error'}` }
      setStatus('failed')
      break
    case 'subagent.started': {
      if (!ev.agentId || s.agents.some((a) => a.id === ev.agentId)) break
      const agentType = ev.agentType ?? 'Subagent'
      const linked = new Set(s.agents.map((a) => a.toolUseId))
      const call = s.inflight.find(
        (t) =>
          t.agentId === null &&
          DELEGATE_TOOLS.has(t.toolName) &&
          !linked.has(t.toolUseId) &&
          (str(obj(t.input), 'subagent_type') ?? 'general-purpose') === agentType
      )
      const task = str(obj(call?.input), 'description') ?? agentType
      s = { ...s, agents: [...s.agents, { id: ev.agentId, agentType, task, activity: 'Starting', startedAt: ev.ts, toolUseId: call?.toolUseId ?? null }] }
      break
    }
    case 'subagent.stopped':
      s = { ...s, agents: s.agents.filter((a) => a.id !== ev.agentId), inflight: s.inflight.filter((t) => t.agentId !== ev.agentId) }
      break
    case 'task.created':
    case 'task.completed': {
      const id = str(p, 'task_id')
      if (id) s = { ...s, tasks: { ...s.tasks, [id]: ev.kind === 'task.completed' } }
      break
    }
    case 'cwd.changed': {
      const cwd = str(p, 'new_cwd')
      if (cwd) s = { ...s, cwd, name: s.named ? s.name : projectName(cwd) }
      break
    }
    case 'session.ended':
      end('Ended')
      break
    case 'session.gone':
      if (!s.ended) end('Ended')
      break
    case 'session.state':
      applyPoll()
      break
  }
  out.session = s
  return out

  function applyPoll(): void {
    const name = str(p, 'name')
    const cwd = str(p, 'cwd')
    s = {
      ...s,
      name: name || s.name,
      named: s.named || Boolean(name),
      cwd: cwd ?? s.cwd,
      pid: typeof p.pid === 'number' ? p.pid : s.pid,
      bgId: p.kind === 'background' ? (str(p, 'id') ?? s.bgId) : s.bgId,
      surface: (str(p, 'surface') as Surface | null) ?? s.surface,
      startedAt: typeof p.startedAt === 'number' ? Math.min(p.startedAt, s.startedAt) : s.startedAt,
      poll: p
    }
    if (s.hookAt && ev.ts - s.hookAt < HOOK_PRECEDENCE_MS) {
      s = { ...s, pollPending: true }
      return
    }
    s = { ...s, pollPending: false }
    const target = pollTarget(p)
    if (target) s = { ...s, ended: false }
    if (target === 'working') {
      if (s.status !== 'working') s = { ...s, activity: 'Working' }
      setStatus('working')
    } else if (target === 'needs_you') {
      if (s.status !== 'needs_you') s = { ...s, activity: pollWaitingText(str(p, 'waitingFor')) }
      setStatus('needs_you')
    } else if (target === 'idle') {
      // STATE_MACHINE § 1 rule 2: the latest turn outcome beats an idle poll.
      if (s.status === 'working' || s.status === 'needs_you') {
        s = { ...s, activity: 'Idle', turn: null }
        setStatus('idle')
      }
    } else if (target === 'done' && s.status !== 'done') {
      out.finishedAt = ev.ts
      s = { ...s, activity: 'Finished', turn: null }
      setStatus('done')
    } else if (target === 'failed') {
      s = { ...s, activity: 'Failed', turn: null }
      setStatus('failed')
    }
  }
}

/**
 * A poll row the hook window held back, as an event to apply now that the window has passed (STATE_MACHINE § 1).
 * Without it, an Esc mid-turn (no Stop hook) seen by a poll inside the window would never be applied:
 * the Poller only reports rows that change.
 */
export function duePoll(s: SessionState, now: number): AgentEvent | null {
  if (!s.pollPending || !s.poll || s.ended || now - s.hookAt < HOOK_PRECEDENCE_MS) return null
  const p = s.poll
  return {
    id: ulid(now), ts: now, source: 'poll', sessionId: s.id, agentId: null, parentAgentId: null, agentType: null,
    kind: 'session.state', toolName: null, toolUseId: null, summary: `Status: ${str(p, 'state') ?? str(p, 'status') ?? 'unknown'}`,
    payload: p, cwd: str(p, 'cwd'), dedupeKey: null
  }
}

/**
 * After a restart nobody saw what a working session did while AgentDeck was down: its stretch ends at its last event,
 * and it waits for the next hook or poll to say what it is doing now (D-057).
 */
export function closeStale(s: SessionState): { session: SessionState; span: [number, number] | null } {
  if (s.status !== 'working' || s.workingSince === null) return { session: s, span: null }
  const span: [number, number] | null = s.lastEventAt > s.workingSince ? [s.workingSince, s.lastEventAt] : null
  return { session: { ...s, status: 'idle', workingSince: null, activity: 'Idle', agents: [], inflight: [] }, span }
}

/** The Home view of a session (src/shared/snapshot.ts). */
export function toSession(s: SessionState): Session {
  const ids = Object.keys(s.tasks)
  const done = ids.filter((k) => s.tasks[k]).length
  return {
    id: s.id,
    bgId: s.bgId,
    name: s.name,
    cwd: s.cwd,
    surface: s.surface,
    status: s.status,
    startedAt: s.startedAt,
    lastEventAt: s.lastEventAt,
    activity: s.activity,
    plan: ids.length ? { done, total: ids.length } : null,
    waitingSince: s.waitingSince,
    subagents: s.agents.map((a) => ({ id: a.id, agentType: a.agentType, task: a.task, activity: a.activity, startedAt: a.startedAt }))
  }
}
