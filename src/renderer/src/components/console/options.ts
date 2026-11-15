import type { Effort } from '@shared/bridge'
import { MODEL_ALIASES, type ConsoleState, type McpStatus, type PermissionMode } from '@shared/console'
import type { Tone } from '../ui'

/** The words for what a new conversation is started with (the same flags `claude --help` documents). */

export const EFFORT_LABEL: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }

export interface ModelOption {
  value: string | null
  label: string
  hint: string
}

export const MODEL_OPTIONS: readonly ModelOption[] = [
  { value: null, label: 'Default', hint: 'Whatever Claude Code uses for you.' },
  ...MODEL_ALIASES.map((m): ModelOption => ({ value: m, label: m[0]!.toUpperCase() + m.slice(1), hint: `The latest ${m[0]!.toUpperCase() + m.slice(1)}.` }))
]

export const modelLabel = (model: string | null): string => MODEL_OPTIONS.find((o) => o.value === model)?.label ?? model ?? 'Default'

export const MODE_OPTIONS: readonly { value: PermissionMode; label: string; hint: string }[] = [
  { value: 'default', label: 'Ask first', hint: 'Reads freely. Edits and commands need approval: turn on Remote approvals to answer them in AgentDeck.' },
  { value: 'acceptEdits', label: 'Accept edits', hint: 'Edits files without asking. Commands still need approval.' },
  { value: 'plan', label: 'Plan', hint: 'Read only. Claude explores and proposes a plan, and changes nothing.' },
  { value: 'bypassPermissions', label: 'Bypass permissions', hint: 'Runs every edit and command without asking. Only use it in a folder you trust.' }
]

export const modeLabel = (mode: PermissionMode): string => MODE_OPTIONS.find((o) => o.value === mode)?.label ?? mode

/** A conversation's state as the pill shows it. */
export const STATE_PILL: Record<ConsoleState, { label: string; tone: Tone }> = {
  starting: { label: 'Starting', tone: 'working' },
  working: { label: 'Working', tone: 'working' },
  idle: { label: 'Your turn', tone: 'idle' },
  ended: { label: 'Ended', tone: 'done' },
  failed: { label: 'Failed', tone: 'failed' }
}

export const STARTERS = [
  {
    title: 'Explain this project',
    detail: 'A short tour: what it does, how it is laid out, where to start.',
    prompt: 'Give me a short tour of this project: what it does, how it is organised, and where I should start reading.'
  },
  {
    title: 'Fix a failing test',
    detail: 'Run the tests, find what fails and make the smallest fix.',
    prompt: 'Run the test suite, find any failing test, explain the cause and fix it with the smallest change.'
  },
  {
    title: 'Review my uncommitted changes',
    detail: 'A careful read of the diff. Nothing is edited.',
    prompt: 'Review my uncommitted changes (git diff). Point out bugs, risks and anything unclear. Do not edit any files.'
  }
] as const

/** An MCP server's state in plain words, and what to do about it (backticks mark commands, shown as code). */
export const MCP_STATUS: Record<McpStatus, { word: string; fix: string | null }> = {
  connected: { word: 'Ready', fix: null },
  pending: { word: 'Still connecting', fix: 'It may be ready in a moment. Claude can use it once it connects.' },
  'needs-auth': { word: 'Needs sign-in', fix: 'In a terminal, run `claude`, type /mcp, pick this server and sign in.' },
  failed: { word: 'Could not connect', fix: 'In a terminal, run `claude mcp list` to see why. Fix or remove it with `claude mcp`.' },
  disabled: { word: 'Turned off', fix: 'It is switched off in Claude Code.' },
  unknown: { word: 'Unknown', fix: null }
}
