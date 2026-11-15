import type { ConsoleAllowResult, ConsoleEvent, ConsoleImage, ConsoleStart, ConsoleStartResult, ConsoleSummary, McpListResult, ModelListResult } from './console'
import type { History, SessionDetail } from './detail'
import type { CustomRoleInput, RoleDetail, RoleHit, RoleRepoResult, RoleSaveResult, RoleSkillsResult, RolesCatalog, RolesStatus } from './roles'
import type { SectionOp, SessionMetaPatch, SessionMetaResult, SessionMetaState } from './session-meta'
import type { Snapshot } from './snapshot'
import type {
  AppSettings, ClaudeLink, Diagnostics, EodDay, EodReport, EodWrite, Profile, ProfileResult, SettingsPatch, TaskInput, TaskPatch, TaskResult, WorkTask
} from './work'

/** What the preload exposes on `window.agentdeck` (ADR-0010: no Node in the renderer). */
export interface AppInfo {
  version: string
  /** Demo data from fixtures instead of live sessions (ADR-0011). */
  demo: boolean
  /** main's `process.platform` ('win32', 'darwin'): the page pads for macOS's traffic lights and names its file manager. */
  platform: string
}

/**
 * Hook integration state (ADR-0005). `installed`: our entries for the current port and token are in settings.json.
 * `missing`: they are not (never installed, removed, or stale). `error`: settings.json can't be read or parsed.
 */
export type HooksState = 'installed' | 'missing' | 'error'

/** ADR-0006: off by default. While on, a permission request waits in AgentDeck up to `waitSec` before the terminal asks. */
export interface RemoteApprovals {
  enabled: boolean
  waitSec: number
}

export interface AppStatus {
  hooks: HooksState
  /** Why `error`, in plain words. */
  hooksError: string | null
  /** disableAllHooks / allowedHttpHookUrls problems in the same file (ADR-0005 § 6). */
  conflicts: string[]
  /** Toasts are paused until this time (ms epoch); null = not paused. */
  pausedUntil: number | null
  /** As the user last installed the hooks; the toggle lives in the install dialog. */
  remoteApprovals: RemoteApprovals
}

/** The answer to one held permission request: approve-once or reject (ADR-0006). */
export type Verdict = 'approve' | 'reject'

/** A dry run of an install or uninstall: what would change in settings.json, secrets masked. */
export type HooksPreview =
  | { ok: true; path: string; backups: string; changed: boolean; diff: string; conflicts: string[] }
  | { ok: false; path: string; error: string }

export type HooksResult = { ok: true } | { ok: false; error: string }

export type PauseChoice = 'hour' | 'tomorrow'

/** Session drawer actions (UI_MAP § Session drawer). Main looks the session up itself; the renderer sends only its id. */
export const SESSION_ACTIONS = [
  'attach',
  'stop',
  'open-folder',
  'open-desktop',
  'copy-resume',
  'focus-terminal',
  'open-explorer',
  'open-cursor',
  'open-terminal',
  'delete-background'
] as const
export type SessionAction = (typeof SESSION_ACTIONS)[number]

/** Which of the optional "Open in" programs this PC has. */
export interface OpenTargets {
  cursor: boolean
}

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

/**
 * The prompt rides on the command line, which Windows caps at 32,767 characters; quoting at most doubles it (D-109).
 * shortcut: through an npm `claude.cmd` shim, cmd.exe stops at 8,191 escaped characters and says "The command line
 * is too long.", which the composer shows; send the prompt another way if that ever matters.
 */
export const PROMPT_MAX = 8_000

/** The composer's task: `claude --bg --name <auto> [--agent a] [--model m] --effort e "<prompt>"` in `cwd`. */
export interface DispatchRequest {
  prompt: string
  cwd: string
  agent: string | null
  effort: Effort
  /** `claude --model` alias or full id (the same choice as the Console's); absent or null = Claude Code's default. `--bg` takes `--model` (agent-view § Dispatch). */
  model?: string | null
  /** A Roles catalog id: the background session runs as that role (`--agent`, or an inline `--agents` definition for one Claude Code does not have). Not together with `agent`. */
  role?: string | null
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
  /** `remoteApprovals` changes the PermissionRequest entry's timeout, so it is part of what the diff shows. */
  previewInstall(remoteApprovals: boolean): Promise<HooksPreview>
  previewUninstall(): Promise<HooksPreview>
  /** Writes settings.json; the renderer calls these only after the user confirmed the preview's diff. */
  installHooks(remoteApprovals: boolean): Promise<HooksResult>
  uninstallHooks(): Promise<HooksResult>
  /** Answers one held permission request. Fails when it no longer waits (time ran out, or it was answered elsewhere). */
  decide(itemId: string, verdict: Verdict): Promise<ActionResult>
  /** The drawer's data, or null when the collector doesn't know the session (or isn't running). */
  getDetail(sessionId: string): Promise<SessionDetail | null>
  /** Activity and the approvals audit log, or null when the collector isn't running (and always in demo). */
  getHistory(): Promise<History | null>
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

