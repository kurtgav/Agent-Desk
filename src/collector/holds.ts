// ADR-0006 remote approvals: PermissionRequest hooks AgentDeck holds open until the user answers or the wait runs out.
import type { Verdict } from '@shared/bridge'

/** hooks § PermissionRequest decision control; spike S4. Approve-once: no `updatedPermissions`, so no rule is ever added. */
export const ALLOW = { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } }
export const DENY = { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'Rejected in AgentDeck' } } }

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
  /** SHA-256 of the redacted `tool_input`. */
  inputHash: string
  requestedAt: number
}

export interface AuditRow extends HoldInfo {
  ts: number
  outcome: HoldOutcome
}

interface Pending {
  info: HoldInfo
  reply(body: unknown): void
  timer: NodeJS.Timeout
  signal: AbortSignal
  onAbort(): void
}

export class Holds {
  private readonly pending = new Map<string, Pending>()

  constructor(private readonly settled: (row: AuditRow) => void) {}

  /** Resolves with the reply body for Claude Code; undefined = an empty 200 (no decision). Never rejects. */
  add(info: HoldInfo, waitMs: number, signal: AbortSignal): Promise<unknown> {
    // A repeated delivery of the same request (D-056): only the newest connection waits.
    this.settle(info.itemId, 'released')
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve(undefined)
        this.settled({ ...info, ts: Date.now(), outcome: 'abandoned' })
        return
      }
      const onAbort = (): void => this.settle(info.itemId, 'abandoned')
      const timer = setTimeout(() => this.settle(info.itemId, 'timed-out'), waitMs)
      signal.addEventListener('abort', onAbort, { once: true })
      this.pending.set(info.itemId, { info, reply: resolve, timer, signal, onAbort })
    })
  }

  has(itemId: string): boolean {
    return this.pending.has(itemId)
  }

  /** One request, one answer. False when it no longer waits here. */
  decide(itemId: string, verdict: Verdict): boolean {
    if (!this.pending.has(itemId)) return false
    this.settle(itemId, verdict === 'approve' ? 'approved' : 'rejected')
    return true
  }

  /** Lets go of holds whose item closed meanwhile (session ended, a later event answered it). */
  releaseClosed(isOpen: (itemId: string) => boolean): void {
    for (const id of [...this.pending.keys()]) if (!isOpen(id)) this.settle(id, 'released')
  }

  releaseAll(): void {
    for (const id of [...this.pending.keys()]) this.settle(id, 'released')
  }

  private settle(itemId: string, outcome: HoldOutcome): void {
    const p = this.pending.get(itemId)
    if (!p) return
    this.pending.delete(itemId)
    clearTimeout(p.timer)
    p.signal.removeEventListener('abort', p.onAbort)
    p.reply(outcome === 'approved' ? ALLOW : outcome === 'rejected' ? DENY : undefined)
    this.settled({ ...p.info, ts: Date.now(), outcome })
  }
}
