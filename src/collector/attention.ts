import type { AttentionItem, AttentionKind } from '@shared/snapshot'
import { pathKey } from '@shared/paths'
import { resolve } from 'node:path'
import { ulid, type AgentEvent } from './events'
import { code, displayPath } from './normalize'
import { cap } from './redact'
import type { SessionState } from './reduce'

/**
 * The attention engine (ADR-0013, STATE_MACHINE § 3): the only producer of "needs you" items. Pure:
 * (state, event, session before and after the reducer) → state, plus the items it opened and closed.
 */

export type ResolvedBy = 'hook' | 'poll' | 'agentdeck' | 'user-dismiss' | 'session-ended' | 'superseded'

export interface AttentionRecord extends AttentionItem {
  /** STATE_MACHINE § 3 item key: at most one open item per key. */
  key: string
  agentId: string | null
  toolUseId: string | null
  source: 'hook' | 'poll' | 'tick'
  /**
   * A poll row has shown the session waiting since the item opened, so a later row that isn't waiting is an answer.
   * Without it, a poll that lags behind the hook would close a fresh item at once.
   */
  pollSaw: boolean
}

export interface Closed {
  item: AttentionRecord
  at: number
  by: ResolvedBy
  state: 'resolved' | 'dismissed' | 'superseded'
}

export interface AttentionState {
  open: AttentionRecord[]
  /** key → time before which it must not open again (a dismissed P3 snoozes 2N; a dismissed P2/P4 waits for the next prompt). */
  quiet: Record<string, number>
}

export interface Attended {
  state: AttentionState
  opened: AttentionRecord[]
  closed: Closed[]
}

export interface StallConfig {
  /** N: working with no events and nothing in flight. */
  idleMs: number
  /** M: one tool call running. */
  toolMs: number
}

export const DEFAULT_STALL: StallConfig = { idleMs: 5 * 60_000, toolMs: 10 * 60_000 }
/** ARCHITECTURE § 3: the 1 s poll runs for up to 2 min per P1 item. */
export const FAST_POLL_MS = 2 * 60_000

const UNTIL_PROMPT = Number.MAX_SAFE_INTEGER
const TITLE_MAX = 1_000
const REVIEW_TITLE_MAX = 160

export const emptyAttention = (): AttentionState => ({ open: [], quiet: {} })

const str = (o: Record<string, unknown>, k: string): string | null => (typeof o[k] === 'string' ? (o[k] as string) : null)
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

// ── Risk flags (STATE_MACHINE § 5): display only, they never block anything ──

