import { useEffect } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { useUi } from './store'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { Composer, Greeting, Kpis } from './components/Overview'
import { NeedsYou } from './components/NeedsYou'
import { RunningNow } from './components/RunningNow'
import { RecentFiles } from './components/RecentFiles'
import { YourAgents } from './components/YourAgents'

const TICK_MS = 30_000

export function App() {
  const announcement = useUi((s) => s.announcement)

  useEffect(() => {
    const id = setInterval(() => useUi.getState().tick(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    // The bridge is absent when the renderer runs in a plain browser (vite dev).
    window.agentdeck
      ?.getAppInfo()
      .then((info) => useUi.setState({ version: info.version }))
      .catch(() => undefined)
  }, [])

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex h-screen bg-ground text-ink">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col border-l border-line">
          <TopBar />
          <main data-testid="home" className="min-h-0 flex-1 overflow-y-auto">
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
          </main>
        </div>
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </Tooltip.Provider>
  )
}
