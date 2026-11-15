import { useConsole } from '../console/store'
import { ThreadView } from '../console/ThreadView'
import { EmptyState, Skeleton } from '../ui'

/** A session AgentDeck started: its conversation, as the Console showed it (messages, collapsed thinking, tool cards, turn footers). */
export function HereBody({ conv }: { conv: string }) {
  const view = useConsole((s) => s.convs[conv])
  if (!view) return <EmptyState center className="flex-1">This conversation is not here any more. AgentDeck keeps conversations in memory only, so they end when it quits.</EmptyState>
  if (!view.loaded && view.thread.items.length === 0) {
    return (
      <div role="status" aria-label="Loading the conversation" className="mx-auto flex w-full max-w-[760px] flex-col gap-3 px-8 pt-8">
        <Skeleton className="h-10" />
        <Skeleton className="h-5 w-5/6" />
        <Skeleton className="h-5 w-4/6" />
      </div>
    )
  }
  return <ThreadView id={conv} thread={view.thread} cwd={view.info.cwd} />
}
