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

/** What the session drawer shows (UI_MAP § Session drawer); built by the collector from its store. */
export interface SessionDetail {
  session: Session
  timeline: TimelineEntry[]
  tasks: PlanTask[]
  files: ChangedFile[]
  /** `last_assistant_message` of the main agent's latest Stop, redacted and capped at ingest. */
  finalMessage: string | null
}
