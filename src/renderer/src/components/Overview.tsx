import type { ComponentType } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { ArrowUp, AtSign, Check, CheckCheck, ChevronDown, FilePen, Plus, ShieldCheck, Timer, Zap } from 'lucide-react'
import { useUi } from '@/store'
import { ageWords, dateLabel, duration, timeOfDay, weekDelta } from '@/lib/format'
import { filesChanged, recentProjects, summaryLine, tasksFinished, waiting } from '@/lib/selectors'
import { USER_NAME } from './Sidebar'
import { Button, Hint, IconButton, PENDING_LABEL, pending } from './ui'

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

const menuContent = 'z-50 min-w-52 rounded-tile border border-line bg-surface p-1 text-[13px] shadow-[0_8px_24px_rgb(0_0_0/0.10)]'
const menuItem = 'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-ground'

export function Composer() {
  const snapshot = useUi((s) => s.snapshot)
  const { effort, composerCwd, composerAgent, cycleEffort, setComposerCwd, setComposerAgent } = useUi()
  const projects = recentProjects(snapshot, 8)
  const project = projects.find((p) => p.cwd === composerCwd) ?? projects[0]

  return (
    <form
      onSubmit={(e) => e.preventDefault()}
      className="rounded-card border border-line bg-surface px-4 pb-2 pt-3 transition-[border-color] duration-150 focus-within:border-accent"
    >
      <label htmlFor="composer-input" className="sr-only">
        Task for a new background session
      </label>
      <textarea
        id="composer-input"
        rows={1}
        placeholder="Tell an agent what to build, fix or research…"
        className="block h-6 w-full resize-none bg-transparent text-[14px] leading-6 outline-none placeholder:text-muted"
      />
      <div className="mt-1.5 flex items-center gap-1">
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button variant="ghost" size="sm" className="-ml-2 px-2 text-muted" aria-label={`Project: ${project?.name ?? 'none'}. Change project`}>
              <Plus size={16} strokeWidth={1.75} />
              {project && <span className="text-ink">{project.name}</span>}
            </Button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content align="start" sideOffset={6} className={menuContent}>
              <Menu.Label className="px-2 py-1.5 text-[12px] text-muted">Run in project</Menu.Label>
              {projects.map((p) => (
                <Menu.Item key={p.cwd} className={menuItem} onSelect={() => setComposerCwd(p.cwd)}>
                  <Check size={14} className={p.cwd === project?.cwd ? '' : 'invisible'} />
                  <span>{p.name}</span>
                  <span className="ml-auto max-w-40 truncate text-[12px] text-muted">{p.cwd}</span>
                </Menu.Item>
              ))}
              <Menu.Item disabled className={`${menuItem} data-[disabled]:text-muted`}>
                <span className="w-3.5" /> Browse… <span className="ml-auto text-[12px]">M4</span>
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
        <Hint label={`Mention a subagent: ${PENDING_LABEL.M4}`}>
          <IconButton aria-label="Mention a subagent" {...pending('M4')}>
            <AtSign size={16} strokeWidth={1.75} />
          </IconButton>
        </Hint>

        <div className="ml-auto flex items-center gap-2">
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button variant="ghost" size="sm" className="px-2.5" aria-label={`Subagent: ${composerAgent ?? 'default'}`}>
                {composerAgent ?? 'Agent'}
                <ChevronDown size={14} className="text-muted" />
              </Button>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content align="end" sideOffset={6} className={menuContent}>
                <Menu.Item className={menuItem} onSelect={() => setComposerAgent(null)}>
                  <Check size={14} className={composerAgent === null ? '' : 'invisible'} /> Default (no --agent)
                </Menu.Item>
                {snapshot.recentAgentTypes.map((a) => (
                  <Menu.Item key={a} className={menuItem} onSelect={() => setComposerAgent(a)}>
                    <Check size={14} className={composerAgent === a ? '' : 'invisible'} /> {a}
                  </Menu.Item>
                ))}
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
          <Hint label="Effort for the new session (--effort). Click to change.">
            <Button size="sm" className="h-7 px-2.5 text-[12px] capitalize" onClick={cycleEffort} aria-label={`Effort: ${effort}. Change effort`}>
              <Zap size={13} strokeWidth={1.75} />
              {effort === 'xhigh' ? 'Extra high' : effort}
            </Button>
          </Hint>
          <Hint label={`Dispatch: ${PENDING_LABEL.M4}`}>
            <button
              type="submit"
              aria-label="Dispatch task"
              {...pending('M4')}
              className="grid size-8 place-items-center rounded-full bg-accent-fill text-white transition-[background-color,transform] duration-150 hover:bg-accent-fill-hover active:scale-[0.96]"
            >
              <ArrowUp size={16} strokeWidth={2} />
            </button>
          </Hint>
        </div>
      </div>
    </form>
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
