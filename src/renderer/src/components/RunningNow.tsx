import { CornerDownRight } from 'lucide-react'
import type { Session } from '@shared/snapshot'
import { useUi } from '@/store'
import { duration } from '@/lib/format'
import { projectName, running } from '@/lib/selectors'
import { Avatar } from './Avatar'
import { Button, Card, CardHeader, Hint, Inline, PENDING_LABEL, pending } from './ui'

const MAX_ROWS = 4

/** Progress is real or absent: plan steps when a plan exists, otherwise an indeterminate bar. No ETAs. */
function Progress({ session, now }: { session: Session; now: number }) {
  const waitingFor = session.waitingSince === null ? null : now - session.waitingSince
  const tone = waitingFor === null ? 'var(--working)' : 'var(--needs)'
  const plan = session.plan
  return (
    <div className="w-[120px] flex-none">
      {plan ? (
        <div
          role="progressbar"
          aria-label={`${session.name}: step ${Math.min(plan.done + 1, plan.total)} of ${plan.total}`}
          aria-valuemin={0}
          aria-valuemax={plan.total}
          aria-valuenow={plan.done}
          className="h-1.5 overflow-hidden rounded-full bg-track"
        >
          <div className="h-full rounded-full" style={{ width: `${(plan.done / plan.total) * 100}%`, background: tone }} />
        </div>
      ) : (
        <div role="progressbar" aria-label={`${session.name}: no plan`} className="h-1.5 overflow-hidden rounded-full bg-track">
          {waitingFor === null && <div className="bar-indeterminate h-full w-1/3 rounded-full bg-[var(--working)]" />}
        </div>
      )}
      <p className="mt-1.5 text-right text-[12px] leading-4 tabular-nums">
        {waitingFor === null ? (
          <span className="text-muted">{duration(now - session.startedAt)}</span>
        ) : (
          <span className="font-medium text-[var(--needs-ink)]">Waiting {duration(waitingFor)}</span>
        )}
      </p>
    </div>
  )
}

function Row({ session, now }: { session: Session; now: number }) {
  const plan = session.plan
  return (
    <li className="border-t border-rule px-4 py-[9px]">
      <div className="flex items-center gap-3">
        <Avatar seed={session.name} size={28} className="flex-none" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium leading-5">{session.name}</p>
          <p className="truncate text-[12px] leading-4 text-muted">
            <Inline text={session.activity} />
            {plan && ` · Step ${Math.min(plan.done + 1, plan.total)} of ${plan.total}`} · {projectName(session.cwd)}
          </p>
        </div>
        <Progress session={session} now={now} />
      </div>
      {session.subagents.length > 0 && (
        <ul className="ml-[13px] mt-1 flex flex-col gap-1 border-l border-rule pl-[27px]" aria-label={`${session.name} subagents`}>
          {session.subagents.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-[12px] leading-4">
              <CornerDownRight size={12} strokeWidth={1.75} className="-ml-[19px] flex-none text-muted" aria-hidden />
              <Avatar seed={a.agentType} size={16} className="flex-none" />
              <span className="flex-none font-medium">{a.agentType}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{a.task}</span>
              <span className="flex-none tabular-nums text-muted">{duration(now - a.startedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export function RunningNow({ className }: { className?: string }) {
  const snapshot = useUi((s) => s.snapshot)
  const now = useUi((s) => s.now)
  const sessions = running(snapshot)
  return (
    <Card aria-labelledby="running-now" className={className}>
      <CardHeader
        id="running-now"
        title="Running now"
        count={sessions.length}
        countLabel="active"
        action={
          <Hint label={PENDING_LABEL.M4}>
            <Button variant="ghost" size="sm" {...pending('M4')}>
              View all
            </Button>
          </Hint>
        }
      />
      {sessions.length ? (
        <ul>
          {sessions.slice(0, MAX_ROWS).map((x) => (
            <Row key={x.id} session={x} now={now} />
          ))}
        </ul>
      ) : (
        <p className="border-t border-rule px-4 py-6 text-[13px] text-muted">No agent is running.</p>
      )}
    </Card>
  )
}
