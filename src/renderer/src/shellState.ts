import { canGoBack, canGoForward, pushNav, startHistory, stepNav, type NavHistory } from './lib/navHistory'
import { isStringArray, readJsonPref, readPref, writePref } from './lib/prefs'
import { DEFAULT_OPEN, RECENT_MAX } from './lib/agentsTree'
import type { ErrorInfo } from './lib/diagnostics'

/**
 * Where the window is and how it is laid out (IA § 2): the page, the open session, back and forward, whether Details and the
 * Agents panel are open, and the one crash banner. A slice of the UI store; store.ts re-exports the types.
 */

export type Page = 'new' | 'session' | 'overview' | 'tasks' | 'sessions' | 'approvals' | 'files' | 'activity' | 'report' | 'roles' | 'settings'

/**
 * Where the window is (UI_MAP § Sidebar). `session` is the open session's selection key (lib/sessionList.ts). The extras preset a
 * list page's filters: Sessions by status or project, Roles by search; `role` opens that role's detail.
 */
export interface Nav {
  page: Page
  session?: string
  active?: boolean
  project?: string
  query?: string
  role?: string
}

/** The landing page and Ctrl+N. */
export const NEW_SESSION: Nav = { page: 'new' }

/** Names the first shell used. Callers that have not moved yet may still pass them; they land on the new session screen. */
type RetiredNav = Omit<Nav, 'page'> & { page: 'home' | 'console' }
export type NavInput = Nav | RetiredNav

const isRetired = (input: NavInput): input is RetiredNav => input.page === 'home' || input.page === 'console'

export function normalizeNav(input: NavInput): Nav {
  return isRetired(input) ? { ...input, page: 'new' } : input
}

const sameNav = (a: Nav, b: Nav): boolean => JSON.stringify(a) === JSON.stringify(b)

const DETAILS_KEY = 'agentdeck.detailsOpen'
const AGENTS_KEY = 'agentdeck.agentsOpen'
const GROUP_KEY = 'agentdeck.groupByProject'
const ROLES_KEY = 'agentdeck.recentRoles'
const SECTIONS_KEY = 'agentdeck.agentSections'

/** With no choice made, Details opens on a window wide enough to give it a third column. */
export const DETAILS_AUTO_MIN_WIDTH = 1440

export function detailsOpenAt(pref: boolean | null, width: number): boolean {
  return pref ?? width >= DETAILS_AUTO_MIN_WIDTH
}

const readFlag = (key: string): boolean | null => {
  const v = readPref(key)
  return v === '1' ? true : v === '0' ? false : null
}
const writeFlag = (key: string, on: boolean): void => writePref(key, on ? '1' : '0')

export interface Crash {
  where: string
  error: ErrorInfo
  at: number
}

export interface ShellSlice {
  nav: Nav
  navHistory: NavHistory<Nav>
  /** The open session, mirrored from `nav` for code written for the drawer (the session menu closes it when the session is deleted). */
  drawer: string | null
  canBack: boolean
  canForward: boolean
  go(nav: NavInput): void
  back(): void
  forward(): void
  /** Opens a session in the main pane; null goes to the new session screen. */
  openSession(key: string | null): void
  /** Kept for the session menu's "Details" entry and old callers: opens the session in the main pane. */
  openDrawer(key: string | null): void

  /** null = no choice yet: open when the window is wide (detailsOpenAt). */
  detailsPref: boolean | null
  setDetails(open: boolean): void
  agentsOpen: boolean
  setAgentsOpen(open: boolean): void
  groupByProject: boolean
  setGroupByProject(on: boolean): void
  /** The Agents panel's open groups (Favourites and Leadership until a person changes them). */
  agentSections: string[]
  toggleAgentSection(id: string): void
  /** Bumped to put the cursor in the Agents filter (Ctrl+Shift+A). */
  agentsFocusTick: number
  focusAgentsFilter(): void
  /** Agents you started a session as lately, newest first. */
  recentRoles: string[]
  rememberRole(id: string): void

  crash: Crash | null
  reportCrash(where: string, error: ErrorInfo): void
  dismissCrash(): void
}

type Set = (partial: Partial<ShellSlice> | ((s: ShellSlice) => Partial<ShellSlice>)) => void

export function createShellSlice(set: Set, get: () => ShellSlice): ShellSlice {
  const arrive = (history: NavHistory<Nav>): Partial<ShellSlice> => {
    const nav = history.entries[history.index]!
    return { nav, navHistory: history, drawer: nav.page === 'session' ? (nav.session ?? null) : null, canBack: canGoBack(history), canForward: canGoForward(history) }
  }
  const first = startHistory(NEW_SESSION)
  return {
    nav: NEW_SESSION,
    navHistory: first,
    drawer: null,
    canBack: false,
    canForward: false,
    go: (input) => set((s) => arrive(pushNav(s.navHistory, normalizeNav(input), sameNav))),
    back: () => {
      const h = stepNav(get().navHistory, -1)
      if (h) set(arrive(h))
    },
    forward: () => {
      const h = stepNav(get().navHistory, 1)
      if (h) set(arrive(h))
    },
    openSession: (key) => get().go(key ? { page: 'session', session: key } : NEW_SESSION),
    openDrawer: (key) => get().openSession(key),

    detailsPref: readFlag(DETAILS_KEY),
    setDetails: (open) => {
      writeFlag(DETAILS_KEY, open)
      set({ detailsPref: open })
    },
    agentsOpen: readFlag(AGENTS_KEY) ?? true,
    setAgentsOpen: (open) => {
      writeFlag(AGENTS_KEY, open)
      set({ agentsOpen: open })
    },
    groupByProject: readFlag(GROUP_KEY) ?? false,
    setGroupByProject: (on) => {
      writeFlag(GROUP_KEY, on)
      set({ groupByProject: on })
    },
    agentSections: readJsonPref(SECTIONS_KEY, isStringArray, [...DEFAULT_OPEN]),
    toggleAgentSection: (id) => {
      const now = get().agentSections
      const agentSections = now.includes(id) ? now.filter((x) => x !== id) : [...now, id]
      writePref(SECTIONS_KEY, JSON.stringify(agentSections))
      set({ agentSections })
    },
    agentsFocusTick: 0,
    focusAgentsFilter: () => set((s) => ({ agentsOpen: true, agentsFocusTick: s.agentsFocusTick + 1 })),
    recentRoles: readJsonPref(ROLES_KEY, isStringArray, []).slice(0, RECENT_MAX),
    rememberRole: (id) => {
      const recentRoles = [id, ...get().recentRoles.filter((r) => r !== id)].slice(0, RECENT_MAX)
      writePref(ROLES_KEY, JSON.stringify(recentRoles))
      set({ recentRoles })
    },

    crash: null,
    // The first failure is the one worth reading; the ones it causes would only bury it.
    reportCrash: (where, error) => set((s) => (s.crash ? {} : { crash: { where, error, at: Date.now() } })),
    dismissCrash: () => set({ crash: null })
  }
}
