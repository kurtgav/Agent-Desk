import { create } from 'zustand'
import { EFFORTS, type AppStatus, type Effort } from '@shared/bridge'
import type { Snapshot } from '@shared/snapshot'
import { demoSnapshot } from './demo/snapshot'
import type { IntegrationMode } from './components/Integration'

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

export type Page = 'home' | 'sessions' | 'approvals' | 'files' | 'activity' | 'agents'
/** Where the window is (UI_MAP § Sidebar). The extras preset a list page's filters: Sessions by status or project, Agents by name. */
export interface Nav {
  page: Page
  active?: boolean
  project?: string
  query?: string
}
export const HOME: Nav = { page: 'home' }

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
  /** The composer's draft. */
  composerText: string
  setComposerText(text: string): void
  announcement: string
  /** Hooks and notification state from main; null in demo and before main answers. */
  status: AppStatus | null
  /** A toast was clicked: Needs you reveals this item. */
  focusedItem: string | null
  /** Session shown in the drawer (UI_MAP § Session drawer); null = closed. */
  drawer: string | null
  /** The outcome of the last action, shown briefly at the bottom of the window. */
  notice: { text: string; tone: 'ok' | 'error'; at: number } | null
  nav: Nav
  /** The Ctrl+K command palette. */
  palette: boolean
  /** The ⋯ menu's install / uninstall dialog, also opened from the palette. */
  integration: IntegrationMode | null
  go(nav: Nav): void
  setPalette(open: boolean): void
  setIntegration(mode: IntegrationMode | null): void
  tick(now: number): void
  openDrawer(sessionId: string | null): void
  notify(text: string, tone?: 'ok' | 'error'): void
  toggleSidebar(): void
  cycleEffort(): void
  setComposerCwd(cwd: string): void
  setComposerAgent(agent: string | null): void
  focusItem(id: string | null): void
  /**
   * Live: Dismiss goes to the attention engine; the next snapshot drops the item. Live Approve/Reject go through
   * `answerItem` (lib/act). Demo: answering removes the item locally; nothing is sent anywhere (D-035).
   */
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
  let statusPushed = false
  const offs = [
    bridge.onSnapshot((snapshot) => {
      pushed = true
      if (!live) return
      useUi.setState(snapshot ? { snapshot, link: 'up' } : { snapshot: emptySnapshot(Date.now()), link: 'down' })
    }),
    bridge.onStatus((status) => {
      statusPushed = true
      if (live) useUi.setState({ status })
    }),
    // Needs you lives on Home, so a clicked toast goes there to reveal its row.
    bridge.onFocusItem((id) => useUi.setState({ focusedItem: id, nav: HOME, drawer: null }))
  ]
  void bridge
    .getAppInfo()
    .then(async (info) => {
      useUi.setState({ version: info.version })
      if (info.demo) {
        live = false
        useUi.setState({ snapshot: demoSnapshot(Date.now()), link: 'up' })
        return
      }
      const [snapshot, status] = await Promise.all([bridge.getSnapshot(), bridge.getStatus()])
      // A push may have landed while these were in flight, and it is newer than main's cached copy.
      if (snapshot && !pushed) useUi.setState({ snapshot, link: 'up' })
      if (!statusPushed) useUi.setState({ status })
    })
    .catch(() => undefined)
  return () => offs.forEach((off) => off())
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
  composerText: '',
  setComposerText: (composerText) => set({ composerText }),
  announcement: '',
  status: null,
  focusedItem: null,
  drawer: null,
  notice: null,
  nav: HOME,
  palette: false,
  integration: null,
  go: (nav) => set({ nav, drawer: null }), // the palette can navigate from over the drawer
  setPalette: (palette) => set({ palette }),
  setIntegration: (integration) => set({ integration }),
  tick: (now) => set({ now }),
  openDrawer: (sessionId) => set({ drawer: sessionId }),
  notify: (text, tone = 'ok') => set({ notice: { text, tone, at: Date.now() } }),
  focusItem: (id) => set({ focusedItem: id }),
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
      if (s.snapshot.mode !== 'demo') {
        if (outcome === 'dismissed' && item.priority > 1) void window.agentdeck?.dismiss(itemId).catch(() => undefined)
        return { announcement: outcome === 'dismissed' ? `Dismissed: ${item.title.replace(/`/g, '')}` : '' }
      }
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
