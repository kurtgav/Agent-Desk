import { useEffect, useRef } from 'react'
import { useUi, type Link, type Nav } from '@/store'
import { findEntry } from '@/lib/sessionList'
import { PAGE_TITLE } from '../pages/Page'
import { ActivityPage, ApprovalsPage } from '../pages/History'
import { EodPage } from '../pages/Eod'
import { FilesPage } from '../pages/Files'
import { OverviewPage } from '../pages/OverviewPage'
import { RolesPage } from '../pages/Roles'
import { SessionsPage } from '../pages/Sessions'
import { SettingsPage } from '../pages/Settings'
import { TasksPage } from '../pages/Tasks'
import { DetailsPanel } from '../session/DetailsPanel'
import { SessionPane } from '../session/SessionPane'
import { Sidebar } from '../Sidebar'
import { TopBar } from '../TopBar'
import { ErrorBoundary, RootErrors } from './ErrorBoundary'
import { NewSession } from './NewSession'
import { useConsoleSync } from './useConsoleSync'
import { useDetailsOpen } from './useDetailsOpen'
import { useEntries } from './useEntries'
import { useShortcuts } from './useShortcuts'

/** D-059: without a collector there is no data, so a data page says so instead of "All quiet". */
function NotLive({ link }: { link: Exclude<Link, 'up'> }) {
  return (
    <div role="status" className="flex min-h-full items-center justify-center px-9 py-16 text-center">
      <p className="max-w-[46ch] text-pretty text-[15px] font-medium text-ink">
        {link === 'down' ? 'The collector stopped. AgentDeck is restarting it.' : 'Starting the collector…'}
        <span className="mt-1.5 block text-[13px] font-normal text-muted">Your sessions appear here as soon as it runs. Claude Code is not affected.</span>
      </p>
    </div>
  )
}

/** The pages that read the collector's data. The new session screen, a session, Agents and Settings work without it. */
const NEEDS_COLLECTOR = new Set<Nav['page']>(['overview', 'tasks', 'sessions', 'approvals', 'files', 'activity', 'report'])

function Page({ nav }: { nav: Nav }) {
  switch (nav.page) {
    case 'new':
      return <NewSession />
    case 'session':
      return <SessionPane sessionKey={nav.session ?? ''} />
    case 'overview':
      return <OverviewPage />
    case 'tasks':
      return <TasksPage />
    case 'sessions':
      return <SessionsPage nav={nav} />
    case 'approvals':
      return <ApprovalsPage />
    case 'files':
      return <FilesPage />
    case 'activity':
      return <ActivityPage />
    case 'report':
      return <EodPage />
    case 'roles':
      return <RolesPage nav={nav} />
    case 'settings':
      return <SettingsPage />
  }
}

/** The listeners the frame owns: shortcuts, and keeping the Console's composer on the session that is open. */
function FrameEffects(): null {
  useShortcuts()
  useConsoleSync()
  return null
}

/** The open session's Details, beside it, when it is open. */
function Details() {
  const nav = useUi((s) => s.nav)
  const open = useDetailsOpen()
  const entry = findEntry(useEntries(), nav.session)
  return nav.page === 'session' && open && entry ? (
    <ErrorBoundary where="Details" resetKey={entry.key}>
      <DetailsPanel entry={entry} />
    </ErrorBoundary>
  ) : null
}

/**
 * The frame, the same on every page (IA § 2): the sidebar, then a top bar over the main pane and, for a session, its Details panel.
 * Each page and the session sit under their own error boundary, so one that fails shows a recovery card and the rest of the window
 * keeps working.
 */
export function Frame() {
  const nav = useUi((s) => s.nav)
  const link = useUi((s) => s.link)
  const main = useRef<HTMLElement>(null)
  // A new page starts at its top. A block body: scrollTo returns a Promise in current Chromium, and a returned value is taken as the cleanup.
  useEffect(() => {
    main.current?.scrollTo({ top: 0 })
  }, [nav])
  const gated = link !== 'up' && NEEDS_COLLECTOR.has(nav.page)
  const session = nav.page === 'session'

  return (
    <div className="flex h-screen bg-ground text-ink">
      <FrameEffects />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col border-l border-line">
        <TopBar />
        <RootErrors />
        <div className="flex min-h-0 flex-1">
          {/* Keyed by where we are, so a page's filters start from what the link asked for. */}
          <main ref={main} data-testid="home" data-page={nav.page} className={session ? 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden' : 'min-h-0 min-w-0 flex-1 overflow-y-auto'}>
            <ErrorBoundary where={session ? 'This session' : PAGE_TITLE[nav.page]} resetKey={JSON.stringify(nav)}>
              {gated ? <NotLive link={link as Exclude<Link, 'up'>} /> : <Page key={JSON.stringify(nav)} nav={nav} />}
            </ErrorBoundary>
          </main>
          <Details />
        </div>
      </div>
    </div>
  )
}
