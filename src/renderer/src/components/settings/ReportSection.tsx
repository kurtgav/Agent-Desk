import { useEffect, useState, type KeyboardEvent } from 'react'
import type { EodSettings } from '@shared/work'
import { pickFolder } from '@/lib/act'
import { Button, cn } from '../ui'
import { openReportFolder } from './actions'
import { Row, Section, TIME_FIELD } from './Section'
import { SwitchRow } from './Switch'
import { dayLabel } from './time'
import type { SettingsApi } from './useSettings'

/** The newest day that has a report file, or null (none yet, or the collector isn't running). */
function useLastReport(): string | null | undefined {
  const [day, setDay] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let current = true
    const days = window.agentdeck?.listEodDays() ?? Promise.resolve(null)
    void days.then(
      (list) => current && setDay(list?.find((d) => d.hasFile)?.day ?? null),
      () => current && setDay(null)
    )
    return () => {
      current = false
    }
  }, [])
  return day
}

/** Settings › Daily report (config.json → eod): on/off, the time it is finished, and the folder it is written to. */
export function ReportSection({ api }: { api: SettingsApi }) {
  const { eod } = api.settings
  const last = useLastReport()
  const save = (patch: Partial<EodSettings>): Promise<boolean> => api.save('report', { eod: patch })

  async function browse(): Promise<void> {
    const folder = await pickFolder()
    if (folder) await save({ folder })
  }

  async function resetFolder(): Promise<void> {
    await save({ folder: null })
    // This button is gone now; keep keyboard focus in the row.
    document.getElementById('report-browse')?.focus()
  }

  function leaveTime(input: HTMLInputElement): void {
    if (!input.value || input.value === eod.time) {
      input.value = eod.time
      return
    }
    void save({ time: input.value })
  }

  function keys(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') e.currentTarget.blur()
    if (e.key === 'Escape') {
      e.currentTarget.value = eod.time
      e.currentTarget.blur()
    }
  }

  return (
    <Section id="report" title="Daily report" description="A written summary of each day's agent work, saved as a file on this PC." saved={api.savedSection === 'report'} error={api.errors.report}>
      <SwitchRow
        title="Write a daily report"
        help="A short Markdown summary of the day's agent work, kept in a folder on this PC. Nothing is sent anywhere."
        checked={eod.enabled}
        onChange={(enabled) => void save({ enabled })}
      />
      <Row title="Publish at" controlId="report-time" help="Written to the folder at this time, then kept up to date until midnight.">
        <input
          id="report-time"
          key={eod.time}
          type="time"
          defaultValue={eod.time}
          disabled={!eod.enabled}
          aria-describedby="report-time-help"
          onBlur={(e) => leaveTime(e.currentTarget)}
          onKeyDown={keys}
          className={TIME_FIELD}
        />
      </Row>
      <Row title="Folder" stacked help="Each day is one file named like 2026-11-13.md.">
        <div className="flex items-center gap-2">
          <span className="block min-h-8 min-w-0 flex-1 break-all rounded-2xl bg-well px-3 py-1.5 text-[13px] leading-5">
            {eod.folder ?? "Default: inside AgentDeck's data folder"}
          </span>
          <Button id="report-browse" size="sm" onClick={() => void browse()} disabled={!eod.enabled}>
            Browse…
          </Button>
          {eod.folder && (
            <Button size="sm" variant="ghost" onClick={() => void resetFolder()} disabled={!eod.enabled}>
              Use default
            </Button>
          )}
          <Button size="sm" onClick={() => void openReportFolder()}>
            Open folder
          </Button>
        </div>
      </Row>
      <Row title="Last report written">
        <span className={cn('text-[13px] tabular-nums', last ? 'text-ink' : 'text-muted')}>{last === undefined ? '' : last ? dayLabel(last) : 'None yet'}</span>
      </Row>
    </Section>
  )
}
