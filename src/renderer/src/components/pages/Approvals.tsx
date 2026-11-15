import { HISTORY_MAX, type AuditRow, type HoldOutcome } from '@shared/detail'
import type { Session } from '@shared/snapshot'
import { useUi } from '@/store'
import { clock, duration } from '@/lib/format'
import { projectName, sessionIndex } from '@/lib/selectors'
import { NeedsYou } from '../NeedsYou'
import { useDisplayName } from '../session-menu/hooks'
import { Button, CardHeader, Card, Inline } from '../ui'
import { FAILED, LOADING } from './Activity'
import { PageFrame, useHistory } from './Page'
import { ColumnHead, StateNote, plain } from './kit'

/** D-107: how each hold ended. Only approved and rejected sent a decision; the rest let the terminal ask. */
const OUTCOME: Record<HoldOutcome, { label: string; tone: 'done' | 'failed' | 'idle' }> = {
  approved: { label: 'Approved once', tone: 'done' },
  rejected: { label: 'Rejected', tone: 'failed' },
  'timed-out': { label: 'Timed out: terminal asked', tone: 'idle' },
  abandoned: { label: 'Gone: Claude Code stopped waiting', tone: 'idle' },
  released: { label: 'Released: terminal asked', tone: 'idle' }
}

/** When, what was asked and by whom, how long it waited, the input's hash, how it ended: heads and rows share this grid. */
const GRID = 'grid grid-cols-[92px_minmax(0,1fr)_64px_104px_232px]'

function AuditItem({ row, session: s, now }: { row: AuditRow; session: Session | undefined; now: number }) {
  const o = OUTCOME[row.outcome]
  const name = useDisplayName(s)
  return (
    <li className="border-t border-rule px-2 py-0.5">
      <div className={`${GRID} items-start gap-x-4 px-2 py-2`}>
        <time className="text-[12px] leading-5 tabular-nums text-muted" dateTime={new Date(row.ts).toISOString()}>
          {clock(row.ts, now)}
        </time>
        <div className="min-w-0">
          <p className="line-clamp-2 text-[14px] leading-5 [overflow-wrap:anywhere]" title={plain(row.title)}>
            <Inline text={row.title} />
          </p>
          <p className="truncate text-[12px] leading-4 text-muted">{s ? `${name} · ${projectName(s.cwd)}` : 'Session no longer listed'}</p>
        </div>
        <p className="text-[13px] leading-5 tabular-nums text-muted">
          <span className="sr-only">Waited </span>
          {duration(Math.max(0, row.ts - row.requestedAt))}
        </p>
        <p className="font-mono text-[12px] leading-5 text-muted" title={`SHA-256 of the request's input: ${row.inputHash}`}>
          {row.inputHash.slice(0, 12)}
        </p>
        <p className="flex items-start gap-2 text-[13px] leading-5">
          <span className="mt-[7px] size-1.5 flex-none rounded-full" style={{ background: `var(--${o.tone})` }} aria-hidden />
          {o.label}
        </p>
      </div>
    </li>
  )
}

/** The remote-approvals state in two words, beside the button that changes it. */
function RemoteState({ on }: { on: boolean }) {
  return (
    <p className="inline-flex h-8 items-center gap-2 rounded-full bg-well px-3 text-[13px] font-medium">
      <span className="size-1.5 rounded-full" style={{ background: on ? 'var(--done)' : 'var(--idle)' }} aria-hidden />
      {on ? 'Remote approvals on' : 'Remote approvals off'}
    </p>
  )
}

/** UI_MAP § Sidebar › Approvals: open P1 items first, then every remote-approval decision as a quiet table (ADR-0006 audit log). */
export function ApprovalsPage() {
  const history = useHistory()
  const snapshot = useUi((s) => s.snapshot)
  const now = useUi((s) => s.now)
  const status = useUi((s) => s.status)
  const setIntegration = useUi((s) => s.setIntegration)
  const sessions = sessionIndex(snapshot)
  const ra = status?.remoteApprovals
  const audit = history && history !== 'failed' ? history.audit : null
  return (
    <PageFrame
      page="approvals"
      lede="Requests waiting for your OK, and a log of every answer AgentDeck relayed."
      // Live only: in demo, and before main answers, there is nothing to say or change, so no toolbar either.
      filters={status && <RemoteState on={status.remoteApprovals.enabled} />}
      actions={status && <Button onClick={() => setIntegration('install')}>Remote approvals…</Button>}
    >
      <NeedsYou approvals />
      <Card aria-labelledby="audit-log">
        <CardHeader id="audit-log" title="Audit log" count={audit?.length} countLabel="decisions" />
        <p className="px-4 pb-3 text-pretty text-[13px] text-muted">
          {snapshot.mode === 'demo'
            ? 'Demo data: these rows are samples.'
            : !ra
              ? 'Every answer AgentDeck relays is logged here.'
              : ra.enabled
                ? `Remote approvals are on. A request waits here up to ${ra.waitSec} s while its terminal prompt is deferred, then the terminal asks.`
                : 'Remote approvals are off, so requests are answered in their terminal. The log keeps the decisions made while they were on.'}
          {audit && audit.length >= HISTORY_MAX && ` Showing the newest ${HISTORY_MAX}.`}
        </p>
        {history === null ? (
          <StateNote tone="loading" divided>
            {LOADING}
          </StateNote>
        ) : history === 'failed' ? (
          <StateNote tone="error" title="The audit log is not available right now" divided>
            {FAILED}
          </StateNote>
        ) : audit && audit.length ? (
          <>
            <ColumnHead grid={GRID}>
              <span>When</span>
              <span>Request</span>
              <span>Waited</span>
              <span>Input hash</span>
              <span>Outcome</span>
            </ColumnHead>
            <ol className="pb-1">
              {audit.map((r) => (
                <AuditItem key={`${r.itemId}-${r.ts}`} row={r} session={sessions.get(r.sessionId)} now={now} />
              ))}
            </ol>
          </>
        ) : (
          <StateNote title="No decisions yet" divided>
            Answers you give to requests AgentDeck holds are written here.
          </StateNote>
        )}
      </Card>
    </PageFrame>
  )
}
