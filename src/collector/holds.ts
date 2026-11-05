// ADR-0006 remote approvals: PermissionRequest hooks AgentDeck holds open until the user answers or the wait runs out.
import type { Verdict } from '@shared/bridge'
import { TITLE_MAX } from './attention'

/** hooks § PermissionRequest decision control; spike S4. Approve-once: no `updatedPermissions`, so no rule is ever added. */
export const ALLOW = { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } }
export const DENY = { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'Rejected in AgentDeck' } } }

/**
 * The one input each holdable tool's title shows (attention.ts approvalTitle). Every other tool goes to its terminal:
 * Edit/Write bodies are never stored (ADR-0010), and MCP calls, subagents, AskUserQuestion and ExitPlanMode show no
 * arguments at all (D-113).
 */
const SHOWN = new Map([
  ['Bash', 'command'],
  ['PowerShell', 'command'],
  ['Read', 'file_path'],
  ['WebFetch', 'url'],
  ['WebSearch', 'query']
])

/**
 * Held only when the row shows exactly what would run (D-113): the raw input equals the redacted one the title is
 * built from (nothing masked), fits the title (nothing cut), and has no backtick (titles show those as `'`).
 */
export function faithfulPreview(toolName: string | null, rawInput: unknown, shownInput: unknown): boolean {
  const field = toolName ? SHOWN.get(toolName) : undefined
  if (!field) return false
  const value = (o: unknown): unknown => (o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>)[field] : undefined)
  const v = value(rawInput)
  return typeof v === 'string' && v.trim() !== '' && v.length <= TITLE_MAX && !v.includes('`') && value(shownInput) === v
}

/**
 * How a hold ended. Only the first two send a decision; every other one replies empty, so Claude Code shows its own prompt.
 * `abandoned`: Claude Code closed the connection first (its hook timeout, or the session went away).
 * `released`: the item closed some other way, or the collector is shutting down.
 */
export type HoldOutcome = 'approved' | 'rejected' | 'timed-out' | 'abandoned' | 'released'

/** What the audit log keeps about a held request: the redacted preview the user saw, never the raw input. */
export interface HoldInfo {
  itemId: string
  sessionId: string
  agentId: string | null
  toolName: string | null
  title: string
  riskFlags: string[]
  /** SHA-256 of the raw `tool_input` Claude Code sent, so the log can prove what was answered. */
  inputHash: string
  requestedAt: number
}

export interface AuditRow extends HoldInfo {
  ts: number
  outcome: HoldOutcome
}

/** `gone`: it no longer waits here. `unlogged`: its audit row could not be written, so no decision went out. */
export type DecideResult = 'sent' | 'gone' | 'unlogged'

interface Pending {
  info: HoldInfo
  reply(body: unknown): void
  timer: NodeJS.Timeout
  signal: AbortSignal
  onAbort(): void
}

export class Holds {
  private readonly pending = new Map<string, Pending>()

  /**
   * `record` writes the audit row and says whether it did; `ended` updates the item once the reply is out.
   * `answered` is true only when a decision went out.
   */
  constructor(
    private readonly record: (row: AuditRow) => boolean,
    private readonly ended: (row: AuditRow, answered: boolean) => void
  ) {}

  /** Resolves with the reply body for Claude Code; undefined = an empty 200 (no decision). Never rejects. */
  add(info: HoldInfo, waitMs: number, signal: AbortSignal): Promise<unknown> {
    // A repeated delivery of the same request (D-056): only the newest connection waits.
    this.settle(info.itemId, 'released')
    return new Promise((resolve) => {
      if (signal.aborted) {
        const row: AuditRow = { ...info, ts: Date.now(), outcome: 'abandoned' }
        this.record(row)
        resolve(undefined)
        this.ended(row, false)
        return
      }
      const onAbort = (): void => void this.settle(info.itemId, 'abandoned')
      const timer = setTimeout(() => this.settle(info.itemId, 'timed-out'), waitMs)
      signal.addEventListener('abort', onAbort, { once: true })
      this.pending.set(info.itemId, { info, reply: resolve, timer, signal, onAbort })
    })
  }

  has(itemId: string): boolean {
    return this.pending.has(itemId)
  }

  /** One request, one answer. */
  decide(itemId: string, verdict: Verdict): DecideResult {
    if (!this.pending.has(itemId)) return 'gone'
    return this.settle(itemId, verdict === 'approve' ? 'approved' : 'rejected') ? 'sent' : 'unlogged'
  }

  /** Lets go of holds whose item closed meanwhile (session ended, a later event answered it). */
  releaseClosed(isOpen: (itemId: string) => boolean): void {
    for (const id of [...this.pending.keys()]) if (!isOpen(id)) this.settle(id, 'released')
  }

  releaseAll(): void {
    for (const id of [...this.pending.keys()]) this.settle(id, 'released')
  }

  /** Returns whether a decision went out. The audit row comes first: a decision that can't be logged is not sent. */
  private settle(itemId: string, outcome: HoldOutcome): boolean {
    const p = this.pending.get(itemId)
    if (!p) return false
    this.pending.delete(itemId)
    clearTimeout(p.timer)
    p.signal.removeEventListener('abort', p.onAbort)
    const row: AuditRow = { ...p.info, ts: Date.now(), outcome }
    const answered = this.record(row) && (outcome === 'approved' || outcome === 'rejected')
    p.reply(answered ? (outcome === 'approved' ? ALLOW : DENY) : undefined)
    this.ended(row, answered)
    return answered
  }
}
