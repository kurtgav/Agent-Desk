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
  uninstall: 'hooks:uninstall'
} as const
