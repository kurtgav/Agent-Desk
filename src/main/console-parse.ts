import type { CommandInfo, ConsoleBody, ConsoleCapabilities, ConsoleProblem } from '@shared/console'
import { cap, redactDeep } from '../collector/redact'
import { capabilitiesFromInit, describedCommands, withDescriptions } from './console-caps'
import { allowRuleFor, arr, classify, isRec, maskText, num, oneLine, rec, str, summarizeTool } from './console-text'

/**
 * `claude -p --output-format stream-json --verbose --include-partial-messages` (2.1.323), one JSON object per line:
 * `system/init`, `stream_event` (the Messages API's message_start, content_block_*, message_*), one `assistant` per finished
 * content block, `user` with the tool results, `rate_limit_event`, and a `result` that closes each turn. Unknown types and
 * fields are ignored: this is read, never trusted, and never throws (ADR-0009: the child's stdout is the only source).
 */

/** A tool result or input shown in the page is a few KB; the rest stays in the terminal's world. */
export const RESULT_MAX = 4_096
export const INPUT_MAX = 6_000

const SUBTYPE_TEXT: Record<string, string> = {
  error_max_turns: 'Claude reached its limit of steps for one request.',
  error_max_budget_usd: 'Claude reached the spending limit set for this run.',
  error_during_execution: 'Claude Code hit an error while working on this.'
}

export interface Init {
  sessionId: string
  model: string | null
  /** Protocol behaviours this Claude Code advertises (`interrupt_cancel_queued_v1`, …), not what it can use. */
  protocol: string[]
}

export interface Mapped {
  drafts: ConsoleBody[]
  init?: Init
  /** A turn ended (the `result` line): the hub stops counting it as running. */
  turnEnded?: boolean
  problem?: ConsoleProblem
  /** The answer to a control request we sent (the interrupt, a live allow). */
  control?: { requestId: string; ok: boolean }
}

const NOTHING: Mapped = { drafts: [] }

interface Slot {
  key: string
  type: 'text' | 'thinking'
  text: string
  /** A final event was sent for it. */
  done: boolean
  /** An `assistant` message has claimed it. */
  matched: boolean
}

/** Turns stream-json lines into ConsoleBody drafts. One per conversation: it remembers the message in flight and the cost so far. */
export class StreamMapper {
  /** Lines that were not a JSON object with a type. */
  skipped = 0
  private msgId = ''
  private synth = 0
  private readonly slots = new Map<string, Slot>()
  private readonly tools = new Set<string>()
  private readonly denied = new Set<string>()
  private prevTotal: number | null
  private caps: ConsoleCapabilities | null = null
  private described: CommandInfo[] | null = null

  /** `resumed`: Claude Code reports a resumed session's whole total, so the first turn's own share is unknown. */
  constructor(private readonly cwd: string, resumed: boolean) {
    this.prevTotal = resumed ? null : 0
  }

  map(line: string): Mapped {
    let m: unknown
    try {
      m = JSON.parse(line)
    } catch {
      this.skipped++
      return NOTHING
    }
    if (!isRec(m) || typeof m.type !== 'string') {
      this.skipped++
      return NOTHING
    }
    // Subagents' own steps carry the id of the tool call that started them; the card of that call stands for them.
    if (m.parent_tool_use_id != null && m.type !== 'result') return NOTHING
    switch (m.type) {
      case 'system':
        return this.system(m)
      case 'stream_event':
        return this.streamEvent(m)
      case 'assistant':
        return this.assistant(m)
      case 'user':
        return this.user(m)
      case 'result':
        return this.result(m)
      case 'control_response': {
        const r = rec(m.response)
        return str(r.request_id) ? { drafts: [], control: { requestId: str(r.request_id), ok: r.subtype === 'success' } } : NOTHING
      }
      case 'conversation_reset':
        // /clear: Claude Code starts a fresh conversation (a new session id follows in the next init).
        return { drafts: [{ kind: 'notice', level: 'info', text: 'Conversation cleared. Claude no longer remembers what was said before this point.' }] }
      case 'rate_limit_event':
        return rec(m.rate_limit_info).status === 'rejected'
          ? { drafts: [{ kind: 'notice', level: 'warn', text: 'Claude Code says the usage limit is reached for now. It resets later; try again then.' }] }
          : NOTHING
      default:
        return NOTHING
    }
  }

