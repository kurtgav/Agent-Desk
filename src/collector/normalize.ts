import { createHash } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { pathKey } from '@shared/paths'
import { ulid, type AgentEvent, type EventKind } from './events'
import { cap, capResponse, redactDeep, slimToolInput, slimToolResponse } from './redact'

/** The two fields every hook body carries (hooks § Common input fields); the rest is kept as-is. */
const HookBody = z.looseObject({ session_id: z.string().min(1), hook_event_name: z.string().min(1) })

const KINDS: Record<string, EventKind> = {
  PreToolUse: 'tool.started',
  PostToolUse: 'tool.finished',
  PostToolUseFailure: 'tool.failed',
  PermissionRequest: 'permission.requested',
  PermissionDenied: 'permission.denied',
  Notification: 'notification',
  Stop: 'turn.stopped',
  StopFailure: 'turn.failed',
  SubagentStart: 'subagent.started',
  SubagentStop: 'subagent.stopped',
  TaskCreated: 'task.created',
  TaskCompleted: 'task.completed',
  PreCompact: 'context.compacting',
  CwdChanged: 'cwd.changed',
  SessionEnd: 'session.ended',
  // Codex only (ADR-0014): Claude Code runs no HTTP hook at SessionStart and has no Interrupt event.
  SessionStart: 'session.meta',
  Interrupt: 'turn.interrupted'
}

/** Who posted the body (server.ts HookMeta): Claude Code itself, or another agent CLI through its shim. */
export interface HookOrigin {
  provider: 'claude' | 'codex'
  pid: number | null
}
const CLAUDE: HookOrigin = { provider: 'claude', pid: null }

/** Other CLIs' session ids get their name in front, so they never meet a Claude Code id (ADR-0014). */
export const sessionKey = (provider: HookOrigin['provider'], id: string): string => (provider === 'claude' ? id : `${provider}:${id}`)

const PATCH_FILE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm
const PATCH_FILES_MAX = 20
/** Codex `apply_patch` sends the whole patch, file bodies included: only the files it names and its size are kept (ADR-0009). */
function slimPatch(input: unknown): unknown {
  const text = typeof obj(input).command === 'string' ? (obj(input).command as string) : null
  if (text === null) return input
  const files = [...text.matchAll(PATCH_FILE)].map((m) => m[1]!.trim()).slice(0, PATCH_FILES_MAX)
  return { files, size: text.length }
}

/** ADR-0009: transcripts are internal; their paths are not even stored. */
const DROPPED = ['transcript_path', 'agent_transcript_path', 'scratchpad_dir']
const PROMPT_MAX = 2048
const MESSAGE_MAX = 8192
const COMMAND_MAX = 60

const str = (o: Record<string, unknown>, k: string): string | null => (typeof o[k] === 'string' ? (o[k] as string) : null)
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** Backticks delimit code spans in the UI, so they can't appear inside one. */
export const code = (s: string): string => `\`${s.replace(/`/g, "'")}\``

/** Shown relative to the session cwd when inside it (case-insensitive, D-013). */
export function displayPath(p: string, cwd: string | null): string {
  if (!cwd || !isAbsolute(p)) return p
  const abs = resolve(p)
  const base = resolve(cwd)
  if (!pathKey(abs).startsWith(`${pathKey(base)}\\`)) return p
  // The rest after the base, not path.relative: on macOS that one is case-sensitive, and would say ../Proj/… here.
  return abs.slice(base.replace(/[\\/]+$/, '').length + 1)
}

