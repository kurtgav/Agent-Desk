import { Users } from 'lucide-react'
import type { Session } from '@shared/snapshot'
import { useUi } from '@/store'
import { projectName, recentSessions } from '@/lib/selectors'
import { pinnedFirst, shownIn } from '@/lib/sessionMeta'
import { Avatar } from './Avatar'
import { useDisplayName } from './session-menu/hooks'
import { Marks } from './session-menu/Marks'
import { MoreButton, SessionMenu } from './session-menu/SessionMenu'
import { Card, CardAction, CardHeader, EmptyState, StatusPill, cn } from './ui'

const MAX_TILES = 6

function Tile({ session }: { session: Session }) {
  const open = useUi((s) => s.openSession)
  const name = useDisplayName(session)
  return (
    <SessionMenu session={session}>
      <li className="relative min-w-0">
        <button
          type="button"
          onClick={() => open(session.id)}
          title={`${name} · ${projectName(session.cwd)}`}
          className="press flex w-full min-w-0 flex-col items-start gap-1.5 rounded-tile bg-tile p-2.5 text-left hover:bg-active group-data-[state=open]:bg-active"
        >
          <Avatar seed={session.name} size={24} />
          <span className="w-full truncate text-[13px] font-medium leading-4">
            {name}
            <Marks id={session.id} />
          </span>
          <StatusPill status={session.status} />
        </button>
        <MoreButton session={session} className="absolute right-1 top-1 size-7" />
      </li>
    </SessionMenu>
  )
}

export function YourAgents({ className }: { className?: string }) {
  const snapshot = useUi((s) => s.snapshot)
  const meta = useUi((s) => s.sessionMeta)
  // An archived session leaves this card once it is not running; pinned ones come first.
  const listed = pinnedFirst(recentSessions(snapshot, snapshot.sessions.length).filter((s) => shownIn('agents', s, meta)), meta)
  return (
    <Card aria-labelledby="your-agents" className={cn('flex flex-col', className)}>
      <CardHeader
        id="your-agents"
        title="Your agents"
        count={listed.length}
        countLabel="sessions"
        action={
          <CardAction onClick={() => useUi.getState().go({ page: 'sessions' })}>See all</CardAction>
        }
      />
      {listed.length ? (
        <ul className="grid grid-cols-3 gap-2 px-4 pb-4">
          {listed.slice(0, MAX_TILES).map((x) => (
            <Tile key={x.id} session={x} />
          ))}
        </ul>
      ) : (
        <EmptyState icon={Users}>No sessions this week. Start one in a terminal or with New task.</EmptyState>
      )}
    </Card>
  )
}
