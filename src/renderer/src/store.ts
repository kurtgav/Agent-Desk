import { create } from 'zustand'
import { EFFORTS, type AgentDeckBridge, type AppStatus, type Effort } from '@shared/bridge'
import { EMPTY_META, applyPatch, applySectionOp, type SectionOp, type SessionMetaPatch, type SessionMetaResult, type SessionMetaState } from '@shared/session-meta'
import type { Snapshot } from '@shared/snapshot'
import { resolveTheme, type ResolvedTheme } from '@shared/theme'
import { DEFAULT_PROFILE_NAME, type Profile, type ThemeChoice } from '@shared/work'
import { paintTheme, readStoredChoice, systemPrefersDark, watchSystemTheme, writeStoredChoice } from './lib/theme'
import { markPlatform } from './lib/platform'
import { demoSessionMeta, demoSnapshot } from './demo/snapshot'
import type { IntegrationMode } from './components/Integration'
import { createShellSlice, type ShellSlice } from './shellState'

export { DETAILS_AUTO_MIN_WIDTH, NEW_SESSION, detailsOpenAt, normalizeNav } from './shellState'
export type { Crash, Nav, NavInput, Page } from './shellState'

export type Outcome = 'approved' | 'rejected' | 'dismissed'

const SIDEBAR_KEY = 'agentdeck.sidebarCollapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1'
  } catch {
    return false
  }
}

/** The choice is mirrored in localStorage, so it is known before main answers (public/theme-boot.js painted it already). */
const initialTheme: ThemeChoice = readStoredChoice() ?? 'system'

function showTheme(choice: ThemeChoice): void {
  const resolvedTheme = resolveTheme(choice, systemPrefersDark())
  paintTheme(resolvedTheme)
  writeStoredChoice(choice)
  useUi.setState({ theme: choice, resolvedTheme })
}

/** Set once the person picks a theme in this run: a late answer from main must not undo it. */
let themeChosen = false

/** Follows the OS while the choice is `system`, and takes main's stored choice once it answers (it wins over the mirror: AGENTDECK_THEME, a hand-edited config). */
function syncTheme(): () => void {
  let live = true
  themeChosen = false
  const stop = watchSystemTheme(() => showTheme(useUi.getState().theme))
  const bridge = window.agentdeck
  if (bridge) {
    void (async () => {
      try {
        const { theme } = await bridge.getSettings()
        if (live && !themeChosen) showTheme(theme)
      } catch {
        // keep the mirrored choice
      }
    })()
  }
  return () => {
    live = false
    stop()
  }
}

/** Changes that main has not answered yet: only the last answer is shown, so an older one never undoes a newer change. */
let metaInFlight = 0
/** Tells main which sessions with notes a snapshot lists, so their notes stay another 90 days; at most this often. */
const SEEN_SEND_MS = 30 * 60_000
let seenSentAt = 0

/**
 * Shows `local` (the change worked out in the window) now and, live, has main save it. When main refuses or fails, what main
 * holds is shown again and the sentence comes back. Resolves to null when it worked.
 */
async function commitMeta(local: SessionMetaResult, save: (bridge: AgentDeckBridge) => Promise<SessionMetaResult>): Promise<string | null> {
  if (!local.ok) return local.error
  useUi.setState({ sessionMeta: local.state })
  const bridge = window.agentdeck
  if (!bridge || useUi.getState().snapshot.mode === 'demo') return null
  metaInFlight++
  let answer: SessionMetaResult
  try {
    answer = await save(bridge)
  } catch {
    answer = { ok: false, error: 'AgentDeck could not save that. Try again.' }
  } finally {
    metaInFlight--
  }
  if (answer.ok) {
    if (metaInFlight === 0) useUi.setState({ sessionMeta: answer.state })
    return null
  }
  const held = await bridge.getSessionMeta().catch(() => null)
  if (held && metaInFlight === 0) useUi.setState({ sessionMeta: held })
  return answer.error
}

function tellSeen(snapshot: Snapshot): void {
  const notes = useUi.getState().sessionMeta.sessions
  const ids = snapshot.sessions.map((s) => s.id).filter((id) => Object.hasOwn(notes, id))
  if (!ids.length || Date.now() - seenSentAt < SEEN_SEND_MS) return
  seenSentAt = Date.now()
  void window.agentdeck?.touchSessions(ids).catch(() => undefined)
}

/** Live data only: `connecting` before the collector's first snapshot, `down` while main restarts it (D-059). */
export type Link = 'connecting' | 'up' | 'down'

/** Sample data speaks for the sample user (D-014); main supplies the same name in demo mode. */
export const DEMO_PROFILE: Profile = { name: 'Kurt', avatar: null }