  private system(m: Record<string, unknown>): Mapped {
    switch (m.subtype) {
      case 'init': {
        const sessionId = str(m.session_id)
        if (!sessionId) return NOTHING
        this.caps = capabilitiesFromInit(m, this.described)
        return {
          drafts: [{ kind: 'capabilities', capabilities: this.caps }],
          init: { sessionId, model: str(m.model) || null, protocol: arr(m.capabilities).filter((c): c is string => typeof c === 'string') }
        }
      }
      case 'commands_changed': {
        // Sent after init with the descriptions; the list can also grow (a skill added while running).
        const described = describedCommands(m)
        if (!described) return NOTHING
        this.described = described
        if (!this.caps) return NOTHING
        this.caps = withDescriptions(this.caps, described)
        return { drafts: [{ kind: 'capabilities', capabilities: this.caps }] }
      }
      case 'api_retry': {
        const n = num(m.attempt)
        const max = num(m.max_retries)
        const why = RETRY_TEXT[str(m.error)] ?? 'a temporary problem'
        return { drafts: [{ kind: 'notice', level: 'info', text: `Claude is trying again after ${why}${n && max ? ` (attempt ${n} of ${max})` : ''}.` }] }
      }
      case 'permission_denied': {
        const id = str(m.tool_use_id)
        if (!id || this.denied.has(id)) return NOTHING
        this.denied.add(id)
        const name = str(m.tool_name) || 'A tool'
        return { drafts: [{ kind: 'permission-denied', toolUseId: id, name, summary: name, rule: allowRuleFor(name, undefined) }] }
      }
      default:
        return NOTHING
    }
  }

  private slot(key: string, type: Slot['type']): Slot {
    let s = this.slots.get(key)
    if (!s) {
      s = { key, type, text: '', done: false, matched: false }
      this.slots.set(key, s)
    }
    return s
  }

  private streamEvent(m: Record<string, unknown>): Mapped {
    const ev = rec(m.event)
    if (ev.type === 'message_start') {
      this.msgId = str(rec(ev.message).id) || str(m.api_message_id) || this.msgId
      if (this.slots.size > 32) this.slots.clear()
      return NOTHING
    }
    const msg = this.msgId || str(m.api_message_id) || 'm'
    const key = `${msg}:${num(ev.index) ?? 0}`
    if (ev.type === 'content_block_start') {
      const t = str(rec(ev.content_block).type)
      if (t === 'text' || t === 'thinking') this.slot(key, t)
      return NOTHING
    }
    if (ev.type === 'content_block_delta') {
      const d = rec(ev.delta)
      const type = d.type === 'text_delta' ? 'text' : d.type === 'thinking_delta' ? 'thinking' : null
      if (!type) return NOTHING
      const s = this.slot(key, type)
      if (s.done) return NOTHING
      s.text += str(type === 'text' ? d.text : d.thinking)
      return { drafts: [this.draft(s, false)] }
    }
    if (ev.type === 'content_block_stop') {
      const s = this.slots.get(key)
      if (!s || s.done || !s.text) return NOTHING
      s.done = true
      return { drafts: [this.draft(s, true)] }
    }
    return NOTHING
  }

  private draft(s: Slot, final: boolean): ConsoleBody {
    return s.type === 'text' ? { kind: 'assistant-text', messageId: s.key, text: s.text, final } : { kind: 'thinking', messageId: s.key, text: s.text, final }
  }

  /** The `assistant` line of a finished block: it repeats what streamed, so it settles the text; tool calls only exist here. */
  private assistant(m: Record<string, unknown>): Mapped {
    const message = rec(m.message)
    const msg = str(message.id) || this.msgId || 'm'
    const drafts: ConsoleBody[] = []
    const content = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : arr(message.content)
    for (const raw of content) {
      const b = rec(raw)
      if (b.type === 'text' || b.type === 'thinking') {
        const text = str(b.type === 'text' ? b.text : b.thinking)
        const type = b.type
        const s = this.claim(msg, type)
        s.text = text || s.text
        s.done = true
        if (s.text) drafts.push(this.draft(s, true))
      } else if (b.type === 'tool_use') {
        const id = str(b.id)
        if (!id || this.tools.has(id)) continue
        this.tools.add(id)
        const name = str(b.name) || 'Tool'
        drafts.push({ kind: 'tool-use', toolUseId: id, name, summary: summarizeTool(name, b.input, this.cwd), input: showInput(b.input) })
      }
    }
    return drafts.length ? { drafts } : NOTHING
  }

