import type { AttentionKind, Session } from '@shared/snapshot'
import { useUi } from '@/store'
import { ago } from '@/lib/format'
import { projectName } from '@/lib/selectors'
import { Avatar } from '../Avatar'
import { Chip } from '../pages/kit'
import { useDisplayName } from '../session-menu/hooks'
import { Marks } from '../session-menu/Marks'
import { MoreButton, SessionMenu } from '../session-menu/SessionMenu'
import { LiveLine } from './LiveLine'

/**
 * A session no task owns, in the lane for its state: an agent working on its own. It looks different from a task on
 * purpose (the agent's avatar where a task has its checkbox, a status pill, no task actions), and the whole row
 * opens the session, the way Running now does.
 */
export function AgentRow({ session, now, reason }: { session: Session; now: number; reason?: AttentionKind | null }) {
  const open = useUi((s) => s.openSession)
  const name = useDisplayName(session)
  return (
    <SessionMenu session={session}>
      <li className="border-t border-rule px-4 py-2.5">
        <div className="relative -mx-2 flex items-start gap-3 rounded-tile px-2 has-[button:hover]:bg-hover">
          <Avatar seed={session.name} size={28} className="mt-0.5 flex-none" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-medium leading-5">
              <button type="button" onClick={() => open(session.id)} className="text-left outline-none after:absolute after:inset-0 after:rounded-tile focus-visible:after:ring-2 focus-visible:after:ring-accent">
                {name}
              </button>
              <Marks id={session.id} />
            </p>
            <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 text-[12px] leading-5 tabular-nums text-muted">
              <Chip title={session.cwd || undefined} className="max-w-[11rem]">
                {projectName(session.cwd) || 'Folder unknown'}
              </Chip>
              <span className="min-w-0 [overflow-wrap:anywhere]">Agent session · {ago(now - session.lastEventAt)}</span>
            </p>
            <LiveLine session={session} reason={reason} />
          </div>
          <MoreButton session={session} className="-mr-1 -mt-0.5 flex-none" />
        </div>
      </li>
    </SessionMenu>
  )
}
