import type { ComponentType } from 'react'
import { CheckCheck, FilePen, ShieldCheck, Timer } from 'lucide-react'
import { useUi } from '@/store'
import { ageWords, dateLabel, duration, weekDelta } from '@/lib/format'
import { greeting } from '@/lib/profile'
import { filesChanged, needsOkCount, summaryLine, tasksFinished, waiting } from '@/lib/selectors'

/** The date, who you are greeted as, and one line of what happened. What needs your OK reads in ink; the rest is muted. */
export function Greeting() {
  const now = useUi((s) => s.now)
  const snapshot = useUi((s) => s.snapshot)
  const name = useUi((s) => s.profile.name)
  const line = summaryLine(snapshot)
  // "3 things need your OK." is the first sentence exactly when something waits (selectors.summaryLine).
  const sentences = line.split(/(?<=\.) /)
  const asks = needsOkCount(snapshot) > 0
  const ask = asks ? sentences[0] : undefined
  const rest = asks ? sentences.slice(1) : sentences
  return (
    <div className="pt-1">
      <p className="text-[13px] leading-[18px] text-muted">{dateLabel(now)}</p>
      <h1 className="t-display mt-1 text-balance [overflow-wrap:anywhere]">{greeting(new Date(now).getHours(), name)}</h1>
      <p className="mt-2 text-pretty text-[13px] leading-[18px] text-muted">
        {ask && <span className="font-medium text-ink">{ask} </span>}
        {rest.join(' ')}
      </p>
    </div>
  )
}

type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

/** One figure of the week: a muted label, the number as the loudest thing in the cell, one line of context. */
function Kpi({ icon: I, label, value, note }: { icon: Icon; label: string; value: string; note: string }) {
  return (
    <section className="min-w-0 px-4 py-4" aria-label={label}>
      <h2 className="flex items-center gap-1.5 text-[13px] font-normal leading-[18px] text-muted">
        <I size={14} strokeWidth={1.75} className="flex-none" aria-hidden />
        <span className="truncate">{label}</span>
      </h2>
      <p className="t-stat mt-1.5">{value}</p>
      <p className="t-meta mt-1 truncate text-muted" title={note}>
        {note}
      </p>
    </section>
  )
}

/** The week at a glance: context, not a call to act, so one quiet band instead of four cards. */
export function Kpis() {
  const s = useUi((x) => x.snapshot)
  const now = useUi((x) => x.now)
  const tasks = tasksFinished(s)
  const wait = waiting(s)
  const files = filesChanged(s)
  return (
    <div className="grid grid-cols-4 divide-x divide-rule rounded-card border border-line bg-surface">
      <Kpi icon={Timer} label="Agent time this week" value={duration(s.week.agentTimeMs)} note={weekDelta(s.week.agentTimeMs, s.week.agentTimeLastWeekMs)} />
      <Kpi icon={CheckCheck} label="Tasks finished" value={String(tasks.count)} note={s.awaySince === null ? 'This week' : `${tasks.whileAway} while you were away`} />
      <Kpi
        icon={ShieldCheck}
        label="Waiting for you"
        value={String(wait.count)}
        note={wait.oldestAt === null ? 'Nothing is waiting' : `The oldest is ${ageWords(now - wait.oldestAt)} old`}
      />
      <Kpi icon={FilePen} label="Files changed" value={String(files.count)} note={`across ${files.projects} ${files.projects === 1 ? 'project' : 'projects'} this week`} />
    </div>
  )
}
