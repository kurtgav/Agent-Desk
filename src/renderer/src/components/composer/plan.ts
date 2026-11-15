import { PROMPT_MAX } from '@shared/bridge'
import { TASK_TITLE_MAX } from '@shared/work'
import { displayText, hasMessage, mentionIds, removeRanges, type MentionSpan } from './mentions'
import { HELPERS_MAX, MENTIONS_MAX, type RoleLookup, type Variant } from './types'

/**
 * What a variant sends, worked out from the text and the mentions in it. Pure: the box shows `reason` when it can not send, and
 * the caller makes the one call that `ok: true` describes.
 */

export type Plan =
  | { ok: false; reason: string }
  /** Start a conversation: `role` leads (`--agent`), `helpers` are available to it, `prompt` is the message with `@Name` for each mention. */
  | { ok: true; kind: 'new-session'; prompt: string; role: string | null; helpers: string[] }
  /** One message to a conversation, addressed to `mentions`; the conversation's own role stays. */
  | { ok: true; kind: 'reply'; text: string; mentions: string[] }
  /** One task: its title without the mention, and the agent it is for. */
  | { ok: true; kind: 'task'; title: string; role: string | null }

const count = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

/** Why a message with this many different agents in it can not be sent, or null when it can: the limit, in words, with how many to take out. */
export function overLimit(variant: Variant, agents: number): string | null {
  const max = MENTIONS_MAX[variant]
  if (agents <= max) return null
  return variant === 'task' ? `A task has one agent. Take out ${count(agents - 1, 'mention')}` : `One lead and ${HELPERS_MAX} helpers at most. Take out ${count(agents - max, 'mention')}`
}

export function planSend(variant: Variant, text: string, spans: readonly MentionSpan[], roles: RoleLookup): Plan {
  const ids = mentionIds(spans)
  const lead = ids[0]
  if (!text.trim()) return { ok: false, reason: variant === 'task' ? 'Type a task first' : 'Type a message first' }
  if (!hasMessage(text, spans)) return { ok: false, reason: `Say what you want from @${roles.name(lead ?? '')}` }
  const over = overLimit(variant, ids.length)
  if (over) return { ok: false, reason: over }
  if (variant === 'new-session') return { ok: true, kind: 'new-session', prompt: displayText(text, spans, roles.name).trim(), role: lead ?? null, helpers: ids.slice(1) }
  if (variant === 'reply') return { ok: true, kind: 'reply', text: displayText(text, spans, roles.name).trim(), mentions: ids }
  const title = removeRanges(text, spans.map((s): [number, number] => [s.start, s.end])).text.replace(/\s+/g, ' ').trim()
  if (title.length > TASK_TITLE_MAX) return { ok: false, reason: `Keep the task to ${TASK_TITLE_MAX} characters` }
  return { ok: true, kind: 'task', title, role: lead ?? null }
}

export type BackgroundPlan = { ok: true; prompt: string; agent: string | null } | { ok: false; reason: string }

/**
 * "Run in the background" (`claude --bg`): the lead becomes `--agent`, which Claude Code only knows by an installed agent's name.
 * A helper that is installed is called the way Claude Code's own docs call a subagent, `@agent-name`; one that is not stays `@Name`.
 */
export function planBackground(text: string, spans: readonly MentionSpan[], roles: RoleLookup): BackgroundPlan {
  if (!text.trim()) return { ok: false, reason: 'Type a task first' }
  if (!hasMessage(text, spans)) return { ok: false, reason: `Say what you want from @${roles.name(spans[0]?.id ?? '')}` }
  const ids = mentionIds(spans)
  const lead = ids[0]
  let agent: string | null = null
  if (lead) {
    agent = roles.agent(lead)
    if (!agent) return { ok: false, reason: `${roles.name(lead)} is not installed in Claude Code, so it can only lead a conversation here. Install it from Agents to run it in the background.` }
  }
  let out = ''
  let at = 0
  for (const s of spans) {
    out += text.slice(at, s.start)
    const helper = roles.agent(s.id)
    if (s.id !== lead) out += `@${helper ? `agent-${helper}` : roles.name(s.id)}`
    // The lead's own mention is `--agent`, so it goes, and the space after it with it.
    at = s.id === lead && text[s.end] === ' ' ? s.end + 1 : s.end
  }
  const prompt = (out + text.slice(at)).trim()
  // The command line has a limit (D-109): said here, not as a refusal after the click.
  if (prompt.length > PROMPT_MAX) return { ok: false, reason: `A background task is at most ${PROMPT_MAX.toLocaleString('en-US')} characters, and this one is ${prompt.length.toLocaleString('en-US')}. Start a conversation instead, or shorten it.` }
  return { ok: true, prompt, agent }
}
