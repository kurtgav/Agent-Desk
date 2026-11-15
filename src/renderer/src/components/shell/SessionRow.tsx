import { useState } from 'react'
import { useUi } from '@/store'
import { shortAgo, type SessionEntry } from '@/lib/sessionList'
import { MoreButton, SessionMenu } from '../session-menu/SessionMenu'
import { cn } from '../ui'
import { StatusMark } from './StatusMark'

export const ROW_HEIGHT = 32

interface Props {
  entry: SessionEntry
  current: boolean
  now: number
  /** Position among the focusable rows, for the screen reader ("3 of 12"). */
  row: number
  tabIndex: 0 | -1
}

/**
 * One session in the sidebar, on one line: its status, the name you gave it (or Claude Code's), and its age. Unread is a bolder name.
 * The folder, the agent and "started elsewhere" are in the tooltip and the session's own header, not on the row. Right-click, the Menu
 * key, Shift+F10 and the ⋯ button open the session menu.
 */
export function SessionRow({ entry, current, now, row, tabIndex }: Props) {
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
          <span className="grid size-4 flex-none place-items-center">
            <StatusMark status={session.status} />
          </span>
          <span className={cn('min-w-0 flex-1 truncate text-[14px] leading-5', entry.unread ? 'font-semibold text-ink' : 'text-ink/80')}>
            {entry.name}
            {entry.unread && <span className="sr-only"> (unread)</span>}
          </span>
          <span className={cn('w-7 flex-none pr-1 text-right text-[12px] tabular-nums text-muted', hot && 'invisible')}>{shortAgo(entry.at, now)}</span>
        </button>
        {/* Only the row you point at or have focus on carries a ⋯ button, so a long list is not a column of extra tab stops. */}
        {hot && <MoreButton session={session} className="absolute right-1 top-1/2 size-7 -translate-y-1/2 opacity-100 group-hover:opacity-100" />}
      </li>
    </SessionMenu>
  )
}
