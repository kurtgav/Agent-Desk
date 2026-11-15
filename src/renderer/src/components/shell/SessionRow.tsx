import { useState } from 'react'
import type { RoleSummary } from '@shared/roles'
import { useUi } from '@/store'
import { shortAgo, type SessionEntry } from '@/lib/sessionList'
import { Avatar } from '../Avatar'
import { MoreButton, SessionMenu } from '../session-menu/SessionMenu'
import { cn } from '../ui'
import { StatusMark } from './StatusMark'

export const ROW_HEIGHT = 40

interface Props {
  entry: SessionEntry
  current: boolean
  now: number
  role: RoleSummary | undefined
  /** Position among the focusable rows, for the screen reader ("3 of 12"). */
  row: number
  tabIndex: 0 | -1
}

/**
 * One session in the sidebar: mascot, the name you gave it (or Claude Code's), the agent it runs as, its status and its age. One that
 * AgentDeck only watches says so, quietly, under the name. Right-click, the Menu key, Shift+F10 and the ⋯ button open the session menu.
 */
export function SessionRow({ entry, current, now, role, row, tabIndex }: Props) {
  const open = useUi((s) => s.openSession)
  const [hot, setHot] = useState(false)
  const { session } = entry
  const where = entry.project || 'No folder'
  return (
    <SessionMenu session={session}>
      <li
        data-row={row}
        onMouseEnter={() => setHot(true)}
        onMouseLeave={() => setHot(false)}
        onFocus={() => setHot(true)}
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setHot(false)}
        style={{ height: ROW_HEIGHT }}
        className={cn('group relative flex items-center rounded-lg transition-colors', current ? 'bg-active' : 'hover:bg-active/60')}
      >
        <button
          type="button"
          data-focus
          tabIndex={tabIndex}
          aria-current={current ? 'page' : undefined}
          onClick={() => open(entry.key)}
          title={`${entry.name} · ${where}${entry.origin === 'watching' ? ' · started elsewhere, watched here' : ''}`}
          className="flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Avatar seed={session.name} size={22} className="flex-none" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className={cn('truncate text-[13px] leading-[18px]', entry.unread ? 'font-semibold' : 'font-medium')}>{entry.name}</span>
              {role && (
                <span aria-label={role.name} title={role.name} className="flex-none text-[12px] leading-none">
                  {role.emoji}
                </span>
              )}
              {entry.unread && (
                <>
                  <span aria-hidden className="size-1.5 flex-none rounded-full bg-accent" />
                  <span className="sr-only">Unread</span>
                </>
              )}
            </span>
            <span className="flex items-center gap-1.5 text-[12px] leading-4 text-muted">
              <span className="truncate">{where}</span>
              {entry.origin === 'watching' && <span className="flex-none rounded-md bg-well px-1 text-[11px] leading-4">Watching</span>}
            </span>
          </span>
          <span className={cn('flex flex-none items-center gap-1.5 pr-1', hot && 'invisible')}>
            <StatusMark status={session.status} />
            <span className="w-7 text-right text-[12px] tabular-nums text-muted">{shortAgo(entry.at, now)}</span>
          </span>
        </button>
        {/* Only the row you point at or have focus on carries a ⋯ button, so a long list is not a column of extra tab stops. */}
        {hot && <MoreButton session={session} className="absolute right-1 top-1/2 size-7 -translate-y-1/2 opacity-100 group-hover:opacity-100" />}
      </li>
    </SessionMenu>
  )
}
