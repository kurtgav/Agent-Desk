import { z } from 'zod'

/**
 * The Home view model. In M1 the renderer builds it from demo data; from M2 the collector
 * serves it at /api/snapshot (ARCHITECTURE § 6). Anything derivable (counts, ages, project
 * names) is computed by the renderer's selectors, never stored twice.
 */

const Ts = z.number().int().nonnegative() // epoch ms

export const Status = z.enum(['working', 'needs_you', 'failed', 'idle', 'done'])
export type Status = z.infer<typeof Status>

export const Surface = z.enum(['cli', 'desktop', 'vscode', 'background', 'sdk'])
export type Surface = z.infer<typeof Surface>

export const Subagent = z.object({
  id: z.string(),
  agentType: z.string(),
  task: z.string(),
  activity: z.string(),
  startedAt: Ts
})
export type Subagent = z.infer<typeof Subagent>

export const Session = z.object({
  /** Claude Code sessionId: the join key across hooks, poll and OTel. */
  id: z.string(),
  /** `claude agents` id, background sessions only. */
  bgId: z.string().nullable(),
  name: z.string(),
  cwd: z.string(),
  surface: Surface,
  status: Status,
  startedAt: Ts,
  lastEventAt: Ts,
  /** Plain-English activity from the latest tool event; `code` spans in backticks. */
  activity: z.string(),
  /** From TaskCreated/TaskCompleted; null when no plan exists. */
  plan: z.object({ done: z.number().int().nonnegative(), total: z.number().int().positive() }).nullable(),
  waitingSince: Ts.nullable(),
  subagents: z.array(Subagent)
})
export type Session = z.infer<typeof Session>

export const AttentionKind = z.enum(['approval', 'question', 'failed', 'stuck', 'review'])
export type AttentionKind = z.infer<typeof AttentionKind>

export const AttentionItem = z.object({
  id: z.string(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  kind: AttentionKind,
  sessionId: z.string(),
  /** Exact command, file, question or failure reason; `code` spans in backticks. */
  title: z.string(),
  toolName: z.string().nullable(),
  /** Fix hint for P2 items. */
  hint: z.string().nullable(),
  riskFlags: z.array(z.string()),
  /** A remote-approval hook is holding the request, so Approve/Reject can answer it. */
  held: z.boolean(),
  /** P4 only: the final message ends by asking you something (STATE_MACHINE § 4). */
  asked: z.boolean().optional(),
  openedAt: Ts
})
export type AttentionItem = z.infer<typeof AttentionItem>

export const ChangedFile = z.object({
  path: z.string(),
  sessionId: z.string(),
  tool: z.string(),
  changedAt: Ts
})
export type ChangedFile = z.infer<typeof ChangedFile>

export const Usage = z.object({
  todayTokens: z.number().int().nonnegative(),
  weekTokens: z.number().int().nonnegative(),
  todayCostUsd: z.number().nonnegative(),
  weekCostUsd: z.number().nonnegative(),
  weeklyBudgetUsd: z.number().positive()
})
export type Usage = z.infer<typeof Usage>

/** D-046: the snapshot keeps the newest 50 sessions and the newest 200 changed files; the list pages say so. */
export const SNAPSHOT_SESSIONS_MAX = 50
export const SNAPSHOT_FILES_MAX = 200

export const Snapshot = z.object({
  mode: z.enum(['demo', 'live']),
  generatedAt: Ts,
  /** When the window last lost focus (D-007); null until it first does. */
  awaySince: Ts.nullable(),
  /** When it got focus back; null while still away. "While you were away" counts [awaySince, awayUntil] (D-060). */
  awayUntil: Ts.nullable(),
  sessions: z.array(Session),
  attention: z.array(AttentionItem),
  /** Files changed by edit tools this week, newest first. */
  files: z.array(ChangedFile),
  week: z.object({
    agentTimeMs: z.number().int().nonnegative(),
    agentTimeLastWeekMs: z.number().int().nonnegative(),
    /** End time of every completed turn this week (D-010). */
    finishedTurns: z.array(Ts)
  }),
  /** Null when telemetry is off (ADR-0007): the Usage card shows the enable prompt. */
  usage: Usage.nullable(),
  recentAgentTypes: z.array(z.string()),
  agentDefinitionCount: z.number().int().nonnegative()
})
export type Snapshot = z.infer<typeof Snapshot>
