import { Activity, FileText, Files, LayoutDashboard, ListChecks, Settings, ShieldCheck, type LucideIcon } from 'lucide-react'
import { useUi, type Page } from '@/store'
import { needsOkCount } from '@/lib/selectors'
import { Hint, cn } from '../ui'

export const WORKSPACE: { page: Page; label: string; icon: LucideIcon }[] = [
  { page: 'tasks', label: 'Tasks', icon: ListChecks },
  { page: 'report', label: 'Daily report', icon: FileText },
  { page: 'approvals', label: 'Approvals', icon: ShieldCheck },
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
  return (
    <Hint side={side} label={waiting ? `${label}, ${waiting} waiting` : label}>
      <button
        type="button"
        aria-label={waiting ? `${label}, ${waiting} open` : label}
        aria-current={current ? 'page' : undefined}
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

/** Tasks, Daily report, Approvals, Files, Activity, Overview, Settings: one row of icons, never nested, the same under every page. */
export function WorkspaceRow() {
  return (
    <nav aria-label="Workspace" className="flex-none px-2.5 pb-1 pt-2">
      <p className="px-1.5 pb-1 text-[12px] font-medium text-muted">Workspace</p>
      <div className="flex items-center justify-between">
        {WORKSPACE.map((w) => (
          <WorkspaceButton key={w.page} {...w} side="top" />
        ))}
      </div>
    </nav>
  )
}
