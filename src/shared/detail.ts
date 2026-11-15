import type { ChangedFile, Session } from './snapshot'

/** One stored event as the drawer's timeline shows it (newest first). `summary` may hold `code` spans. */
export interface TimelineEntry {
  id: string
  ts: number
  kind: string
  /** Subagent type when a subagent did it; null = the main agent. */
  agentType: string | null
  summary: string
}

export interface PlanTask {
  id: string
  subject: string
  done: boolean
}

/**
 * How a held permission request ended (ADR-0006, D-107). Only the first two sent a decision; every other one replied
 * empty, so Claude Code showed its own prompt. `abandoned`: Claude Code closed the connection first (its hook timeout,
 * or the session went away). `released`: the item closed some other way, or the collector shut down.
 */
export type HoldOutcome = 'approved' | 'rejected' | 'timed-out' | 'abandoned' | 'released'

/** One remote-approvals audit row: the redacted preview the user saw, never the raw input. */
export interface AuditRow {
  ts: number
  requestedAt: number
  itemId: string
  sessionId: string
  agentId: string | null
  toolName: string | null
  title: string
  riskFlags: string[]
  /** SHA-256 of the raw `tool_input` Claude Code sent, so the log can prove what was answered. */
  inputHash: string
  outcome: HoldOutcome
}

/** Rows of each kind one history read returns (D-118). */
export const HISTORY_MAX = 300

/** The Activity and Approvals pages (UI_MAP § Sidebar): newest events across sessions, and the audit log. */
export interface History {
  activity: (TimelineEntry & { sessionId: string })[]
  audit: AuditRow[]
}

/** What the session drawer shows (UI_MAP § Session drawer); built by the collector from its store. */
export interface SessionDetail {
  session: Session
  timeline: TimelineEntry[]
  tasks: PlanTask[]
  files: ChangedFile[]
  /** `last_assistant_message` of the main agent's latest Stop, redacted and capped at ingest. */
  finalMessage: string | null
}
