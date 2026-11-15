import { z } from 'zod'
import { ROLE_ID } from './roles'
import type { AttentionKind, Status } from './snapshot'

/**
 * Types the Tasks page, the Daily report (EOD), Settings and Diagnostics share between main, collector and renderer.
 * Everything here is derived from data AgentDeck already holds on this PC: no model calls, nothing leaves the machine.
 */

// ---- Tasks -------------------------------------------------------------------------------------------------------

export const TASK_TITLE_MAX = 200

export type TaskStatus = 'todo' | 'doing' | 'done'

/** One thing the user wants done today or soon. Agent work shows up beside these on its own, from live sessions. */
export interface WorkTask {
  id: string
  title: string
  /** The project folder (a session's cwd), or null for "no project". */
  project: string | null
  status: TaskStatus
  createdAt: number
  /** Set when status becomes `done`, cleared when it moves back. */
  doneAt: number | null
  /** Name of the background session this task was sent to, so its live status can sit on the card. */
  sessionName: string | null
  /** The role (Roles catalog id) this task is for: Send to an agent runs the session as that role. Null or absent = none. */
  role?: string | null
  /** The role's name when it was chosen, kept with the task so "as CTO" still reads right if the role is renamed or deleted. Set by main. */
  roleName?: string | null
}

export const TaskInput = z.object({
  title: z.string().trim().min(1).max(TASK_TITLE_MAX),
  project: z.string().min(3).max(1024).nullable(),
  role: z.string().regex(ROLE_ID).nullable().optional()
})
export type TaskInput = z.infer<typeof TaskInput>

export const TaskPatch = z
  .object({
    title: z.string().trim().min(1).max(TASK_TITLE_MAX),
    project: z.string().min(3).max(1024).nullable(),
    status: z.enum(['todo', 'doing', 'done']),
    sessionName: z.string().min(1).max(128).nullable(),
    role: z.string().regex(ROLE_ID).nullable()
  })
  .partial()
  .strict()
export type TaskPatch = z.infer<typeof TaskPatch>

export type TaskResult = { ok: true; task: WorkTask } | { ok: false; error: string }

// ---- Daily report (EOD) ------------------------------------------------------------------------------------------

/** A local calendar day, `YYYY-MM-DD`. */
export const DayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const EOD_NOTES_MAX = 4_000

export interface EodProject {
  cwd: string
  name: string
  agentTimeMs: number
  sessions: number
  turns: number
  files: number
}

export interface EodSession {
  id: string
  name: string
  project: string
  status: Status
  startedAt: number
  lastEventAt: number
  agentTimeMs: number
  plan: { done: number; total: number } | null
  /** First line of the session's last final message (already redacted at ingest), or null. */
  summary: string | null
}

/** Something that still waits on the user when the report is made. */
export interface EodBlocker {
  itemId: string
  kind: AttentionKind
  title: string
  sessionId: string
  project: string
  openedAt: number
}

export interface EodReport {
  day: string
  generatedAt: number
  /**
   * The day is over (the local date has moved on) and the report is final. Today's report is never closed: it is rewritten
   * while there is new activity, from the daily time until midnight.
   */
  closed: boolean
  totals: {
    agentTimeMs: number
    sessions: number
    turns: number
    filesChanged: number
    approvalsAnswered: number
    tasksDone: number
  }
  projects: EodProject[]
  sessions: EodSession[]
  tasksDone: WorkTask[]
  /** Tasks still open: they lead tomorrow's list. */
  carryOver: WorkTask[]
  blockers: EodBlocker[]
  /** The user's own words; the only part AgentDeck never rewrites. */
  notes: string
}

/** One row of the report history list. */
export interface EodDay {
  day: string
  agentTimeMs: number
  sessions: number
  tasksDone: number
  /** The markdown file exists in the report folder. */
  hasFile: boolean
}

export type EodWrite = { ok: true; path: string } | { ok: false; error: string }

