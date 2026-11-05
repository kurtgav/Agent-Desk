import { useUi } from '@/store'
import { projectName, recentSessions } from '@/lib/selectors'
import { Avatar } from './Avatar'
import { Button, Card, CardHeader, Hint, PENDING_LABEL, StatusPill, cn, pending } from './ui'

const MAX_TILES = 6

export function YourAgents({ className }: { className?: string }) {
  const snapshot = useUi((s) => s.snapshot)
  const sessions = recentSessions(snapshot, MAX_TILES)
  return (
    <Card aria-labelledby="your-agents" className={cn('flex flex-col', className)}>
      <CardHeader
        id="your-agents"
        title="Your agents"
        count={snapshot.sessions.length}
        countLabel="sessions"
        action={
          <Hint label={PENDING_LABEL.M4}>
            <Button variant="ghost" size="sm" {...pending('M4')}>
              See all
            </Button>
          </Hint>
        }
      />
      {sessions.length ? (
        <ul className="grid grid-cols-3 gap-2 px-4 pb-4">
          {sessions.map((x) => (
            <li key={x.id} className="flex min-w-0 flex-col items-start gap-1.5 rounded-tile bg-tile p-2.5" title={`${x.name} · ${projectName(x.cwd)}`}>
              <Avatar seed={x.name} size={24} />
              <span className="w-full truncate text-[13px] font-medium leading-4">{x.name}</span>
              <StatusPill status={x.status} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 pb-6 pt-2 text-[13px] text-muted">No sessions this week. Start one in a terminal or with New task.</p>
      )}
    </Card>
  )
}