const RISKS: [string, RegExp][] = [
  ['Recursive delete', /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r|\brm\s+-r\s+-f|Remove-Item\b[^\n]*-Recurse|\brd\s+\/s|\brmdir\s+\/s/i],
  ['Force push', /git\s+push\b[^\n]*(--force\b|--force-with-lease|\s-f\b)/i],
  ['Hard reset', /git\s+reset\b[^\n]*--hard/i],
  ['Destructive SQL', /\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE\b)/i],
  ['DB reset/push', /prisma\s+migrate\s+reset|supabase\s+db\s+(reset|push)/i],
  ['Deploy / publish', /vercel\b[^\n]*--prod|railway\s+up\b|npm\s+publish\b/i],
  ['.env access', /(^|[\\/\s"'=])\.env(\.[\w-]+)?\b/i],
  ['Pipe to shell', /(curl|wget|iwr|Invoke-WebRequest)\b[^\n|]*\|\s*(sh|bash|zsh|iex|Invoke-Expression)\b/i]
]
const FILE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

export function riskFlags(toolName: string | null, input: Record<string, unknown>, cwd: string): string[] {
  const path = str(input, 'file_path') ?? str(input, 'notebook_path') ?? str(input, 'path')
  const texts = [str(input, 'command'), path, str(input, 'url')].filter((t): t is string => t !== null)
  const flags = RISKS.filter(([, re]) => texts.some((t) => re.test(t))).map(([name]) => name)
  if (toolName && FILE_TOOLS.has(toolName) && path && cwd && !inside(path, cwd)) flags.push('Outside workspace')
  return flags
}

function inside(path: string, cwd: string): boolean {
  const base = pathKey(resolve(cwd))
  const p = pathKey(resolve(cwd, path))
  return p === base || p.startsWith(`${base}\\`)
}

// ── Titles: the exact tool, command, file or question (UI_MAP § Main column) ──

export function approvalTitle(toolName: string | null, input: Record<string, unknown>, cwd: string | null): string {
  const path = str(input, 'file_path') ?? str(input, 'notebook_path')
  switch (toolName) {
    case 'Bash':
    case 'PowerShell': {
      const cmd = str(input, 'command')
      return cmd ? `Run ${code(cap(cmd.trim(), TITLE_MAX))}` : `Run a ${toolName} command`
    }
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return path ? `Edit ${code(displayPath(path, cwd))}` : 'Edit a file'
    case 'Write':
      return path ? `Write ${code(displayPath(path, cwd))}` : 'Write a file'
    case 'Read':
      return path ? `Read ${code(displayPath(path, cwd))}` : 'Read a file'
    case 'WebFetch': {
      const url = str(input, 'url')
      return url ? `Fetch ${code(cap(url, TITLE_MAX))}` : 'Fetch a web page'
    }
    case 'WebSearch':
      return `Search the web for "${cap(str(input, 'query') ?? '', TITLE_MAX)}"`
    case 'Agent':
    case 'Task':
      return `Delegate to ${str(input, 'subagent_type') ?? 'a subagent'}`
    case null:
      return 'Use a tool'
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(toolName)
  return mcp ? `Use ${mcp[1]} · ${mcp[2]}` : `Use ${toolName}`
}

const strip = (line: string): string => line.replace(/^\s*(#+|>|[-*+]|\d+[.)])\s*/, '').replace(/[*_`]+$/g, '').trim()

function lines(message: string): string[] {
  return message.split(/\r?\n/).map(strip).filter(Boolean)
}

/** STATE_MACHINE § 4 "Asked you a question", deterministic (no LLM). */
export function askedQuestion(message: string): boolean {
  const all = lines(message)
  const last = all[all.length - 1]
  if (!last) return false
  if (last.endsWith('?')) return true
  const tail = all.slice(-3).join('\n')
  return /\b(Do you want|Should I|Would you like)\b/i.test(tail) || /\bWhich\b[^?]*\?/i.test(tail)
}

/** STATE_MACHINE § 4 StopFailure fix hints. */
const FAILURES: Record<string, [string, string | null]> = {
  rate_limit: ['rate limit reached', 'Rate limited. It resumes when your limit resets; run `/usage` in the session.'],
  overloaded: ['Anthropic API overloaded', 'Anthropic API busy. Retry the turn.'],
  server_error: ['API server error', 'Anthropic API busy. Retry the turn.'],
  authentication_failed: ['sign-in failed', 'Sign in again: run `claude auth login`.'],
  oauth_org_not_allowed: ['organization not allowed', 'Sign in again: run `claude auth login`.'],
  billing_error: ['billing problem', 'Check your plan and billing at claude.ai settings.'],
  account_on_hold: ['account on hold', 'Check your plan and billing at claude.ai settings.'],
  model_not_found: ['model not found', 'Model unavailable. Pick another with `/model`.'],
  max_output_tokens: ['output limit reached', 'Response hit the output limit. Ask it to continue.'],
  invalid_request: ['invalid request', null],
  cloud_credential_error: ['cloud credentials error', null]
}

function failure(p: Record<string, unknown>): { title: string; hint: string | null } {
  const error = str(p, 'error') ?? 'unknown'
  const known = FAILURES[error]
  const details = str(p, 'error_details')
  return {
    title: `Stopped: ${known?.[0] ?? error.replace(/_/g, ' ')}`,
    hint: known?.[1] ?? (details ? cap(details, 200) : null)
  }
}

// ── Poll rows (agent-view § List sessions as JSON) ──

type Wait = 'approval' | 'question' | 'other'

/** What a `claude agents` row says the session waits for; null when it isn't waiting. */
export function pollWait(p: Record<string, unknown>): Wait | null {
  const waitingFor = str(p, 'waitingFor')
  if (waitingFor === 'permission prompt' || waitingFor === 'sandbox request') return 'approval'
  if (waitingFor === 'input needed' || waitingFor === 'dialog open' || waitingFor === 'worker request') return 'question'
  return p.status === 'waiting' || p.state === 'blocked' ? 'other' : null
}

const POLL_TITLES: Record<string, string> = {
  'permission prompt': 'Answer a permission prompt',
  'sandbox request': 'Answer a sandbox request',
  'input needed': 'Answer a question',
  'dialog open': 'A dialog is waiting for you',
  'worker request': 'Answer a worker request'
}
const NO_DETAILS = 'No details: this session sends AgentDeck no hook events (hooks not installed, or the folder is not trusted).'

// ── The reducer ──

export function attend(state: AttentionState, ev: AgentEvent, session: SessionState, now = ev.ts): Attended {
  let open = state.open
  let quiet = state.quiet
  const opened: AttentionRecord[] = []
  const closed: Closed[] = []
  const sid = ev.sessionId
  const p = ev.payload

  const close = (match: (i: AttentionRecord) => boolean, by: ResolvedBy, as: Closed['state'] = 'resolved'): void => {
    const hit = open.filter((i) => i.sessionId === sid && match(i))
    if (!hit.length) return
    open = open.filter((i) => !hit.includes(i))
    closed.push(...hit.map((item) => ({ item, at: now, by, state: as })))
  }
  const add = (
    r: Pick<AttentionRecord, 'key' | 'priority' | 'kind' | 'title'> & Partial<AttentionRecord>,
    source: AttentionRecord['source']
  ): void => {
    if (open.some((i) => i.key === r.key) || (quiet[r.key] ?? 0) > now) return
    const item: AttentionRecord = {
      id: ulid(now), sessionId: sid, toolName: null, hint: null, riskFlags: [], held: false, openedAt: now,
      agentId: null, toolUseId: null, pollSaw: source === 'poll', source, ...r
    }
    open = [...open, item]
    opened.push(item)
  }
  const agentKey = (suffix: string, agentId = ev.agentId): string => `${sid}|${agentId ?? 'main'}|${suffix}`
  // A hook item that replaces a poll item inherits what the poll saw: an unchanged poll row sends no new event,
  // so without this the poll could never close it (M3 code review).
  const supersede = (): boolean => {
    const polled = open.some((i) => i.sessionId === sid && i.priority === 1 && i.source === 'poll')
    close((i) => i.priority === 1 && i.source === 'poll', 'superseded', 'superseded')
    return polled
  }
  const hasP1 = (agentId?: string | null): boolean =>
    open.some((i) => i.sessionId === sid && i.priority === 1 && (agentId === undefined || i.agentId === agentId))

  // 1. Resolutions: an answer anywhere closes the item (STATE_MACHINE § 3 "Resolves when").
  // Idle-stuck closes on any next event; tool-stuck only once its tool is done, or another agent's event would
  // close it and the next tick reopen it under a new id (M3 code review).
  const unstuck = (i: AttentionRecord): boolean => i.kind === 'stuck' && !session.inflight.some((t) => t.toolUseId === i.toolUseId)
  if (ev.source === 'hook') {
    close(unstuck, 'hook')
    if (ev.kind !== 'notification') {
      // Any later event of the same agent means its prompt was answered (S4); a Post of the same call says how.
      close((i) => i.priority === 1 && i.source !== 'poll' && i.agentId === ev.agentId, 'hook')
    }
    if (ev.toolUseId && (ev.kind === 'tool.finished' || ev.kind === 'tool.failed')) close((i) => i.toolUseId === ev.toolUseId, 'hook')
  }
  if (ev.kind === 'session.prompt') {
    close(() => true, 'hook')
    quiet = Object.fromEntries(Object.entries(quiet).filter(([k]) => !k.startsWith(`${sid}|`)))
  }
  if (ev.kind === 'session.gone') close(() => true, 'session-ended')
  if (ev.kind === 'session.ended') {
    // A `-p` or SDK run ends with reason "other" right after its last turn: its result is still worth reviewing.
    const keepReview = str(p, 'reason') === 'other'
    close((i) => !(keepReview && i.kind === 'review'), 'session-ended')
  }
  if (ev.kind === 'session.state') {
    close(unstuck, 'poll')
    const wait = pollWait(p)
    // Mark the waits the poll has seen, then close the ones it no longer shows.
    open = open.map((i) => (i.sessionId === sid && i.priority === 1 && matches(i.kind, wait) ? { ...i, pollSaw: true } : i))
    close((i) => i.priority === 1 && i.pollSaw && !matches(i.kind, wait), 'poll')
    if (session.status === 'working') close((i) => i.kind === 'failed', 'poll')
  }

  // 2. Openings.
  const main = ev.agentId === null
  switch (ev.kind) {
    case 'permission.requested': {
      const input = obj(p.tool_input)
      const pollSaw = supersede()
      add({
        key: agentKey(ev.toolUseId ?? 'permission'), priority: 1, kind: 'approval', agentId: ev.agentId, toolUseId: ev.toolUseId,
        toolName: ev.toolName, title: approvalTitle(ev.toolName, input, session.cwd), riskFlags: riskFlags(ev.toolName, input, session.cwd), pollSaw
      }, 'hook')
      break
    }
    case 'tool.started': {
      const input = obj(p.tool_input)
      if (ev.toolName === 'AskUserQuestion') {
        const first = Array.isArray(input.questions) ? str(obj(input.questions[0]), 'question') : null
        const pollSaw = supersede()
        add({ key: agentKey('answer'), priority: 1, kind: 'question', agentId: ev.agentId, toolUseId: ev.toolUseId, toolName: ev.toolName, title: cap(first ?? 'Answer a question', TITLE_MAX), pollSaw }, 'hook')
      } else if (ev.toolName === 'ExitPlanMode') {
        add({ key: agentKey('answer'), priority: 1, kind: 'question', agentId: ev.agentId, toolUseId: ev.toolUseId, toolName: ev.toolName, title: 'Plan ready to approve' }, 'hook')
      }
      break
    }
    case 'notification': {
      const type = str(p, 'notification_type') ?? ''
      const message = cap(str(p, 'message') ?? '', TITLE_MAX)
      if (type === 'permission_prompt') {
        // Enriches an existing approval, never duplicates it.
        if (!hasP1(ev.agentId)) add({ key: agentKey('permission'), priority: 1, kind: 'approval', agentId: ev.agentId, title: message || 'Answer a permission prompt' }, 'hook')
      } else if (type === 'elicitation_dialog' || type === 'elicitation_url_dialog' || type === 'agent_needs_input') {
        if (!hasP1(ev.agentId)) add({ key: agentKey('answer'), priority: 1, kind: 'question', agentId: ev.agentId, title: message || 'Answer a question' }, 'hook')
      } else if (type === 'idle_prompt' || type === 'agent_completed') {
        add({ key: `${sid}|review`, priority: 4, kind: 'review', title: message || 'Waiting for your next prompt' }, 'hook')
      } else if (type.startsWith('quota_auto_resume')) {
        add({ key: `${sid}|failed`, priority: 2, kind: 'failed', title: message || 'Usage limit reached', hint: 'It resumes on its own when your limit resets.' }, 'hook')
      }
      break
    }
    case 'turn.stopped':
      if (main && p.stop_hook_active !== true) {
        const message = str(p, 'last_assistant_message') ?? ''
        add({
          key: `${sid}|review`, priority: 4, kind: 'review',
          title: cap(lines(message)[0] ?? 'Finished', REVIEW_TITLE_MAX), asked: askedQuestion(message)
        }, 'hook')
      }
      break
    case 'turn.failed':
      if (main) add({ key: `${sid}|failed`, priority: 2, kind: 'failed', ...failure(p) }, 'hook')
      break
    case 'session.state': {
      const waitingFor = str(p, 'waitingFor')
      const wait = pollWait(p)
      if ((wait === 'approval' || wait === 'question') && !hasP1()) {
        add({ key: `${sid}|main|poll`, priority: 1, kind: wait, title: POLL_TITLES[waitingFor ?? ''] ?? 'Waiting for you', hint: NO_DETAILS }, 'poll')
      } else if (p.kind === 'background' && p.state === 'failed') {
        add({ key: `${sid}|failed`, priority: 2, kind: 'failed', title: 'Background session failed' }, 'poll')
      } else if (p.kind === 'background' && p.state === 'done') {
        add({ key: `${sid}|review`, priority: 4, kind: 'review', title: 'Background session finished' }, 'poll')
      }
      break
    }
  }
  return { state: { open, quiet }, opened, closed }
}

function matches(kind: AttentionKind, wait: Wait | null): boolean {
  if (wait === null) return false
  return kind === 'approval' ? wait === 'approval' : wait !== 'approval'
}

/** P3 "Possibly stuck", from a timer (STATE_MACHINE: time rules run on a tick so tests can drive the clock). */
export function stall(state: AttentionState, sessions: Iterable<SessionState>, now: number, cfg: StallConfig = DEFAULT_STALL): Attended {
  let open = state.open
  const opened: AttentionRecord[] = []
  for (const s of sessions) {
    if (s.ended || s.status !== 'working') continue
    const candidates: { key: string; agentId: string | null; toolUseId: string | null; title: string; hint: string }[] = []
    const long = s.inflight.find((t) => t.startedAt !== undefined && now - t.startedAt > cfg.toolMs)
    if (long) {
      candidates.push({ key: `${s.id}|${long.agentId ?? 'main'}|stuck`, agentId: long.agentId, toolUseId: long.toolUseId, title: `Possibly stuck: ${long.summary}`, hint: `This tool has run for over ${minutes(cfg.toolMs)}.` })
    } else if (!s.inflight.length && !s.agents.length && now - s.lastEventAt > cfg.idleMs) {
      candidates.push({ key: `${s.id}|main|stuck`, agentId: null, toolUseId: null, title: `Possibly stuck: ${s.activity}`, hint: `No activity for over ${minutes(cfg.idleMs)}.` })
    }
    for (const c of candidates) {
      if (open.some((i) => i.key === c.key) || (state.quiet[c.key] ?? 0) > now) continue
      const item: AttentionRecord = {
        id: ulid(now), key: c.key, priority: 3, kind: 'stuck', sessionId: s.id, title: c.title, toolName: null, hint: c.hint,
        riskFlags: [], held: false, openedAt: now, agentId: c.agentId, toolUseId: c.toolUseId, source: 'tick', pollSaw: false
      }
      open = [...open, item]
      opened.push(item)
    }
  }
  return { state: { ...state, open }, opened, closed: [] }
}

const minutes = (ms: number): string => `${Math.round(ms / 60_000)} min`

/** User Dismiss (P2–P4). A dismissed P3 snoozes for 2N; P2 and P4 stay quiet until the session's next prompt. */
export function dismiss(state: AttentionState, id: string, now: number, cfg: StallConfig = DEFAULT_STALL): Attended {
  const item = state.open.find((i) => i.id === id)
  if (!item || item.priority === 1) return { state, opened: [], closed: [] }
  const until = item.kind === 'stuck' ? now + 2 * cfg.idleMs : UNTIL_PROMPT
  return {
    state: { open: state.open.filter((i) => i !== item), quiet: { ...state.quiet, [item.key]: until } },
    opened: [],
    closed: [{ item, at: now, by: 'user-dismiss', state: 'dismissed' }]
  }
}

/** A held approval answered in AgentDeck (ADR-0006): it closes at once, resolved by 'agentdeck'. */
export function answer(state: AttentionState, id: string, now: number): Attended {
  const item = state.open.find((i) => i.id === id)
  if (!item?.held) return { state, opened: [], closed: [] }
  return { state: { ...state, open: state.open.filter((i) => i !== item) }, opened: [], closed: [{ item, at: now, by: 'agentdeck', state: 'resolved' }] }
}

/** The 1 s poll runs while a P1 item younger than 2 min is open; 0 = no fast poll. */
export function fastPollUntil(state: AttentionState): number {
  return state.open.reduce((t, i) => (i.priority === 1 ? Math.max(t, i.openedAt + FAST_POLL_MS) : t), 0)
}

export function toItem(r: AttentionRecord): AttentionItem {
  const { id, priority, kind, sessionId, title, toolName, hint, riskFlags, held, openedAt, asked } = r
  return { id, priority, kind, sessionId, title, toolName, hint, riskFlags, held, openedAt, ...(asked !== undefined && { asked }) }
}
