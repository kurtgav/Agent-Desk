import type { ComponentType, ReactNode } from 'react'
import { Check, CircleX, Eye, Hourglass, MessageCircle, ShieldAlert } from 'lucide-react'
import type { AttentionKind } from '@shared/snapshot'
import type { EodBlocker, EodReport, WorkTask } from '@shared/work'
import { useUi } from '@/store'
import { duration } from '@/lib/format'
import { hhmm, projectBars, sessionsOf } from '@/lib/work'
import { projectName } from '@/lib/selectors'
import { Avatar } from '../Avatar'
import { Button, CountBadge, Inline, StatusPill, cn } from '../ui'

/** A section of the report: a heading with its count over a hairline, then its list or, when there is none, one quiet line. */
function Section({ id, title, count, empty, className, children }: { id: string; title: string; count: number; empty: string; className?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={className}>
      <h3 id={id} className="t-title flex items-center gap-2 border-b border-rule pb-2.5">
        {title}
        <CountBadge n={count} label="items" />
      </h3>
      {count ? children : <p className="pt-3 text-[13px] text-muted">{empty}</p>}
    </section>
  )
}

const list = 'divide-y divide-rule'

/** A task: its title, then the project it belongs to, and what to say on the right. */
function TaskLine({ task, lead, right }: { task: WorkTask; lead?: ReactNode; right: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-3">
      {lead}
      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-5 [overflow-wrap:anywhere]">{task.title}</p>
        <p className="truncate text-[12px] leading-4 text-muted">{task.project ? projectName(task.project) : 'No project'}</p>
      </div>
      <span className="flex-none text-[12px] tabular-nums text-muted">{right}</span>
    </li>
  )
}

/** What got done: each with the green check the task lists use, so the section reads as finished work. */
export function DoneSection({ tasks }: { tasks: WorkTask[] }) {
  return (
    <Section id="eod-done" title="Done" count={tasks.length} empty="No task was marked done this day.">
      <ul className={list}>
        {tasks.map((t) => (
          <TaskLine
            key={t.id}
            task={t}
            lead={
              <span aria-hidden className="grid size-5 flex-none place-items-center rounded-full bg-[var(--done-ink)] text-surface">
                <Check size={12} strokeWidth={2.5} />
              </span>
            }
            right={t.doneAt ? hhmm(t.doneAt) : ''}
          />
        ))}
      </ul>
    </Section>
  )
}

const CARRY: Record<'todo' | 'doing', { label: string; dot: string }> = {
  todo: { label: 'To do', dot: 'var(--idle)' },
  doing: { label: 'In progress', dot: 'var(--working)' }
}

export function TomorrowSection({ tasks }: { tasks: WorkTask[] }) {
  return (
    <Section id="eod-tomorrow" title="Tomorrow" count={tasks.length} empty="Nothing is left open. Tomorrow starts clean.">
      <ul className={list}>
        {tasks.map((t) => {
          const c = CARRY[t.status === 'doing' ? 'doing' : 'todo']
          return (
            <TaskLine
              key={t.id}
              task={t}
              right={
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="size-1.5 rounded-full" style={{ background: c.dot }} />
                  {c.label}
                </span>
              }
            />
          )
        })}
      </ul>
    </Section>
  )
}

type Icon = ComponentType<{ size?: number; strokeWidth?: number }>
const KIND: Record<AttentionKind, { label: string; icon: Icon; tone: 'needs' | 'failed' | 'idle' | 'working' }> = {
  approval: { label: 'Approval', icon: ShieldAlert, tone: 'needs' },
  question: { label: 'Question', icon: MessageCircle, tone: 'needs' },
  failed: { label: 'Failed', icon: CircleX, tone: 'failed' },
  stuck: { label: 'Stuck', icon: Hourglass, tone: 'idle' },
  review: { label: 'Ready for review', icon: Eye, tone: 'working' }
}

/**
 * Things that still wait on you, set apart on a warm tint so they never read as finished work. A row opens its session
 * when the snapshot still lists it.
 */
