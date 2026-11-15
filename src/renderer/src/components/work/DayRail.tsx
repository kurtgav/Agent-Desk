import { FileCheck } from 'lucide-react'
import type { EodDay } from '@shared/work'
import { duration } from '@/lib/format'
import { dayLabel } from '@/lib/work'
import { StatusPill, cn } from '../ui'

/** Live (a dot and a word) or closed (a word): never colour alone. The status pill with the day's own word. */
export function DayState({ closed }: { closed: boolean }) {
  return <StatusPill status={closed ? 'idle' : 'working'} label={closed ? 'Closed' : 'Live'} />
}

/**
 * The days that have a report, today pinned first. Each row is a button: the day, how much the agents did, and whether
 * the day is still live (today is, until midnight). Only the live day is marked on screen, with a dot and a word; a
 * closed day says "Closed" to screen readers and is otherwise just a day. A saved file shows as a small mark with a name.
 * Wide (the page's canvas at least 800 px), a narrow sticky column that scrolls on its own; narrower, a strip of compact
 * days that scrolls sideways, so the report always starts on the first screen. The chosen day is a light well, not a slab.
 */
export function DayRail({ days, today, selected, onSelect }: { days: EodDay[]; today: string; selected: string; onSelect(day: string): void }) {
  return (
    <nav aria-label="Report days" className="rounded-card border border-line bg-surface p-1.5 @min-[800px]:sticky @min-[800px]:top-6 @min-[800px]:p-2">
      <ul className="-m-0.5 flex gap-1 overflow-x-auto p-0.5 @min-[800px]:max-h-[calc(100vh-12rem)] @min-[800px]:flex-col @min-[800px]:gap-0.5 @min-[800px]:overflow-x-visible @min-[800px]:overflow-y-auto">
        {days.map((d) => {
          const live = d.day === today
          return (
            <li key={d.day} className="min-w-[9.5rem] flex-none @min-[800px]:min-w-0">
              <button
                type="button"
                aria-current={d.day === selected ? 'date' : undefined}
                onClick={() => onSelect(d.day)}
                className={cn(
                  'flex w-full rounded-tile px-3 py-2 text-left outline-none transition-[background-color] duration-150 hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent',
                  d.day === selected && 'bg-well hover:bg-well'
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center justify-between gap-2">
                    <span className={cn('text-[14px] leading-5 tabular-nums', d.day === selected ? 'font-semibold' : 'font-medium')}>{dayLabel(d.day, today)}</span>
                    {live ? (
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--working-ink)]">
                        <span className="size-1.5 rounded-full bg-[var(--working)]" aria-hidden />
                        Live
                      </span>
                    ) : (
                      <span className="sr-only">Closed</span>
                    )}
                  </span>
                  <span className="flex items-center justify-between gap-2 text-[12px] leading-4 tabular-nums text-muted">
                    <span className="truncate">
                      {d.agentTimeMs ? duration(d.agentTimeMs) : 'No agent time'} · {d.sessions} {d.sessions === 1 ? 'session' : 'sessions'}
                    </span>
                    {d.hasFile && <FileCheck size={13} strokeWidth={1.75} className="flex-none" role="img" aria-label="File written" />}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
