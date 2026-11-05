import { useEffect, useRef } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { connect, useUi, type Link, type Nav } from './store'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { Composer } from './components/Composer'
import { Greeting, Kpis } from './components/Overview'
import { NeedsYou } from './components/NeedsYou'
import { RunningNow } from './components/RunningNow'
import { RecentFiles } from './components/RecentFiles'
import { YourAgents } from './components/YourAgents'
import { SessionDrawer } from './components/SessionDrawer'
import { Notice } from './components/Notice'
import { Palette, useShortcuts } from './components/Palette'
import { SessionsPage } from './components/pages/Sessions'
import { FilesPage } from './components/pages/Files'
import { ActivityPage, ApprovalsPage } from './components/pages/History'
import { AgentsPage } from './components/pages/Agents'

const TICK_MS = 30_000

/** D-059: without a collector there is no data, so Home says so instead of "All quiet". */
function NotLive({ link }: { link: Exclude<Link, 'up'> }) {
  return (
    <div role="status" className="flex min-h-full items-center justify-center px-9 py-16 text-center">
      <p className="max-w-[46ch] text-pretty text-[15px] text-ink">
        {link === 'down' ? 'The collector stopped. AgentDeck is restarting it.' : 'Starting the collector…'}
        <span className="mt-1 block text-[13px] text-muted">Your sessions appear here as soon as it runs. Claude Code is not affected.</span>
      </p>
    </div>
  )
}

function Home() {
  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-4 px-9 pb-6 pt-6">
      <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,8fr)] items-start gap-4">
        <Greeting />
        <Composer />
      </div>
      <Kpis />
      <div className="grid grid-cols-1 gap-4 min-[1280px]:grid-cols-[2fr_1fr]">
        <div className="flex min-w-0 flex-col gap-4">
          <NeedsYou />
          <RunningNow className="flex-1" />
        </div>
        <div className="grid min-w-0 grid-cols-2 content-start gap-4 min-[1280px]:flex min-[1280px]:flex-col">
          <RecentFiles />
          <YourAgents className="min-[1280px]:flex-1" />
        </div>
      </div>
    </div>
  )
}

function Content({ nav }: { nav: Nav }) {
  switch (nav.page) {
    case 'home':
      return <Home />
    case 'sessions':
      return <SessionsPage nav={nav} />
    case 'approvals':
      return <ApprovalsPage />
    case 'files':
      return <FilesPage />
    case 'activity':
      return <ActivityPage />
    case 'agents':
      return <AgentsPage nav={nav} />
  }
}

export function App() {
  const announcement = useUi((s) => s.announcement)
  const link = useUi((s) => s.link)
  const nav = useUi((s) => s.nav)
  const main = useRef<HTMLElement>(null)

  useEffect(() => {
    const id = setInterval(() => useUi.getState().tick(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => connect(), [])
  useShortcuts()
  // A new page starts at its top. A block body: scrollTo returns a Promise in current Chromium, and a returned value is taken as the cleanup.
  useEffect(() => {
    main.current?.scrollTo({ top: 0 })
  }, [nav])

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex h-screen bg-ground text-ink">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col border-l border-line">
          <TopBar />
          <main ref={main} data-testid="home" data-page={nav.page} className="min-h-0 flex-1 overflow-y-auto">
            {/* Keyed by where we are, so a page's filters start from what the link asked for. */}
            {link !== 'up' ? <NotLive link={link} /> : <Content key={JSON.stringify(nav)} nav={nav} />}
          </main>
        </div>
      </div>
      <SessionDrawer />
      <Palette />
      <Notice />
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </Tooltip.Provider>
  )
}
