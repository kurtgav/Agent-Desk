import { randomBytes } from 'node:crypto'

/** docs/EVENT_SCHEMA.md § AgentEvent. Every source is normalized into this before the reducers run. */
export type EventSource = 'hook' | 'poll' | 'otel' | 'reporter' | 'agentdeck'

export type EventKind =
  | 'session.prompt'
  | 'session.notified'
  | 'tool.started'
  | 'tool.finished'
  | 'tool.failed'
  | 'permission.requested'
  | 'permission.denied'
  | 'notification'
  | 'turn.stopped'
  | 'turn.failed'
  | 'subagent.started'
  | 'subagent.stopped'
  | 'task.created'
  | 'task.completed'
  | 'context.compacting'
  | 'cwd.changed'
  | 'session.ended'
  | 'session.state'
  | 'session.gone'
  | 'unknown'

export interface AgentEvent {
  id: string
  /** ms epoch, collector receive time */
  ts: number
  source: EventSource
  sessionId: string
  /** null = main thread */
  agentId: string | null
  parentAgentId: string | null
  agentType: string | null
  kind: EventKind
  toolName: string | null
  /** D-020; filled in by correlation for PermissionRequest */
  toolUseId: string | null
  summary: string
  /** redacted source body */
  payload: Record<string, unknown>
  cwd: string | null
  /** Hooks only: SHA-256 of the raw body, so a repeated delivery is stored once (D-044). */
  dedupeKey: string | null
}

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** ULID: 48-bit time + 80 random bits, Crockford base32. 256 is a multiple of 32, so `byte % 32` is unbiased. */
export function ulid(ts: number): string {
  let t = ts
  let time = ''
  for (let i = 0; i < 10; i++) {
    time = B32[t % 32]! + time
    t = Math.floor(t / 32)
  }
  let rand = ''
  for (const b of randomBytes(16)) rand += B32[b % 32]!
  return time + rand
}
