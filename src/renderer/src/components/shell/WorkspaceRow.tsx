import { Activity, FileText, Files, LayoutDashboard, ListChecks, Settings, ShieldCheck, Users, type LucideIcon } from 'lucide-react'
import { useUi, type Page } from '@/store'
import { needsOkCount } from '@/lib/selectors'
import { Hint, cn } from '../ui'

export const WORKSPACE: { page: Page; label: string; icon: LucideIcon }[] = [
  { page: 'tasks', label: 'Tasks', icon: ListChecks },
  { page: 'approvals', label: 'Approvals', icon: ShieldCheck },
  { page: 'report', label: 'Daily report', icon: FileText },
  { page: 'roles', label: 'Agents', icon: Users },
  { page: 'files', label: 'Files', icon: Files },
  { page: 'activity', label: 'Activity', icon: Activity },
  { page: 'overview', label: 'Overview', icon: LayoutDashboard },
  { page: 'settings', label: 'Settings', icon: Settings }
]

/** One icon of the workspace row: the page it opens, its name on hover and focus, an amber count when it holds something that waits. */
export function WorkspaceButton({ page, label, icon: Icon, side }: { page: Page; label: string; icon: LucideIcon; side: 'top' | 'right' }) {
  const current = useUi((s) => s.nav.page === page)
  const go = useUi((s) => s.go)
  const waiting = useUi((s) => (page === 'approvals' ? needsOkCount(s.snapshot) : 0))
  const keys = page === 'roles' ? ' (Ctrl Shift A)' : ''
  return (
    <Hint side={side} label={waiting ? `${label}, ${waiting} waiting` : `${label}${keys}`}>
      <button
        type="button"
        aria-label={waiting ? `${label}, ${waiting} open` : label}
        aria-current={current ? 'page' : undefined}
        aria-keyshortcuts={page === 'roles' ? 'Control+Shift+A' : undefined}
        onClick={() => go({ page })}
        className={cn(
          'press relative grid size-9 flex-none place-items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent',
          current ? 'bg-active text-ink' : 'text-muted hover:bg-active/60 hover:text-ink'
        )}
      >
        <Icon size={17} strokeWidth={1.75} aria-hidden />
        {waiting > 0 && (
          <span aria-hidden className="absolute right-0.5 top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--needs-bg)] px-1 text-[11px] font-medium tabular-nums text-[var(--needs-ink)]">
            {waiting}
          </span>
        )}
      </button>
    </Hint>
  )
}

/**
 * The pages, as a plain labelled list under New session: an icon and a name on each row, the open page on a grey pill. Settings
 * sits at the foot of the sidebar. What waits on you has its own list below, so no row here carries a count.
 */
export function WorkspaceRow() {
  const page = useUi((s) => s.nav.page)
  const go = useUi((s) => s.go)
  return (
    <nav aria-label="Workspace" className="flex-none px-2.5 pt-3">
      <ul className="flex flex-col gap-0.5">
        {WORKSPACE.filter((w) => w.page !== 'settings').map(({ page: to, label, icon: Icon }) => (
          <li key={to}>
            <button
              type="button"
              aria-current={page === to ? 'page' : undefined}
              aria-keyshortcuts={to === 'roles' ? 'Control+Shift+A' : undefined}
              onClick={() => go({ page: to })}
              className={cn(
                'press flex h-8 w-full items-center [@media(max-height:820px)]:h-7 gap-2.5 rounded-lg px-2 text-left text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-accent',
                page === to ? 'bg-active font-medium text-ink' : 'text-ink/80 hover:bg-active/60 hover:text-ink'
              )}
            >
              <Icon size={16} strokeWidth={1.75} aria-hidden className={page === to ? 'text-ink' : 'text-muted'} />
              {label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