/** docs/EVENT_SCHEMA.md § Activity text. `input` is already redacted. */
export function activityText(toolName: string, input: Record<string, unknown>, cwd: string | null): string {
  const path = str(input, 'file_path') ?? str(input, 'notebook_path')
  switch (toolName) {
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
    case 'MultiEdit':
      return path ? `Editing ${code(displayPath(path, cwd))}` : 'Editing a file'
    case 'Read':
      return path ? `Reading ${code(displayPath(path, cwd))}` : 'Reading a file'
    case 'Bash':
    case 'PowerShell': {
      const cmd = str(input, 'command')
      return cmd ? `Running ${code(cap(cmd.replace(/\s+/g, ' ').trim(), COMMAND_MAX))}` : 'Running a command'
    }
    case 'Grep':
      return `Searching "${cap(str(input, 'pattern') ?? '', COMMAND_MAX)}"`
    case 'Glob':
      return `Finding files ${code(cap(str(input, 'pattern') ?? '*', COMMAND_MAX))}`
    case 'Agent':
    case 'Task':
      return `Delegating to ${str(input, 'subagent_type') ?? 'a subagent'}`
    case 'WebFetch': {
      const url = str(input, 'url')
      let host = url ?? 'a page'
      try {
        if (url) host = new URL(url).host
      } catch {
        // not a URL: show it as given
      }
      return `Fetching ${host}`
    }
    case 'WebSearch':
      return `Searching the web for "${cap(str(input, 'query') ?? '', COMMAND_MAX)}"`
    case 'AskUserQuestion': {
      const first = Array.isArray(input.questions) ? str(obj(input.questions[0]), 'question') : null
      return first ? `Asking you: ${first}` : 'Asking you a question'
    }
    case 'ExitPlanMode':
      return 'Plan ready for your review'
    case 'TaskCreate':
    case 'TaskUpdate':
      return 'Updating the plan'
    case 'apply_patch': {
      const files = Array.isArray(input.files) ? input.files.filter((f): f is string => typeof f === 'string') : []
      if (files.length === 1) return `Editing ${code(displayPath(files[0]!, cwd))}`
      return files.length ? `Editing ${files.length} files` : 'Editing files'
    }
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(toolName)
  return mcp ? `Using ${mcp[1]} · ${mcp[2]}` : `Using ${toolName}`
}

function summaryOf(kind: EventKind, p: Record<string, unknown>, toolName: string | null, cwd: string | null): string {
  const tool = toolName ?? 'a tool'
  switch (kind) {
    case 'session.prompt':
      return 'You sent a prompt'
    case 'session.notified':
      return 'A background task reported back'
    case 'tool.started':
      return activityText(tool, obj(p.tool_input), cwd)
    case 'tool.finished':
      return `Finished ${tool}`
    case 'tool.failed':
      return `${tool} failed`
    case 'permission.requested':
      return `Asked to use ${tool}`
    case 'permission.denied':
      return `${tool} was denied`
    case 'notification':
      return str(p, 'message') ?? 'Notification'
    case 'turn.stopped':
      return 'Finished the turn'
    case 'turn.failed':
      return `Stopped: ${str(p, 'error') ?? 'error'}`
    case 'subagent.started':
      return `Started ${str(p, 'agent_type') ?? 'a subagent'}`
    case 'subagent.stopped':
      return `${str(p, 'agent_type') ?? 'Subagent'} finished`
    case 'task.created':
      return `Planned: ${str(p, 'task_subject') ?? 'a task'}`
    case 'task.completed':
      return `Done: ${str(p, 'task_subject') ?? 'a task'}`
    case 'context.compacting':
      return 'Compacting the conversation'
    case 'cwd.changed':
      return `Moved to ${str(p, 'new_cwd') ?? 'another folder'}`
    case 'session.ended':
      return 'Session ended'
    case 'turn.interrupted':
      return 'Interrupted'
    case 'session.meta':
      return 'Session started'
    default:
      return str(p, 'hook_event_name') ?? 'Unknown event'
  }
}

/**
 * Drops transcript paths and file bodies, masks secrets everywhere, then caps text.
 * Masking comes before the caps, so a cut can never split a secret before it is found.
 */
function payloadOf(body: Record<string, unknown>, toolName: string | null): Record<string, unknown> {
  const p: Record<string, unknown> = { ...body }
  for (const k of DROPPED) delete p[k]
  if ('tool_input' in p) p.tool_input = toolName === 'apply_patch' ? slimPatch(p.tool_input) : slimToolInput(p.tool_input)
  if ('tool_response' in p) p.tool_response = slimToolResponse(toolName, p.tool_response)
  const r = redactDeep(p) as Record<string, unknown>
  return {
    ...r,
    ...('tool_response' in r && { tool_response: capResponse(r.tool_response) }),
    ...(typeof r.prompt === 'string' && { prompt: cap(r.prompt, PROMPT_MAX) }),
    ...(typeof r.last_assistant_message === 'string' && { last_assistant_message: cap(r.last_assistant_message, MESSAGE_MAX) })
  }
}

/**
 * One hook body → one AgentEvent; null when it isn't a hook body at all (dropped, never stored). Codex sends Claude Code's
 * field names (ADR-0014), so one parser reads both; `origin` says whose it is, and the pid its shim saw at session start.
 */
export function normalizeHook(raw: string, ts: number, origin: HookOrigin = CLAUDE): AgentEvent | null {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = HookBody.safeParse(json)
  if (!parsed.success) return null
  const body = parsed.data as Record<string, unknown>
  const event = parsed.data.hook_event_name
  const prompt = str(body, 'prompt')
  const kind: EventKind =
    event === 'UserPromptSubmit'
      ? prompt?.startsWith('<task-notification>')
        ? 'session.notified'
        : 'session.prompt'
      : Object.hasOwn(KINDS, event)
        ? KINDS[event]!
        : 'unknown' // own keys only: "constructor" or "__proto__" must not reach Object.prototype
  const toolName = str(body, 'tool_name')
  const cwd = str(body, 'cwd')
  const payload = { ...payloadOf(body, toolName), ...(origin.pid !== null && { agentdeck_pid: origin.pid }) }
  return {
    id: ulid(ts),
    ts,
    source: 'hook',
    sessionId: sessionKey(origin.provider, parsed.data.session_id),
    agentId: str(body, 'agent_id'),
    parentAgentId: null, // hooks don't expose nesting depth
    agentType: str(body, 'agent_type'),
    kind,
    toolName,
    toolUseId: str(body, 'tool_use_id'),
    summary: cap(summaryOf(kind, payload, toolName, cwd), 199),
    payload,
    cwd,
    dedupeKey: createHash('sha256').update(raw).digest('hex')
  }
}
