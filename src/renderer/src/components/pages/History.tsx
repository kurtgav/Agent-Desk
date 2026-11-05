import { useState } from 'react'
import { HISTORY_MAX, type AuditRow, type HoldOutcome } from '@shared/detail'
import type { Session } from '@shared/snapshot'
import { useUi } from '@/store'
import { clock, duration } from '@/lib/format'
import { projectName, sessionIndex } from '@/lib/selectors'
import { NeedsYou } from '../NeedsYou'
import { DOT } from '../SessionDrawer'
import { Button, Card, CardHeader, Inline } from '../ui'
import { Empty, PageFrame, SearchBox, useHistory } from './Page'

const LOADING = 'Reading…'
const FAILED = 'AgentDeck could not read this from its collector. It retries with the next update.'

/** UI_MAP § Sidebar › Activity: the newest events across every session (30 days kept). A row opens its session. */
export function ActivityPage() {
  const history = useHistory()
  const snapshot = useUi((s) => s.snapshot)
  const now = useUi((s) => s.now)
  const open = useUi((s) => s.openDrawer)
  const [q, setQ] = useState('')
  const sessions = sessionIndex(snapshot)
  const needle = q.trim().toLowerCase()
  const rows = history && history !== 'failed' ? history.activity : []
  const shown = rows.filter((e) => {
    if (!needle) return true
    const s = sessions.get(e.sessionId)
    return [e.summary, e.agentType ?? '', s?.name ?? '', s ? projectName(s.cwd) : ''].some((t) => t.toLowerCase().includes(needle))
  })
  return (
    <PageFrame page="activity" lede={`What your agents did across every session: the newest ${HISTORY_MAX} events.`}>
      <Card aria-labelledby="activity-list">
        <CardHeader id="activity-list" title="Events" count={shown.length} countLabel="shown" action={<SearchBox label="Filter events" value={q} onChange={setQ} />} />
        {history === null ? (
          <Empty>{LOADING}</Empty>
        ) : history === 'failed' ? (
          <Empty>{FAILED}</Empty>
        ) : shown.length ? (
          <ol>
            {shown.map((e) => {
              const s = sessions.get(e.sessionId)
              return (
                <li key={e.id} className="border-t border-rule">
                  <button type="button" onClick={() => open(e.sessionId)} className="flex w-full items-start gap-3 px-4 py-2 text-left transition-[background-color] duration-150 hover:bg-ground">
                    <span className="mt-[7px] size-1.5 flex-none rounded-full" style={{ background: DOT[e.kind] ?? 'var(--idle)' }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] leading-5 [overflow-wrap:anywhere]">
                        {e.agentType && <span className="mr-1.5 rounded-md bg-well px-1.5 py-px text-[12px] font-medium">{e.agentType}</span>}
                        <Inline text={e.summary} />
                      </span>
                      <span className="block truncate text-[12px] leading-4 text-muted">{s ? `${s.name} · ${projectName(s.cwd)}` : 'Session no longer listed'}</span>
                    </span>
                    <time className="flex-none text-[12px] leading-5 tabular-nums text-muted" dateTime={new Date(e.ts).toISOString()}>
                      {clock(e.ts, now)}
                    </time>
                  </button>
                </li>
              )
            })}
          </ol>
        ) : (
          <Empty>{rows.length ? 'No event matches.' : 'No events yet. They appear as your sessions work.'}</Empty>
        )}
      </Card>
    </PageFrame>
  )
}

/** D-107: how each hold ended. Only approved and rejected sent a decision; the rest let the terminal ask. */
const OUTCOME: Record<HoldOutcome, { label: string; tone: 'done' | 'failed' | 'idle' }> = {
  approved: { label: 'Approved once', tone: 'done' },
  rejected: { label: 'Rejected', tone: 'failed' },
  'timed-out': { label: 'Timed out: terminal asked', tone: 'idle' },
  abandoned: { label: 'Gone: Claude Code stopped waiting', tone: 'idle' },
  released: { label: 'Released: terminal asked', tone: 'idle' }
}

function AuditItem({ row, session: s, now }: { row: AuditRow; session: Session | undefined; now: number }) {
  const o = OUTCOME[row.outcome]
  return (
    <li className="flex items-start gap-3 border-t border-rule px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-5 [overflow-wrap:anywhere]">
          <Inline text={row.title} />
        </p>
        <p className="truncate text-[12px] leading-4 text-muted">
          {s ? `${s.name} · ${projectName(s.cwd)}` : 'Session no longer listed'} · waited {duration(Math.max(0, row.ts - row.requestedAt))} ·{' '}
          <span title={`SHA-256 of the request's input: ${row.inputHash}`} className="font-mono">
            {row.inputHash.slice(0, 12)}
          </span>
        </p>
      </div>
      <span
        className="inline-flex h-[22px] flex-none items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[12px] font-medium"
        style={{ background: `var(--${o.tone}-bg)`, color: `var(--${o.tone}-ink)` }}
      >
        <span className="size-1.5 rounded-full" style={{ background: `var(--${o.tone})` }} aria-hidden />
        {o.label}
      </span>
      <time className="flex-none text-[12px] leading-[22px] tabular-nums text-muted" dateTime={new Date(row.ts).toISOString()}>
        {clock(row.ts, now)}
      </time>
    </li>
  )
}

/** UI_MAP § Sidebar › Approvals: open P1 items, then every remote-approval decision (ADR-0006 audit log). */
export function ApprovalsPage() {
  const history = useHistory()
  const snapshot = useUi((s) => s.snapshot)
  const now = useUi((s) => s.now)
  const status = useUi((s) => s.status)
  const setIntegration = useUi((s) => s.setIntegration)
  const sessions = sessionIndex(snapshot)
  const ra = status?.remoteApprovals
  return (
    <PageFrame page="approvals" lede="Requests waiting for your OK, and a log of every answer AgentDeck relayed.">
      <NeedsYou approvals />
      <Card aria-labelledby="audit-log">
        <CardHeader
          id="audit-log"
          title="Audit log"
          count={history && history !== 'failed' ? history.audit.length : undefined}
          countLabel="decisions"
          action={
            status && (
              <Button variant="ghost" size="sm" onClick={() => setIntegration('install')}>
                Remote approvals…
              </Button>
            )
          }
        />
        <p className="px-4 pb-3 text-pretty text-[13px] text-muted">
          {snapshot.mode === 'demo'
            ? 'Demo data: these rows are samples.'
            : !ra
              ? 'Every answer AgentDeck relays is logged here.'
              : ra.enabled
                ? `Remote approvals are on. A request waits here up to ${ra.waitSec} s while its terminal prompt is deferred, then the terminal asks.`
                : 'Remote approvals are off, so requests are answered in their terminal. The log keeps the decisions made while they were on.'}
          {history && history !== 'failed' && history.audit.length >= HISTORY_MAX && ` Showing the newest ${HISTORY_MAX}.`}
        </p>
        {history === null ? (
          <Empty>{LOADING}</Empty>
        ) : history === 'failed' ? (
          <Empty>{FAILED}</Empty>
        ) : history.audit.length ? (
          <ol>
            {history.audit.map((r) => (
              <AuditItem key={`${r.itemId}-${r.ts}`} row={r} session={sessions.get(r.sessionId)} now={now} />
            ))}
          </ol>
        ) : (
          <Empty>No decisions yet.</Empty>
        )}
      </Card>
    </PageFrame>
  )
}
