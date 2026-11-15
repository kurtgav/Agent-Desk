import { useEffect, useRef } from 'react'
import type { LaneSummary } from '@/lib/work'
import { Button } from '../ui'
import { useTasks } from './tasksStore'

const UNDO_WINDOW_MS = 10_000

function Count({ n, label }: { n: number; label: string }) {
  return (
    <span>
      <span className="font-semibold tabular-nums text-ink">{n}</span> {label}
    </span>
  )
}

/**
 * One line that sets the page's hierarchy: the day in the four lanes' counts, the waiting one in the needs colours when
 * something asks for you now. After a delete it also offers Undo, and takes focus there, since the row that had it is gone.
 */
export function TodaySummary({ summary }: { summary: LaneSummary }) {
  const removed = useTasks((s) => s.removed)
  const undo = useTasks((s) => s.undoRemove)
  const slot = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!removed) return
    slot.current?.querySelector('button')?.focus()
    const t = setTimeout(() => useTasks.setState({ removed: null }), UNDO_WINDOW_MS)
    return () => clearTimeout(t)
  }, [removed])

  return (
    <div className="flex min-h-8 flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-muted">
      <p className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <span className="font-medium text-ink">Today</span>
        <Count n={summary.todo} label="to do" />
        <Count n={summary.doing} label={summary.running ? `in progress (${summary.running} running)` : 'in progress'} />
        {summary.asking > 0 ? (
          <span className="inline-flex items-center gap-1.5 font-medium tabular-nums text-[var(--needs-ink)]">
            <span className="size-1.5 rounded-full bg-[var(--needs)]" aria-hidden />
            {summary.needs} waiting on you
          </span>
        ) : (
          <Count n={summary.needs} label="waiting on you" />
        )}
        <Count n={summary.done} label="done" />
      </p>
      {removed && (
        <p className="ml-auto flex items-center gap-2">
          <span className="max-w-[40ch] truncate">Deleted “{removed.title}”</span>
          <span ref={slot}>
            <Button size="sm" onClick={() => void undo()}>
              Undo
            </Button>
          </span>
        </p>
      )}
    </div>
  )
}
