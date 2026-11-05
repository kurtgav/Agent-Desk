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

/** Live data only: `connecting` before the collector's first snapshot, `down` while main restarts it (D-059). */
export type Link = 'connecting' | 'up' | 'down'

interface UiState {
  snapshot: Snapshot
  link: Link
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
  /** Demo only: answering an item removes it locally; nothing is sent anywhere (D-035). */
  resolve(itemId: string, outcome: Outcome): void
}

/** Live mode before the collector's first snapshot: nothing to show yet, and no made-up numbers. */
export function emptySnapshot(now: number): Snapshot {
  return {
    mode: 'live',
    generatedAt: now,
    awaySince: null,
    awayUntil: null,
    sessions: [],
    attention: [],
    files: [],
    week: { agentTimeMs: 0, agentTimeLastWeekMs: 0, finishedTurns: [] },
    usage: null,
    recentAgentTypes: [],
    agentDefinitionCount: 0
  }
}

/**
 * Picks the data source once at startup (ADR-0011): demo fixtures, or live snapshots pushed by main (D-040).
 * Without the preload bridge (renderer in a plain browser) there is no collector, so it shows demo data.
 */
export function connect(): () => void {
  const bridge = window.agentdeck
  if (!bridge) {
    useUi.setState({ snapshot: demoSnapshot(Date.now()), link: 'up' })
    return () => undefined
  }
  let live = true
  let pushed = false
  const off = bridge.onSnapshot((snapshot) => {
    pushed = true
    if (!live) return
    useUi.setState(snapshot ? { snapshot, link: 'up' } : { snapshot: emptySnapshot(Date.now()), link: 'down' })
  })
  void bridge
    .getAppInfo()
    .then(async (info) => {
      useUi.setState({ version: info.version })
      if (info.demo) {
        live = false
        useUi.setState({ snapshot: demoSnapshot(Date.now()), link: 'up' })
        return
      }
      const snapshot = await bridge.getSnapshot()
      // A push may have landed while this was in flight, and it is newer than main's cached copy.
      if (snapshot && !pushed) useUi.setState({ snapshot, link: 'up' })
    })
    .catch(() => undefined)
  return off
}

export const useUi = create<UiState>((set) => ({
  snapshot: emptySnapshot(Date.now()),
  link: 'connecting',
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
      if (!item || s.snapshot.mode !== 'demo') return {} // live answers arrive with M4
      const attention = s.snapshot.attention.filter((a) => a.id !== itemId)
      const stillWaiting = attention.some((a) => a.sessionId === item.sessionId && a.priority === 1)
      const sessions = s.snapshot.sessions.map((x) =>
        x.id === item.sessionId && x.status === 'needs_you' && !stillWaiting && outcome !== 'dismissed'
          ? { ...x, status: 'working' as const, waitingSince: null, activity: 'Continuing after your answer' }
          : x
      )
      // Naming the item keeps consecutive announcements distinct, so screen readers speak each one.
      const what = item.title.replace(/`/g, '')
      return {
        snapshot: { ...s.snapshot, attention, sessions },
        announcement: `${outcome[0]!.toUpperCase()}${outcome.slice(1)} in demo: ${what}. Nothing was sent.`
      }
    })
}))
