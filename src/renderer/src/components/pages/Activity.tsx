import { useState } from 'react'
import { HISTORY_MAX } from '@shared/detail'
import { useUi } from '@/store'
import { dayKey, dayLabel } from '@/lib/work'
import { projectName, sessionIndex } from '@/lib/selectors'
import { nameOf } from '@/lib/sessionMeta'
import { DOT } from '../session/labels'
import { Inline, Tag } from '../ui'
import { PageFrame, SearchBox, useHistory } from './Page'
import { ColumnHead, ListCard, ResultCount, StateNote, plain } from './kit'
import { byDay } from './rows'

export const LOADING = 'Reading…'
export const FAILED = 'AgentDeck could not read this from its collector. It retries with the next update.'

/** Time, what happened, and which session: the heads and every row share this grid. */
const GRID = 'grid grid-cols-[72px_minmax(0,1fr)_minmax(0,0.5fr)]'

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })

/** UI_MAP § Sidebar › Activity: the newest events across every session (30 days kept). A row opens its session. */
export function ActivityPage() {
  const history = useHistory()
  const snapshot = useUi((s) => s.snapshot)
  const meta = useUi((s) => s.sessionMeta)
  const now = useUi((s) => s.now)
  const open = useUi((s) => s.openSession)
  const [q, setQ] = useState('')
  const sessions = sessionIndex(snapshot)
  const needle = q.trim().toLowerCase()
  const rows = history && history !== 'failed' ? history.activity : []
  const shown = rows.filter((e) => {
    if (!needle) return true
    const s = sessions.get(e.sessionId)
    return [e.summary, e.agentType ?? '', s?.name ?? '', s ? projectName(s.cwd) : ''].some((t) => t.toLowerCase().includes(needle))
  })
  const today = dayKey(now)
  return (
    <PageFrame
      page="activity"
      lede={`What your agents did across every session: the newest ${HISTORY_MAX} events.`}
      filters={
        <>
          <SearchBox label="Filter events" value={q} onChange={setQ} />
          {history && history !== 'failed' && <ResultCount n={shown.length} one="event" many="events" />}
        </>
      }
    >
      <ListCard label="Events">
        {history === null ? (
          <StateNote tone="loading">{LOADING}</StateNote>
        ) : history === 'failed' ? (
          <StateNote tone="error" title="Activity is not available right now">
            {FAILED}
          </StateNote>
        ) : shown.length ? (
          <>
            <ColumnHead grid={GRID}>
              <span>Time</span>
              <span>Event</span>
              <span>Session</span>
            </ColumnHead>
            {byDay(shown).map((g) => (
              <div key={g.day}>
                <h3 className="border-t border-rule bg-ground/60 px-4 py-1.5 text-[12px] font-medium text-muted">{dayLabel(g.day, today)}</h3>
                <ol>
                  {g.rows.map((e) => {
                    const s = sessions.get(e.sessionId)
                    return (
                      <li key={e.id} className="border-t border-rule px-2 py-0.5 first:border-t-0">
                        <button
                          type="button"
                          onClick={() => open(e.sessionId)}
                          className={`${GRID} w-full items-baseline gap-x-4 rounded-lg px-2 py-1.5 text-left outline-none transition-[background-color] duration-150 hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent`}
                        >
                          <time className="text-[12px] tabular-nums text-muted" dateTime={new Date(e.ts).toISOString()}>
                            {timeFormat.format(e.ts)}
                          </time>
                          <span className="flex min-w-0 items-baseline gap-2.5">
                            <span className="size-1.5 flex-none translate-y-[-1px] rounded-full" style={{ background: DOT[e.kind] ?? 'var(--idle)' }} aria-hidden />
                            <span className="line-clamp-2 min-w-0 text-[14px] leading-5 [overflow-wrap:anywhere]" title={plain(e.summary)}>
                              {e.agentType && <Tag className="mr-1.5 align-baseline">{e.agentType}</Tag>}
                              <Inline text={e.summary} />
                            </span>
                          </span>
                          <span className="truncate text-[13px] leading-5 text-muted" title={s ? `${nameOf(meta, s)} · ${projectName(s.cwd)}` : undefined}>
                            {s ? (
                              <>
                                <span className="text-ink">{nameOf(meta, s)}</span> · {projectName(s.cwd)}
                              </>
                            ) : (
                              'Session no longer listed'
                            )}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              </div>
            ))}
          </>
        ) : (
          <StateNote title={rows.length ? 'No event matches' : 'No events yet'}>{rows.length ? 'Try fewer or different words.' : 'They appear as your sessions work.'}</StateNote>
        )}
      </ListCard>
    </PageFrame>
  )
}
