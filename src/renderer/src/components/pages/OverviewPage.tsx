import { Greeting, Kpis } from '../Overview'
import { NeedsYou } from '../NeedsYou'
import { RecentFiles } from '../RecentFiles'
import { RunningNow } from '../RunningNow'
import { YourAgents } from '../YourAgents'

/**
 * The old Home dashboard, under Workspace (IA § 7): the week at a glance, then the work: what needs you first, what is running beside
 * the recent files and who ran. Landing is the new session screen now; this is one click away when you want the whole picture.
 */
export function OverviewPage() {
  return (
    <div className="mx-auto flex max-w-[1280px] flex-col px-9 pb-6 pt-6">
      <Greeting />
      <div className="mt-5">
        <Kpis />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 min-[1400px]:grid-cols-[2fr_1fr]">
        <div className="flex min-w-0 flex-col gap-4">
          <NeedsYou />
          <RunningNow className="flex-1" />
        </div>
        <div className="grid min-w-0 grid-cols-2 content-start gap-4 min-[1400px]:flex min-[1400px]:flex-col">
          <RecentFiles />
          <YourAgents className="min-[1400px]:flex-1" />
        </div>
      </div>
    </div>
  )
}
