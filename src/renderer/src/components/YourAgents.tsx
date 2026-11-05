import { useUi } from '@/store'
import { projectName, recentSessions } from '@/lib/selectors'
import { Avatar } from './Avatar'
import { Button, Card, CardHeader, StatusPill, cn } from './ui'

const MAX_TILES = 6

export function YourAgents({ className }: { className?: string }) {
  const snapshot = useUi((s) => s.snapshot)
  const sessions = recentSessions(snapshot, MAX_TILES)
  const open = useUi((s) => s.openDrawer)
  return (
    <Card aria-labelledby="your-agents" className={cn('flex flex-col', className)}>
      <CardHeader
        id="your-agents"
        title="Your agents"
        count={snapshot.sessions.length}
        countLabel="sessions"
        action={
          <Button variant="ghost" size="sm" onClick={() => useUi.getState().go({ page: 'sessions' })}>
            See all
          </Button>
        }
      />
      {sessions.length ? (
        <ul className="grid grid-cols-3 gap-2 px-4 pb-4">
          {sessions.map((x) => (
            <li key={x.id} className="min-w-0">
              <button
                type="button"
                onClick={() => open(x.id)}
                title={`${x.name} · ${projectName(x.cwd)}`}
                className="flex w-full min-w-0 flex-col items-start gap-1.5 rounded-tile bg-tile p-2.5 text-left transition-[background-color] duration-150 hover:bg-active active:scale-[0.96] motion-reduce:active:scale-100"
              >
                <Avatar seed={x.name} size={24} />
                <span className="w-full truncate text-[13px] font-medium leading-4">{x.name}</span>
                <StatusPill status={x.status} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 pb-6 pt-2 text-[13px] text-muted">No sessions this week. Start one in a terminal or with New task.</p>
      )}
    </Card>
  )
}