interface UiState extends ShellSlice {
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
  /** The role (a roles catalog id) the next conversation or task starts as; null = no role. Set from the Roles page. */
  role: string | null
  setRole(role: string | null): void
  announcement: string
  /** Hooks and notification state from main; null in demo and before main answers. */
  status: AppStatus | null
  /** Name and photo (Settings › Profile); loaded in `connect`, replaced after each change. */
  profile: Profile
  setProfile(profile: Profile): void
  /** Local notes about sessions: pinned, unread, a display name, archived, a section (lib/sessionMeta.ts reads them). Demo keeps them in memory only. */
  sessionMeta: SessionMetaState
  /** Shows the change at once; live mode then saves it in main. A refusal puts things back and says why in the notice. */
  setSessionMeta(sessionId: string, patch: SessionMetaPatch): void
  /** Adds, renames or deletes a section. Resolves to a sentence when it was refused, for the dialog to show. */
  changeSections(op: SectionOp): Promise<string | null>
  /** Light, dark or follow the OS (Settings › Appearance, the top bar's theme button), and what that is right now. */
  theme: ThemeChoice
  resolvedTheme: ResolvedTheme
  /** Applies the choice at once and saves it in main; resolves to a sentence when main could not save it. */
  setTheme(choice: ThemeChoice): Promise<string | null>
  /** A toast was clicked: Needs you reveals this item. */
  focusedItem: string | null
  /** The outcome of the last action, shown briefly at the bottom of the window. */
  notice: { text: string; tone: 'ok' | 'error'; at: number } | null
  /** The Ctrl+K command palette. */
  palette: boolean
  /** The ⋯ menu's install / uninstall dialog, also opened from the palette. */
  integration: IntegrationMode | null
  setPalette(open: boolean): void
  setIntegration(mode: IntegrationMode | null): void
  tick(now: number): void
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
  const stopTheme = syncTheme()
  if (!bridge) {
    useUi.setState({ snapshot: demoSnapshot(Date.now()), sessionMeta: demoSessionMeta(), link: 'up', profile: DEMO_PROFILE })
    return stopTheme
  }
  let live = true
  let pushed = false
  let statusPushed = false
  const offs = [
    bridge.onSnapshot((snapshot) => {
      pushed = true
      if (!live) return
      useUi.setState(snapshot ? { snapshot, link: 'up' } : { snapshot: emptySnapshot(Date.now()), link: 'down' })
      if (snapshot) tellSeen(snapshot)
    }),
    bridge.onStatus((status) => {
      statusPushed = true
      if (live) useUi.setState({ status })
    }),
    // Needs you lives in the sidebar on every page, so a clicked toast only has to make sure the sidebar is open to reveal its row.
    bridge.onFocusItem((id) => useUi.setState({ focusedItem: id, sidebarCollapsed: false }))
  ]
  // Apart from the rest of the start-up, so a profile that can't be read never blocks the snapshot.
  void bridge
    .getProfile()
    .then((profile) => useUi.setState({ profile }))
    .catch(() => undefined)
  void bridge
    .getAppInfo()
    .then(async (info) => {
      markPlatform(info.platform)
      useUi.setState({ version: info.version })
      if (info.demo) {
        live = false
        useUi.setState({ snapshot: demoSnapshot(Date.now()), sessionMeta: demoSessionMeta(), link: 'up' })
        return
      }
      // Apart from the snapshot, like the profile: notes that can't be read never hold up the sessions.
      void (async () => {
        try {
          const sessionMeta = await bridge.getSessionMeta()
          if (live) useUi.setState({ sessionMeta })
          tellSeen(useUi.getState().snapshot)
        } catch {
          // no notes this run
        }
      })()
      const [snapshot, status] = await Promise.all([bridge.getSnapshot(), bridge.getStatus()])
      // A push may have landed while these were in flight, and it is newer than main's cached copy.
      if (snapshot && !pushed) useUi.setState({ snapshot, link: 'up' })
      if (!statusPushed) useUi.setState({ status })
    })
    .catch(() => undefined)
  return () => {
    offs.forEach((off) => off())
    stopTheme()
  }
}

export const useUi = create<UiState>((set, get) => ({
  ...createShellSlice(set, get),
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
  profile: { name: DEFAULT_PROFILE_NAME, avatar: null },
  setProfile: (profile) => set({ profile }),
  sessionMeta: EMPTY_META,
  setSessionMeta: (id, patch) => {
    void commitMeta(applyPatch(get().sessionMeta, id, patch, Date.now()), (b) => b.setSessionMeta(id, patch)).then((error) => error && get().notify(error, 'error'))
  },
  changeSections: (op) => commitMeta(applySectionOp(get().sessionMeta, op, Date.now()), (b) => b.setSections(op)),
  theme: initialTheme,
  resolvedTheme: resolveTheme(initialTheme, systemPrefersDark()),
  setTheme: async (choice) => {
    themeChosen = true
    showTheme(choice)
    try {
      await window.agentdeck?.updateSettings({ theme: choice })
      return null
    } catch {
      return 'AgentDeck could not save that theme choice. Try again.'
    }
  },
  focusedItem: null,
  notice: null,
  palette: false,
  integration: null,
  setPalette: (palette) => set({ palette }),
  setIntegration: (integration) => set({ integration }),
  tick: (now) => set({ now }),
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
  role: null,
  setRole: (role) => set({ role }),
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
