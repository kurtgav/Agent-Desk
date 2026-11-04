/** What the preload exposes on `window.agentdeck` (ADR-0010: no Node in the renderer). */
export interface AppInfo {
  version: string
  /** M1 always runs on demo data (ADR-0011). */
  demo: boolean
}

export interface AgentDeckBridge {
  getAppInfo(): Promise<AppInfo>
}

export const IPC = { appInfo: 'app:info' } as const
