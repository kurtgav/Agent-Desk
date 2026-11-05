import type { SessionDetail } from './detail'
import type { Snapshot } from './snapshot'

/** What the preload exposes on `window.agentdeck` (ADR-0010: no Node in the renderer). */
export interface AppInfo {
  version: string
  /** Demo data from fixtures instead of live sessions (ADR-0011). */
  demo: boolean
}

/**
 * Hook integration state (ADR-0005). `installed`: our entries for the current port and token are in settings.json.
 * `missing`: they are not (never installed, removed, or stale). `error`: settings.json can't be read or parsed.
 */
export type HooksState = 'installed' | 'missing' | 'error'

export interface AppStatus {
  hooks: HooksState
  /** Why `error`, in plain words. */
  hooksError: string | null
  /** disableAllHooks / allowedHttpHookUrls problems in the same file (ADR-0005 § 6). */
  conflicts: string[]
  /** Toasts are paused until this time (ms epoch); null = not paused. */
  pausedUntil: number | null
}

/** A dry run of an install or uninstall: what would change in settings.json, secrets masked. */
export type HooksPreview =
  | { ok: true; path: string; backups: string; changed: boolean; diff: string; conflicts: string[] }
  | { ok: false; path: string; error: string }

export type HooksResult = { ok: true } | { ok: false; error: string }

export type PauseChoice = 'hour' | 'tomorrow'

/** Session drawer actions (UI_MAP § Session drawer). Main looks the session up itself; the renderer sends only its id. */
export type SessionAction = 'attach' | 'stop' | 'open-folder' | 'open-desktop' | 'copy-resume'

export type ActionResult = { ok: true } | { ok: false; error: string }
export type LogsResult = { ok: true; text: string } | { ok: false; error: string }

/** `claude --effort` levels (`claude --help`); the composer's Max chip cycles through them. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

/** A subagent definition from `~/.claude/agents` or `<project>/.claude/agents` (sub-agents § Choose the subagent scope). */
export interface AgentDef {
  name: string
  description: string
  model: string | null
  scope: 'user' | 'project'
}

/** The composer's task: `claude --bg --name <auto> [--agent a] --effort e "<prompt>"` in `cwd`. */
export interface DispatchRequest {
  prompt: string
  cwd: string
  agent: string | null
  effort: Effort
}

/** `untrusted`: the folder needs `claude` run there once to accept the trust prompt (S6). */
export type DispatchResult = { ok: true; name: string; bgId: string | null } | { ok: false; error: string; untrusted: boolean }

export interface AgentDeckBridge {
  getAppInfo(): Promise<AppInfo>
  /** The latest live snapshot, or null before the collector's first one (and always in demo). */
  getSnapshot(): Promise<Snapshot | null>
  /** Live snapshots as they change (D-040), or null when the collector stopped and is restarting (D-059). Returns an unsubscribe function. */
  onSnapshot(listener: (s: Snapshot | null) => void): () => void
  /** Switches demo data on or off; the window reloads into the new mode. */
  setDemo(on: boolean): Promise<void>
  getStatus(): Promise<AppStatus>
  onStatus(listener: (s: AppStatus) => void): () => void
  /** A toast was clicked: show this attention item. */
  onFocusItem(listener: (id: string) => void): () => void
  /** Dismiss a P2–P4 item (P1 items close only when answered). */
  dismiss(id: string): Promise<void>
  /** For one hour, until 08:00 tomorrow, or null to resume. */
  pauseNotifications(until: PauseChoice | null): Promise<void>
  previewInstall(): Promise<HooksPreview>
  previewUninstall(): Promise<HooksPreview>
  /** Writes settings.json; the renderer calls these only after the user confirmed the preview's diff. */
  installHooks(): Promise<HooksResult>
  uninstallHooks(): Promise<HooksResult>
  /** The drawer's data, or null when the collector doesn't know the session (or isn't running). */
  getDetail(sessionId: string): Promise<SessionDetail | null>
  /** Stop is only sent after the user confirmed it in the window. */
  act(action: SessionAction, sessionId: string): Promise<ActionResult>
  /** `claude logs <id>` of a background session, ANSI codes removed. */
  logs(sessionId: string): Promise<LogsResult>
  /** `code -g <path>` for a file an agent changed. */
  openFile(path: string): Promise<ActionResult>
  /** Starts a background session. `cwd` must be a project AgentDeck saw a session in, or one picked with chooseFolder. */
  dispatch(req: DispatchRequest): Promise<DispatchResult>
  /** The folder picker behind Browse…; null when cancelled. */
  chooseFolder(): Promise<string | null>
  /** Opens `claude` in that folder in a terminal window, so the user can accept its trust prompt. */
  runClaudeIn(cwd: string): Promise<ActionResult>
  /** User subagents, plus that project's when `cwd` is given; project ones win on a name clash. */
  listAgents(cwd: string | null): Promise<AgentDef[]>
}

export const IPC = {
  appInfo: 'app:info',
  setDemo: 'app:set-demo',
  snapshot: 'snapshot:get',
  snapshotPush: 'snapshot:push',
  status: 'status:get',
  statusPush: 'status:push',
  focusItem: 'attention:focus',
  dismiss: 'attention:dismiss',
  pause: 'notifications:pause',
  previewInstall: 'hooks:preview-install',
  previewUninstall: 'hooks:preview-uninstall',
  install: 'hooks:install',
  uninstall: 'hooks:uninstall',
  detail: 'session:detail',
  act: 'session:act',
  logs: 'session:logs',
  openFile: 'file:open',
  dispatch: 'composer:dispatch',
  chooseFolder: 'composer:choose-folder',
  runClaudeIn: 'composer:run-claude-in',
  listAgents: 'composer:agents'
} as const
