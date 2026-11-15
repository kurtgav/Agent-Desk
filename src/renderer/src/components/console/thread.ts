import type { ConsoleCapabilities, ConsoleEvent, ConsoleProblem, ConsoleState } from '@shared/console'

/** What a conversation looks like on screen, built from its events (shared/console.ts). Pure: the page only renders it. */

export type ToolStatus = 'running' | 'ok' | 'failed' | 'denied' | 'stopped'

export type ThreadItem =
  | { kind: 'user'; key: string; text: string }
  | { kind: 'text'; key: string; text: string; final: boolean }
  | { kind: 'thinking'; key: string; text: string; final: boolean }
  | {
      kind: 'tool'
      key: string
      toolUseId: string
      name: string
      summary: string
      input: string
      status: ToolStatus
      result: string | null
      truncated: boolean
      /** The rule that would allow it, when it was denied and a safe one exists (`mcp__server__tool`, `Bash(npm test)`). */
      rule: string | null
    }
  | {
      kind: 'turn'
      key: string
      costUsd: number | null
      inputTokens: number | null
      outputTokens: number | null
      durationMs: number | null
      interrupted: boolean
      error: string | null
    }
  | { kind: 'notice'; key: string; level: 'info' | 'warn'; text: string }

export interface Thread {
  items: ThreadItem[]
  /** The highest event number applied; a live event at or below it was already seen. */
  lastSeq: number
  state: ConsoleState
  sessionId: string | null
  error: string | null
  problem: ConsoleProblem | null
  /** When the turn that is running began (the last message you sent), for the elapsed time. */
  turnStartedAt: number | null
  turns: number
  /** The conversation's running cost, as Claude Code last said it. */
  totalCostUsd: number
  /** When the last event happened (0 until one is seen): the sidebar sorts and groups by it. */
  lastAt: number
  /** What it can use (init), once Claude Code has said. */
  capabilities: ConsoleCapabilities | null
  /** Tools that run without asking here: the ones it started with and the ones allowed since. */
  allowed: string[]
}

export const emptyThread: Thread = { items: [], lastSeq: 0, state: 'starting', sessionId: null, error: null, problem: null, turnStartedAt: null, turns: 0, totalCostUsd: 0, lastAt: 0, capabilities: null, allowed: [] }

const replaceAt = <T,>(list: readonly T[], i: number, item: T): T[] => list.map((x, j) => (j === i ? item : x))

/** Whatever was still going when the turn ended is not going any more. */
function settle(items: ThreadItem[]): ThreadItem[] {
  return items.map((it) => {
    if ((it.kind === 'text' || it.kind === 'thinking') && !it.final) return { ...it, final: true }
    if (it.kind === 'tool' && it.status === 'running') return { ...it, status: 'stopped' }
    return it
  })
}

/** One event applied to a thread. Does not check the event number: see `applyLive` and `applyHistory`. */
export function applyEvent(t: Thread, e: ConsoleEvent): Thread {
  const next = (items: ThreadItem[], more: Partial<Thread> = {}): Thread => ({ ...t, items, lastSeq: Math.max(t.lastSeq, e.seq), lastAt: Math.max(t.lastAt, e.ts), ...more })
  switch (e.kind) {
    case 'state':
      return next(t.items, { state: e.state, sessionId: e.sessionId ?? t.sessionId, error: e.error, problem: e.problem })
    case 'user':
      return next([...t.items, { kind: 'user', key: `user:${e.seq}`, text: e.text }], { turnStartedAt: e.ts })
    case 'assistant-text':
    case 'thinking': {
      const kind = e.kind === 'thinking' ? 'thinking' : 'text'
      const key = `${kind}:${e.messageId}`
      const item: ThreadItem = { kind, key, text: e.text, final: e.final }
      const at = t.items.findIndex((it) => it.key === key)
      return next(at >= 0 ? replaceAt(t.items, at, item) : [...t.items, item])
    }
    case 'tool-use': {
      if (t.items.some((it) => it.kind === 'tool' && it.toolUseId === e.toolUseId)) return next(t.items)
      const item: ThreadItem = {
        kind: 'tool', key: `tool:${e.toolUseId}`, toolUseId: e.toolUseId, name: e.name, summary: e.summary, input: e.input, status: 'running', result: null, truncated: false, rule: null
      }
      return next([...t.items, item])
    }
    case 'tool-result': {
      const at = t.items.findIndex((it) => it.kind === 'tool' && it.toolUseId === e.toolUseId)
      const it = t.items[at]
      if (!it || it.kind !== 'tool') return next(t.items) // its call was trimmed away
      return next(replaceAt(t.items, at, { ...it, status: it.status === 'denied' ? 'denied' : e.ok ? 'ok' : 'failed', result: e.text, truncated: e.truncated }))
    }
    case 'permission-denied': {
      const at = t.items.findIndex((it) => it.kind === 'tool' && it.toolUseId === e.toolUseId)
      const it = t.items[at]
      if (it && it.kind === 'tool') return next(replaceAt(t.items, at, { ...it, status: 'denied', rule: e.rule }))
      return next([...t.items, { kind: 'tool', key: `tool:${e.toolUseId}`, toolUseId: e.toolUseId, name: e.name, summary: e.summary, input: '', status: 'denied', result: null, truncated: false, rule: e.rule }])
    }
    case 'turn-end':
      return next(
        [
          ...settle(t.items),
          {
            kind: 'turn', key: `turn:${e.seq}`, costUsd: e.costUsd, inputTokens: e.inputTokens, outputTokens: e.outputTokens, durationMs: e.durationMs,
            interrupted: e.interrupted, error: e.interrupted ? null : e.error
          }
        ],
        { turnStartedAt: null, turns: t.turns + 1, totalCostUsd: e.totalCostUsd ?? t.totalCostUsd }
      )
    case 'notice':
      return next([...t.items, { kind: 'notice', key: `notice:${e.seq}`, level: e.level, text: e.text }])
    case 'capabilities':
      return next(t.items, { capabilities: e.capabilities })
    case 'allowed':
      return next(t.items, { allowed: e.tools })
  }
}

/** A live event: ignored when it was already seen (it came with the history, or twice). */
export const applyLive = (t: Thread, e: ConsoleEvent): Thread => (e.seq > t.lastSeq ? applyEvent(t, e) : t)

/** Main's history lists a growing message where it began, so event numbers are not in order here: apply them all. */
export const applyHistory = (events: readonly ConsoleEvent[], from: Thread = emptyThread): Thread => events.reduce(applyEvent, from)

export const isWorking = (t: Thread): boolean => t.state === 'working' || t.state === 'starting'

/** Text still being written at the end of the thread: no typing indicator needed. */
export const isStreaming = (t: Thread): boolean => {
  const last = t.items.at(-1)
  return isWorking(t) && last !== undefined && (last.kind === 'text' || last.kind === 'thinking') && !last.final
}
