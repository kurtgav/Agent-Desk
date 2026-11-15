import { useState } from 'react'
import type { EodSettings } from '@shared/work'
import { useUi } from '@/store'
import { dayHeading, dayKey, eodStatusLine, rankDays } from '@/lib/work'
import { Button, Card } from '../ui'
import { DayRail } from '../work/DayRail'
import { Report } from '../work/Report'
import { ReportActions } from '../work/ReportActions'
import { announce } from '../work/tasksStore'
import { useEodDays, useEodLive, useEodReport, useEodSettings } from '../work/useEod'
import { PageFrame } from './Page'

/**
 * From Settings: how often the file is written and where, or that the daily report is off, with the way to turn it on.
 * The line wraps instead of being cut; the folder stays in one piece (or breaks only when it alone is too long), and its
 * tooltip names where the files go.
 */
function Status({ settings }: { settings: EodSettings | null }) {
  const go = useUi((s) => s.go)
  const now = useUi((s) => s.now)
  const line = settings && eodStatusLine(settings, now)
  if (!settings) return <p className="h-5" aria-hidden />
  if (line) {
    const [when = line, folder] = line.split(' · folder ')
    const where = settings.folder ?? "the eod folder inside AgentDeck's data folder (Diagnostics shows its path)"
    return (
      <p className="min-w-0 flex-1 text-pretty text-[13px] leading-5 tabular-nums text-muted" title={`${when}. Files are written to ${where}.`}>
        <span>{when} </span>
        {folder !== undefined && <span className="inline-block max-w-full [overflow-wrap:anywhere]">· folder {folder}</span>}
      </p>
    )
  }
  return (
    <p className="flex items-center gap-1 text-[13px] text-muted">
      Daily report is off.
      <Button variant="ghost" size="sm" className="-my-1" onClick={() => go({ page: 'settings' })}>
        Turn it on in Settings
      </Button>
    </p>
  )
}

const slot = 'px-8 py-10 text-center text-[13px] text-muted'

/**
 * UI_MAP § Sidebar › Daily report: the days on the left (today pinned, live or closed), the selected day as a
 * document on the right. Today's follows the collector (it is read again as work happens); every other day is read once. The toolbar says where the file
 * goes and carries the report's actions, so the document itself stays clean enough to screenshot.
 */
export function EodPage() {
  const today = dayKey(useUi((s) => s.now))
  const [day, setDay] = useState(today)
  const days = useEodDays()
  const { report, failed, reload } = useEodReport(day)
  const settings = useEodSettings()
  const live = useEodLive()

  return (
    <PageFrame
      page="report"
      lede="Your day, written for you from what your agents and your tasks did. Nothing leaves this PC."
      filters={<Status settings={settings} />}
      actions={report && <ReportActions report={report} />}
    >
      {/* A container query on the canvas, not the window: the rail goes beside the report whenever there is room for both. */}
      <div className="@container">
        <div className="grid grid-cols-1 items-start gap-4 @min-[800px]:grid-cols-[232px_minmax(0,1fr)]">
          <DayRail
            days={rankDays(days, today)}
            today={today}
            selected={day}
            onSelect={(d) => {
              setDay(d)
              announce(`Showing the report for ${dayHeading(d)}`)
            }}
          />
          {report ? (
            <Report report={report} live={live} />
          ) : failed ? (
            <Card className={`${slot} flex flex-col items-center gap-3`}>
              <p className="text-pretty">AgentDeck could not read this day's report.</p>
              <Button onClick={reload}>Retry</Button>
            </Card>
          ) : (
            <Card className={slot}>
              <p role="status">Reading the report…</p>
            </Card>
          )}
        </div>
      </div>
    </PageFrame>
  )
}