  /** Tasks (shared/work.ts). `null` when the collector isn't running, and always in demo. */
  listTasks(): Promise<WorkTask[] | null>
  addTask(input: TaskInput): Promise<TaskResult>
  updateTask(id: string, patch: TaskPatch): Promise<TaskResult>
  removeTask(id: string): Promise<ActionResult>

  /** The Daily report for a local day (`YYYY-MM-DD`). Today's is rebuilt from live data on every call. */
  getEod(day: string): Promise<EodReport | null>
  /** Days that have data or a file, newest first. */
  listEodDays(): Promise<EodDay[] | null>
  saveEodNotes(day: string, notes: string): Promise<ActionResult>
  /** Writes the day's markdown file now, into the report folder. */
  writeEod(day: string): Promise<EodWrite>
  openEodFolder(): Promise<ActionResult>
  /** The OS clipboard: the sandboxed renderer is not granted `navigator.clipboard`. */
  copyText(text: string): Promise<ActionResult>

  getSettings(): Promise<AppSettings>
  /** Validates and saves; resolves with the settings as stored. */
  updateSettings(patch: SettingsPatch): Promise<AppSettings>
  getProfile(): Promise<Profile>
  /** Opens a file picker for a photo, shrinks it to a 256 px PNG in `<userData>/profile`, and returns the new profile. */
  chooseAvatar(): Promise<ProfileResult>
  clearAvatar(): Promise<Profile>
  getDiagnostics(): Promise<Diagnostics>

  /** Shows a real Windows notification now, with the bot image, so the user can see what AgentDeck's toasts look like. */
  testNotification(): Promise<ActionResult>
  /** The local Claude Code's sign-in state and whether its usage telemetry reaches AgentDeck. Never an email or token. */
  getClaudeLink(): Promise<ClaudeLink>
  /** A dry run of turning Claude Code's usage telemetry on or off in settings.json: what would change, secrets masked. */
  previewUsageTelemetry(on: boolean): Promise<HooksPreview>
  /** Writes settings.json; only after the user read the preview's diff. */
  setUsageTelemetry(on: boolean): Promise<HooksResult>

  /** The Console (shared/console.ts). Conversations run as child `claude -p` processes of main; nothing is stored. */
  consoleStart(req: ConsoleStart): Promise<ConsoleStartResult>
  /** `mentions`: role ids addressed by this one message (`@QA review this`). They answer as subagents; the session's own role does not change. */
  consoleSend(id: string, text: string, mentions?: string[], images?: ConsoleImage[]): Promise<ActionResult>
  /** Interrupts the running turn when there is one, otherwise ends the conversation. */
  consoleStop(id: string): Promise<ActionResult>
  consoleList(): Promise<ConsoleSummary[]>
  /** Everything said so far in one conversation, for a page opened after it began. In memory: gone when AgentDeck quits. */
  consoleHistory(id: string): Promise<ConsoleEvent[]>
  /** Lets one more tool run without asking in a running conversation (a rule such as `mcp__server__tool`); no restart, nothing is stored. */
  consoleAllow(id: string, rule: string): Promise<ConsoleAllowResult>
  /** `claude mcp list` (it health-checks servers, up to 20 s): names and status only, cached for a minute. `cwd` adds that project's servers. */
  consoleMcpList(cwd: string | null): Promise<McpListResult>
  /** Stops a check that is running. */
  consoleMcpCancel(): Promise<void>
  /** The models Claude Code offers this account, as its own picker lists them. */
  consoleModels(): Promise<ModelListResult>
  onConsoleEvent(listener: (e: ConsoleEvent) => void): () => void
  /** Tasks or the daily report changed (a session moved, a task was edited): refetch what is on screen. */
  onWorkChanged(listener: () => void): () => void

  /** Local notes about sessions (pinned, unread, a display name, archived, a section): config.json, never Claude Code's files. */
  getSessionMeta(): Promise<SessionMetaState>
  setSessionMeta(sessionId: string, patch: SessionMetaPatch): Promise<SessionMetaResult>
  setSections(op: SectionOp): Promise<SessionMetaResult>
  /** The sessions a snapshot lists now: their notes stay for another 90 days. */
  touchSessions(sessionIds: string[]): Promise<void>
  /** Whether Cursor is installed, for the session menu's Open in. */
  getOpenTargets(): Promise<OpenTargets>

