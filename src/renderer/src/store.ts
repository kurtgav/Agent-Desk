import { create } from 'zustand'
import type { Snapshot } from '@shared/snapshot'
import { demoSnapshot } from './demo/snapshot'

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]
export type Outcome = 'approved' | 'rejected' | 'dismissed'

const SIDEBAR_KEY = 'agentdeck.sidebarCollapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1'
  } catch {
    return false
  }
}

interface UiState {
  snapshot: Snapshot
  now: number
  /** From the preload bridge; "dev" when the renderer runs in a plain browser. */
  version: string
  sidebarCollapsed: boolean
  effort: Effort
  /** cwd the composer dispatches into; null = most recent project. */
  composerCwd: string | null
  /** `--agent` choice; null = Claude Code's default. */
  composerAgent: string | null
  announcement: string
  tick(now: number): void
  toggleSidebar(): void
  cycleEffort(): void
  setComposerCwd(cwd: string): void
  setComposerAgent(agent: string | null): void
  /** Demo only (M1): answering an item removes it locally; nothing is sent anywhere. */
  resolve(itemId: string, outcome: Outcome): void
}

export const useUi = create<UiState>((set) => ({
  snapshot: demoSnapshot(Date.now()),
  now: Date.now(),
  version: 'dev',
  sidebarCollapsed: readCollapsed(),
  effort: 'high',
  composerCwd: null,
  composerAgent: null,
  announcement: '',
  tick: (now) => set({ now }),
  toggleSidebar: () =>
    set((s) => {
      const next = !s.sidebarCollapsed
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0')
      } catch {
        // per-viewer convenience only; ignore storage failures
      }
      return { sidebarCollapsed: next }
    }),
  cycleEffort: () => set((s) => ({ effort: EFFORTS[(EFFORTS.indexOf(s.effort) + 1) % EFFORTS.length]! })),
  setComposerCwd: (cwd) => set({ composerCwd: cwd }),
  setComposerAgent: (agent) => set({ composerAgent: agent }),
  resolve: (itemId, outcome) =>
    set((s) => {
      const item = s.snapshot.attention.find((a) => a.id === itemId)
      if (!item) return {}
      const attention = s.snapshot.attention.filter((a) => a.id !== itemId)
      const stillWaiting = attention.some((a) => a.sessionId === item.sessionId && a.priority === 1)
      const sessions = s.snapshot.sessions.map((x) =>
        x.id === item.sessionId && x.status === 'needs_you' && !stillWaiting && outcome !== 'dismissed'
          ? { ...x, status: 'working' as const, waitingSince: null }
          : x
      )
      return {
        snapshot: { ...s.snapshot, attention, sessions },
        announcement: `${outcome[0]!.toUpperCase()}${outcome.slice(1)} in demo: nothing was sent.`
      }
    })
}))
