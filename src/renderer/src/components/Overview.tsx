import type { ComponentType } from 'react'
import { CheckCheck, FilePen, ShieldCheck, Timer } from 'lucide-react'
import { useUi } from '@/store'
import { ageWords, dateLabel, duration, timeOfDay, weekDelta } from '@/lib/format'
import { filesChanged, summaryLine, tasksFinished, waiting } from '@/lib/selectors'
import { USER_NAME } from './Sidebar'

export function Greeting() {
  const now = useUi((s) => s.now)
  const snapshot = useUi((s) => s.snapshot)
  return (
    <div className="pt-1">
      <p className="text-[13px] text-muted">{dateLabel(now)}</p>
      <h1 className="mt-1 text-[28px] font-semibold leading-[34px] tracking-[-0.02em]">
        Good {timeOfDay(new Date(now).getHours())}, {USER_NAME}
      </h1>
      <p className="mt-1.5 text-pretty text-[13px] text-muted">{summaryLine(snapshot)}</p>
    </div>
  )
}

type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

function Kpi({ icon: I, label, value, note }: { icon: Icon; label: string; value: string; note: string }) {
  return (
    <section className="rounded-card border border-line bg-surface px-4 pb-4 pt-[18px]" aria-label={label}>
      <div className="flex items-center gap-2.5">
        <span className="grid size-7 place-items-center rounded-lg bg-well" aria-hidden>
          <I size={15} strokeWidth={1.75} className="text-ink" />
        </span>
        <h2 className="text-[13px] text-muted">{label}</h2>
      </div>
      <p className="mt-2.5 text-[28px] font-semibold leading-[34px] tracking-[-0.01em] tabular-nums">{value}</p>
      <p className="mt-2 text-[12px] text-muted">{note}</p>
    </section>
  )
}

export function Kpis() {
  const s = useUi((x) => x.snapshot)
  const now = useUi((x) => x.now)
  const tasks = tasksFinished(s)
  const wait = waiting(s)
  const files = filesChanged(s)
  return (
    <div className="grid grid-cols-4 gap-4">
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
