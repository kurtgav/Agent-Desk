import type { Snapshot } from './snapshot'

/** What the preload exposes on `window.agentdeck` (ADR-0010: no Node in the renderer). */
export interface AppInfo {
  version: string
  /** Demo data from fixtures instead of live sessions (ADR-0011). */
  demo: boolean
}

export interface AgentDeckBridge {
  getAppInfo(): Promise<AppInfo>
  /** The latest live snapshot, or null before the collector's first one (and always in demo). */
  getSnapshot(): Promise<Snapshot | null>
  /** Live snapshots as they change (D-040), or null when the collector stopped and is restarting (D-059). Returns an unsubscribe function. */
  onSnapshot(listener: (s: Snapshot | null) => void): () => void
  /** Switches demo data on or off; the window reloads into the new mode. */
  setDemo(on: boolean): Promise<void>
}

export const IPC = {
  appInfo: 'app:info',
  setDemo: 'app:set-demo',
  snapshot: 'snapshot:get',
  snapshotPush: 'snapshot:push'
} as const