/** `config.json` → `eod`. Defaults apply to a missing or invalid field. */
export interface EodSettings {
  enabled: boolean
  /** Local time, `HH:mm`. From then on the day's file is written, and rewritten (at most every 30 s) whenever the day changes, until midnight. */
  time: string
  /** Where the `YYYY-MM-DD.md` files go; null = `<userData>/eod`. */
  folder: string | null
}
export const EOD_DEFAULTS: EodSettings = { enabled: true, time: '18:00', folder: null }

// ---- Settings, profile, diagnostics ------------------------------------------------------------------------------

export const PROFILE_NAME_MAX = 40
export const DEFAULT_PROFILE_NAME = 'You'

export interface Profile {
  name: string
  /** A square PNG as a data URL (at most 256 px), or null: the UI shows the initial. Never leaves this PC. */
  avatar: string | null
}

export type ProfileResult = { ok: true; profile: Profile } | { ok: false; cancelled: boolean; error: string }

/** `config.json` → `notifications` (D-065), minutes after local midnight; `from` > `to` spans midnight. */
export interface NotificationSettings {
  completions: boolean
  kinds: Record<AttentionKind, boolean>
  quietHours: { from: number; to: number } | null
}

/** Light, dark, or whatever Windows is set to. */
export type ThemeChoice = 'system' | 'light' | 'dark'
export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark']

/** The Usage card's bar: estimated spend against this many dollars a week. Set by the user; subscriptions have no dollar limit to read. */
export const DEFAULT_WEEKLY_BUDGET_USD = 40
export const WEEKLY_BUDGET_MAX_USD = 100_000

export interface AppSettings {
  profile: { name: string; hasAvatar: boolean }
  eod: EodSettings
  notifications: NotificationSettings
  startAtLogin: boolean
  startMinimized: boolean
  theme: ThemeChoice
  /**
   * `readLogs`: read token counts (and nothing else) from Claude Code's local session logs, so the Usage card needs no new session
   * (ADR-0009 amendment). Off for everyone until they switch it on.
   */
  usage: { weeklyBudgetUsd: number; readLogs: boolean }
}

export interface SettingsPatch {
  profileName?: string
  eod?: Partial<EodSettings>
  notifications?: Partial<Omit<NotificationSettings, 'kinds'>> & { kinds?: Partial<NotificationSettings['kinds']> }
  startAtLogin?: boolean
  startMinimized?: boolean
  theme?: ThemeChoice
  usage?: { weeklyBudgetUsd?: number; readLogs?: boolean }
}

// ---- Claude Code link ---------------------------------------------------------------------------------------------

/**
 * How the local Claude Code is signed in, from its own status command. AgentDeck never reads credentials, `~/.claude.json`
 * or the account (ADR-0009): sessions started here run through the user's own signed-in CLI, so they use that subscription.
 */
export type SignInState = 'subscription' | 'api-key' | 'signed-out' | 'unknown'

export interface ClaudeLink {
  cli: { found: boolean; path: string | null; version: string | null }
  /** Never an email, organisation, account id or token. */
  signIn: SignInState
  /** A plan name (Pro, Max) only if the CLI states one without identifying the person; otherwise null. */
  plan: string | null
  /** `enabled`: Claude Code's telemetry points at AgentDeck in settings.json. `receiving`: figures arrived in the last day. `readLogs`: the opt-in to read token counts from the local logs is on. */
  usage: { enabled: boolean; receiving: boolean; readLogs: boolean }
  /**
   * AgentDeck's status line in settings.json (ADR-0009 amendment), which saves the plan's limits: `on`, `off`, `stale` (ours, but
   * its script is missing or the command differs) or `elsewhere` (the user's own status line). Absent until main has looked.
   */
  planUsage?: 'off' | 'on' | 'stale' | 'elsewhere'
}

export interface DiagnosticCheck {
  id: string
  label: string
  ok: boolean
  /** Plain words: what was found, or what to do. */
  detail: string
}

export interface Diagnostics {
  version: string
  electron: string
  node: string
  os: string
  userData: string
  dbPath: string
  dbBytes: number | null
  collector: 'up' | 'down' | 'demo'
  port: number | null
  hooks: 'installed' | 'missing' | 'error'
  claudePath: string | null
  claudeVersion: string | null
  startedAt: number
  checks: DiagnosticCheck[]
}
