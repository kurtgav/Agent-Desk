import type { EodReport } from '@shared/work'
import { Card, cn } from '../ui'
import { dayHeading, hhmm, hhmmss, reportFinding } from '@/lib/work'
import { DayState } from './DayRail'
import { Headline } from './Headline'
import { NotesField } from './NotesField'
import { BlockersSection, DoneSection, ProjectsSection, TomorrowSection } from './ReportSections'

/**
 * The report as a document: its day and the one sentence that sums it up, the six totals, then what got done, the
 * agent work by project, what still waits on you, what is left for tomorrow, and your notes. A closed day is
 * read-only except for the notes. The controls live in the page's toolbar, so the document itself is only content.
 * An open day says when it was last read, to the second, with a small dot that is lit while the page follows the collector.
 */
export function Report({ report, live = false }: { report: EodReport; live?: boolean }) {
  return (
    <Card aria-labelledby="eod-day" className="px-9 py-8">
      <header>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 id="eod-day" className="t-stat">
            {dayHeading(report.day)}
          </h2>
          <DayState closed={report.closed} />
          <p className="ml-auto flex items-center gap-1.5 text-[12px] tabular-nums text-muted">
            {!report.closed && (
              <span
                aria-hidden
                title={live ? 'Updates as your agents work' : 'Updates every 30 seconds'}
                className={cn('size-1.5 rounded-full', live ? 'bg-[var(--working)]' : 'bg-[var(--idle)]')}
              />
            )}
            {report.closed ? `Final version ${hhmm(report.generatedAt)}` : `Updated ${hhmmss(report.generatedAt)}`}
          </p>
        </div>
        <p className="mt-2 max-w-[68ch] text-pretty text-[15px] leading-6">{reportFinding(report)}</p>
      </header>

      <div className="mt-6">
        <Headline totals={report.totals} />
      </div>

      <div className="mt-10 flex flex-col gap-10">
        <DoneSection tasks={report.tasksDone} />
        <ProjectsSection report={report} />
        <div className="grid grid-cols-1 gap-x-10 gap-y-10 @min-[1100px]:grid-cols-2 @min-[1100px]:items-start">
          <BlockersSection report={report} />
          <TomorrowSection tasks={report.carryOver} />
        </div>
        {/* Keyed by day: switching days sends the unsaved text and starts the next day's field fresh. */}
        <NotesField key={report.day} day={report.day} initial={report.notes} />
      </div>
    </Card>
  )
}