  /** Roles (shared/roles.ts): personas from the agency-agents clone, Claude Code's agents folder, your own and AgentDeck's. Local files only. */
  listRoles(): Promise<RolesCatalog>
  /** A fresh read of every folder, ignoring the short cache. */
  reloadRoles(): Promise<RolesCatalog>
  getRolesStatus(): Promise<RolesStatus>
  searchRoles(query: string): Promise<RoleHit[]>
  suggestRoles(text: string, n: number): Promise<RoleHit[]>
  /** One role with a plain-text preview of its first 4 KB; null when it no longer exists. */
  getRole(id: string): Promise<RoleDetail | null>
  saveCustomRole(input: CustomRoleInput): Promise<RoleSaveResult>
  deleteCustomRole(id: string): Promise<ActionResult>
  /** An editable custom copy of any role. */
  duplicateRole(id: string): Promise<RoleSaveResult>
  /** Returns the pinned ids as saved. */
  setRolePinned(id: string, pinned: boolean): Promise<string[]>
  /** Points AgentDeck at an existing clone of agency-agents (null forgets the choice). Nothing is fetched. */
  setRolesRepo(path: string | null): Promise<RoleRepoResult>
  /** A folder picker for the clone; null when cancelled. */
  browseRolesRepo(): Promise<string | null>
  /** Writes each role as a Claude Code skill (`skills/agency-<id>/SKILL.md`). Only on request: every skill costs context in every session. */
  installRoleSkills(ids: string[]): Promise<RoleSkillsResult>
  /** Removes the skills AgentDeck wrote for these roles; a skill it did not write is left alone. */
  removeRoleSkills(ids: string[]): Promise<RoleSkillsResult>
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
  decide: 'attention:decide',
  pause: 'notifications:pause',
  previewInstall: 'hooks:preview-install',
  previewUninstall: 'hooks:preview-uninstall',
  install: 'hooks:install',
  uninstall: 'hooks:uninstall',
  detail: 'session:detail',
  history: 'history:get',
  act: 'session:act',
  logs: 'session:logs',
  openFile: 'file:open',
  dispatch: 'composer:dispatch',
  chooseFolder: 'composer:choose-folder',
  runClaudeIn: 'composer:run-claude-in',
  listAgents: 'composer:agents',
  listTasks: 'tasks:list',
  addTask: 'tasks:add',
  updateTask: 'tasks:update',
  removeTask: 'tasks:remove',
  getEod: 'eod:get',
  listEodDays: 'eod:days',
  saveEodNotes: 'eod:notes',
  writeEod: 'eod:write',
  openEodFolder: 'eod:open-folder',
  copyText: 'app:copy-text',
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  getProfile: 'profile:get',
  chooseAvatar: 'profile:choose-avatar',
  clearAvatar: 'profile:clear-avatar',
  getDiagnostics: 'diagnostics:get',
  testNotification: 'notifications:test',
  getClaudeLink: 'claude:link',
  previewUsageTelemetry: 'claude:usage-preview',
  setUsageTelemetry: 'claude:usage-set',
  consoleStart: 'console:start',
  consoleSend: 'console:send',
  consoleStop: 'console:stop',
  consoleList: 'console:list',
  consoleHistory: 'console:history',
  consoleAllow: 'console:allow',
  consoleMcpList: 'console:mcp-list',
  consoleMcpCancel: 'console:mcp-cancel',
  consoleModels: 'console:models',
  consoleEvent: 'console:event',
  workChanged: 'work:changed',
  getSessionMeta: 'session-meta:get',
  setSessionMeta: 'session-meta:set',
  setSections: 'session-meta:sections',
  touchSessions: 'session-meta:seen',
  getOpenTargets: 'session:open-targets',
  rolesList: 'roles:list',
  rolesReload: 'roles:reload',
  rolesStatus: 'roles:status',
  rolesSearch: 'roles:search',
  rolesSuggest: 'roles:suggest',
  rolesGet: 'roles:get',
  rolesSave: 'roles:save',
  rolesDelete: 'roles:delete',
  rolesDuplicate: 'roles:duplicate',
  rolesSetPinned: 'roles:set-pinned',
  rolesSetRepo: 'roles:set-repo',
  rolesBrowseRepo: 'roles:browse-repo',
  rolesInstallSkills: 'roles:install-skills',
  rolesRemoveSkills: 'roles:remove-skills'
} as const