  /** The streamed block this `assistant` content settles (the first of its type not yet claimed), or a new one when nothing streamed. */
  private claim(msg: string, type: Slot['type']): Slot {
    for (const s of this.slots.values()) {
      if (!s.matched && s.type === type && s.key.startsWith(`${msg}:`)) {
        s.matched = true
        return s
      }
    }
    const s = this.slot(`${msg}:a${this.synth++}`, type)
    s.matched = true
    return s
  }

  private user(m: Record<string, unknown>): Mapped {
    const content = arr(rec(m.message).content)
    const drafts: ConsoleBody[] = []
    for (const raw of content) {
      const b = rec(raw)
      if (b.type !== 'tool_result') continue
      const id = str(b.tool_use_id)
      if (!id) continue
      const shown = cap(maskText(flatten(b.content)), RESULT_MAX + 1)
      drafts.push({ kind: 'tool-result', toolUseId: id, ok: b.is_error !== true, text: shown.slice(0, RESULT_MAX), truncated: shown.length > RESULT_MAX })
    }
    return drafts.length ? { drafts } : NOTHING
  }

  private result(m: Record<string, unknown>): Mapped {
    const drafts: ConsoleBody[] = []
    for (const raw of arr(m.permission_denials)) {
      const d = rec(raw)
      const id = str(d.tool_use_id)
      if (!id || this.denied.has(id)) continue
      this.denied.add(id)
      const name = str(d.tool_name) || 'A tool'
      drafts.push({ kind: 'permission-denied', toolUseId: id, name, summary: summarizeTool(name, d.tool_input, this.cwd), rule: allowRuleFor(name, d.tool_input) })
    }
    const failed = m.is_error === true || (typeof m.subtype === 'string' && m.subtype !== 'success')
    const said = str(m.result).trim() || arr(m.errors).map(String).join(' ').trim()
    const error = failed ? SUBTYPE_TEXT[str(m.subtype)] ?? (said ? oneLine(said, 400) : 'Claude Code stopped this turn.') : null
    const usage = rec(m.usage)
    const read = [usage.input_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens].map(num)
    const total = num(m.total_cost_usd)
    const cost = total === null || this.prevTotal === null ? null : Math.max(0, total - this.prevTotal)
    if (total !== null) this.prevTotal = total
    drafts.push({
      kind: 'turn-end',
      costUsd: cost,
      totalCostUsd: total,
      inputTokens: read.every((n) => n === null) ? null : read.reduce<number>((a, n) => a + (n ?? 0), 0),
      outputTokens: num(usage.output_tokens),
      durationMs: num(m.duration_ms),
      interrupted: false,
      error
    })
    const problem = failed ? classify(`${said}\n${error ?? ''}`) : null
    return problem ? { drafts, turnEnded: true, problem } : { drafts, turnEnded: true }
  }
}

const RETRY_TEXT: Record<string, string> = {
  rate_limit: 'a rate limit',
  overloaded: 'an overloaded service',
  server_error: 'a server error',
  authentication_failed: 'a sign-in problem',
  billing_error: 'a billing problem'
}

/** The redacted, capped, pretty JSON a card shows when opened. */
function showInput(input: unknown): string {
  if (input === undefined) return ''
  return cap(JSON.stringify(redactDeep(input), null, 2) ?? '', INPUT_MAX)
}

/** A tool result is a string, or a list of text (and image) blocks. */
function flatten(content: unknown): string {
  if (typeof content === 'string') return content
  return arr(content)
    .map((c) => (rec(c).type === 'text' ? str(rec(c).text) : rec(c).type === 'image' ? '[image]' : ''))
    .filter(Boolean)
    .join('\n')
}
