import type { AttentionKind, Session, Status } from '@shared/snapshot'
import { KIND } from '../NeedsYou'
import { Inline, Pill, StatusPill } from '../ui'

const TONE: Record<Status, string> = {
  working: 'var(--working)',
  needs_you: 'var(--needs)',
  failed: 'var(--failed)',
  idle: 'var(--idle)',
  done: 'var(--done)'
}

/**
 * A session's status pill, its latest activity, and its plan progress when it has one. Shared by agent rows and task cards.
 * In the Waiting on you lane the pill says why instead (Approval, Question, Failed, Stuck), in the Needs you card's words, or
 * Waiting when the session waits with no item to name (D-054), so the lane never shows a second name for itself.
 */
export function LiveLine({ session, reason }: { session: Session; reason?: AttentionKind | null }) {
  const plan = session.plan
  const why = reason ? KIND[reason] : reason === null ? ({ tone: 'needs', label: 'Waiting' } as const) : null
  return (
    <>
      <div className="mt-1 flex min-w-0 items-center gap-2">
        {why ? <Pill tone={why.tone}>{why.label}</Pill> : <StatusPill status={session.status} />}
        <span className="min-w-0 truncate text-[12px] leading-4 text-muted">
          <Inline text={session.activity} />
        </span>
      </div>
      {plan && (
        <div className="mt-1.5 flex items-center gap-2">
          <div
            role="progressbar"
            aria-label={`${session.name}: ${plan.done} of ${plan.total} steps done`}
            aria-valuemin={0}
            aria-valuemax={plan.total}
            aria-valuenow={plan.done}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-track"
          >
            <div className="h-full rounded-full" style={{ width: `${plan.total ? (plan.done / plan.total) * 100 : 0}%`, background: TONE[session.status] }} />
          </div>
          <span className="flex-none text-[12px] tabular-nums leading-4 text-muted" aria-hidden>
            {plan.done}/{plan.total}
          </span>
        </div>
      )}
    </>
  )
}