export function BlockersSection({ report }: { report: EodReport }) {
  const sessions = useUi((s) => s.snapshot.sessions)
  const now = useUi((s) => s.now)
  const open = useUi((s) => s.openSession)
  const until = report.closed ? report.generatedAt : now
  const row = (b: EodBlocker): ReactNode => {
    const session = report.sessions.find((s) => s.id === b.sessionId)
    const listed = sessions.some((s) => s.id === b.sessionId)
    const k = KIND[b.kind]
    return (
      <li key={b.itemId} className="flex items-start gap-3 py-3">
        <span className="grid size-7 flex-none place-items-center rounded-lg" style={{ background: `var(--${k.tone}-bg)`, color: `var(--${k.tone}-ink)` }} aria-hidden>
          <k.icon size={15} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] leading-5 [overflow-wrap:anywhere]">
            <Inline text={b.title} />
          </p>
          <p className="text-pretty text-[12px] leading-4 tabular-nums text-muted">
            {k.label} · <span className="whitespace-nowrap">{session?.name ?? 'Session'}</span> · <span className="whitespace-nowrap">{projectName(b.project)}</span> · {report.closed ? 'waited' : 'waiting'} {duration(Math.max(0, until - b.openedAt))}
          </p>
        </div>
        {listed && (
          <Button size="sm" aria-label={`Open ${session?.name ?? 'session'}`} onClick={() => open(b.sessionId)}>
            Open
          </Button>
        )}
      </li>
    )
  }
  const any = report.blockers.length > 0
  return (
    <Section
      id="eod-blockers"
      title="Needs you"
      count={report.blockers.length}
      empty="Nothing was waiting on you."
      className={cn(any && 'rounded-tile bg-[var(--needs-bg)]/35 px-4 pb-1 pt-3.5 ring-1 ring-inset ring-[var(--needs)]/25')}
    >
      <ul className="divide-y divide-[var(--needs)]/15">{report.blockers.map(row)}</ul>
    </Section>
  )
}

/** Agent time by project as a ranked bar list (the longest bar is the busiest), each project's sessions under it. */
export function ProjectsSection({ report }: { report: EodReport }) {
  const sessions = useUi((s) => s.snapshot.sessions)
  const open = useUi((s) => s.openSession)
  const bars = projectBars(report.projects)
  return (
    <Section id="eod-projects" title="Agent work by project" count={bars.length} empty="No agent ran this day.">
      <ul className={list}>
        {bars.map(({ project: p, share, percent }) => (
          <li key={p.cwd} className="py-4">
            <div className="flex items-baseline gap-3">
              <p className="min-w-0 truncate text-[14px] font-semibold leading-5" title={p.cwd}>
                {p.name}
              </p>
              <p className="hidden truncate text-[12px] tabular-nums text-muted @min-[1100px]:block">
                {p.sessions} {p.sessions === 1 ? 'session' : 'sessions'} · {p.turns} {p.turns === 1 ? 'turn' : 'turns'} · {p.files} {p.files === 1 ? 'file' : 'files'}
              </p>
              <p className="ml-auto flex-none text-[14px] font-semibold tabular-nums">{duration(p.agentTimeMs)}</p>
              <p className="w-10 flex-none text-right text-[12px] tabular-nums text-muted">{percent}%</p>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-track" role="img" aria-label={`${p.name}: ${percent}% of the day's agent time`}>
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(share * 100, share > 0 ? 1.5 : 0)}%` }} />
            </div>
            <ul className="mt-3.5 flex flex-col gap-3">
              {sessionsOf(report, p.cwd).map((s) => (
                <li key={s.id} className="flex items-start gap-3">
                  <Avatar seed={s.name} size={24} className="flex-none" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium leading-5">
                      {sessions.some((x) => x.id === s.id) ? (
                        <button type="button" onClick={() => open(s.id)} className="rounded-md text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent">
                          {s.name}
                        </button>
                      ) : (
                        s.name
                      )}
                    </p>
                    {s.summary && <p className="line-clamp-2 text-pretty text-[12px] leading-4 text-muted">{s.summary}</p>}
                  </div>
                  <span className="mt-0.5 flex-none text-[12px] tabular-nums text-muted">{duration(s.agentTimeMs)}</span>
                  <StatusPill status={s.status} />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Section>
  )
}
