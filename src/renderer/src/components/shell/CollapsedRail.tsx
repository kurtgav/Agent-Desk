import { PanelLeft, Plus, Search, ShieldAlert, Users } from 'lucide-react'
import { useUi } from '@/store'
import { findEntry, listable } from '@/lib/sessionList'
import { needsOkCount } from '@/lib/selectors'
import { Avatar, Mark } from '../Avatar'
import { SessionMenu } from '../session-menu/SessionMenu'
import { UserAvatar } from '../UserAvatar'
import { Hint, IconButton, cn } from '../ui'
import { StatusMark } from './StatusMark'
import { WORKSPACE, WorkspaceButton } from './WorkspaceRow'
import { newSession } from './actions'
import { useEntries } from './useEntries'

const RAIL_SESSIONS_MAX = 30
export const TOGGLE_ID = 'sidebar-toggle'

/**
 * The sidebar at 64 px: the same order, as icons with tooltips. New session, Search, what needs you, the sessions as faces, the
 * agents, the workspace row stacked, and you. Expanding is one click on the first icon.
 */
export function CollapsedRail({ onExpand }: { onExpand(): void }) {
  const entries = useEntries()
  const meta = useUi((s) => s.sessionMeta)
  const nav = useUi((s) => s.nav)
  const openSession = useUi((s) => s.openSession)
  const setPalette = useUi((s) => s.setPalette)
  const waiting = useUi((s) => needsOkCount(s.snapshot) + s.snapshot.attention.filter((a) => a.priority > 1).length)
  const profile = useUi((s) => s.profile)
  const sessions = listable(entries, meta).slice(0, RAIL_SESSIONS_MAX)
  const open = nav.page === 'session' ? findEntry(entries, nav.session)?.key : undefined
  const agents = (): void => {
    const ui = useUi.getState()
    ui.focusAgentsFilter()
    onExpand()
  }

  return (
    <aside id="sidebar" aria-label="Sidebar" className="flex h-full w-16 flex-none flex-col items-center bg-ground">
      {/* On macOS the traffic lights take this corner, so the mark steps aside (styles.css). */}
      <div className="app-drag flex h-12 flex-none items-center justify-center">
        <span className="traffic-hide flex">
          <Mark size={22} />
        </span>
      </div>
      <div className="flex flex-none flex-col items-center gap-1 pt-1">
        <Hint side="right" label="Expand sidebar (Ctrl B)">
          <IconButton id={TOGGLE_ID} aria-label="Expand sidebar" aria-expanded={false} aria-controls="sidebar" aria-keyshortcuts="Control+B" onClick={onExpand}>
            <PanelLeft size={16} strokeWidth={1.75} />
          </IconButton>
        </Hint>
        <Hint side="right" label="New session (Ctrl N)">
          <IconButton aria-label="New session" aria-keyshortcuts="Control+N" className="border border-control bg-surface" onClick={newSession}>
            <Plus size={16} strokeWidth={1.75} />
          </IconButton>
        </Hint>
        <Hint side="right" label="Search (Ctrl K)">
          <IconButton aria-label="Search" aria-keyshortcuts="Control+K" onClick={() => setPalette(true)}>
            <Search size={16} strokeWidth={1.75} />
          </IconButton>
        </Hint>
        {waiting > 0 && (
          <Hint side="right" label={`${waiting} need you. Open the sidebar to answer.`}>
            <IconButton aria-label={`${waiting} need you`} className="relative text-[var(--needs-ink)]" onClick={onExpand}>
              <ShieldAlert size={16} strokeWidth={1.75} />
              <span aria-hidden className="absolute right-0 top-0 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--needs-bg)] px-1 text-[11px] font-medium tabular-nums">
                {waiting}
              </span>
            </IconButton>
          </Hint>
        )}
      </div>

      <ul role="list" aria-label="Sessions" className="scroll-fade mt-2 flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto border-t border-line py-2">
        {sessions.map((e) => (
          <SessionMenu key={e.key} session={e.session}>
            <li>
              <Hint side="right" label={`${e.name}${e.project ? ` · ${e.project}` : ''}`}>
                <button
                  type="button"
                  aria-label={e.name}
                  aria-current={e.key === open ? 'page' : undefined}
                  onClick={() => openSession(e.key)}
                  className={cn('press relative grid size-10 place-items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent', e.key === open ? 'bg-active' : 'hover:bg-active/60')}
                >
                  <Avatar seed={e.session.name} size={24} />
                  <StatusMark status={e.session.status} className="absolute bottom-1 right-1 rounded-full bg-ground" />
                  {e.unread && <span aria-hidden className="absolute left-1.5 top-1.5 size-2 rounded-full bg-accent" />}
                </button>
              </Hint>
            </li>
          </SessionMenu>
        ))}
      </ul>

      <div className="flex flex-none flex-col items-center gap-0.5 border-t border-line py-2">
        <Hint side="right" label="Agents">
          <IconButton aria-label="Agents" className="size-9" onClick={agents}>
            <Users size={17} strokeWidth={1.75} />
          </IconButton>
        </Hint>
        {WORKSPACE.map((w) => (
          <WorkspaceButton key={w.page} {...w} side="right" />
        ))}
      </div>
      <div className="flex flex-none justify-center pb-3">
        <Hint side="right" label={`${profile.name}. Open settings`}>
          <button type="button" aria-label={`${profile.name}. Open settings`} onClick={() => useUi.getState().go({ page: 'settings' })} className="press rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <UserAvatar size={28} />
          </button>
        </Hint>
      </div>
    </aside>
  )
}
