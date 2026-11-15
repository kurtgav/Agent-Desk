import type { EodReport } from '@shared/work'
import { duration } from '@/lib/format'

/** "6h 20m" with its units small and grey, so the digits carry the figure. */
function DurationFigure({ ms }: { ms: number }) {
  const text = ms === 0 ? '0m' : duration(ms)
  const parts = [...text.matchAll(/(<?\d+)([a-z]+)/g)]
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {parts.map((m, i) => (
          <span key={i}>
            {m[1]}
            <span className="ml-0.5 mr-2 text-[20px] font-medium text-muted">{m[2]}</span>
          </span>
        ))}
      </span>
    </>
  )
}

const SIBLINGS = (t: EodReport['totals']): [string, number][] => [
  ['Sessions', t.sessions],
  ['Turns', t.turns],
  ['Files changed', t.filesChanged],
  ['Approvals answered', t.approvalsAnswered],
  ['Tasks done', t.tasksDone]
]

/**
 * The day in six figures, as type rather than tiles: agent time leads (36 px, the largest figure on the page) and
 * five counts follow at 20 px. Wide, they share one row; narrow, agent time takes a row of its own so no label wraps
 * out of line. A real zero prints as 0.
 */
export function Headline({ totals }: { totals: EodReport['totals'] }) {
  return (
    <div className="@container">
      <dl className="grid grid-cols-5 gap-y-5 rounded-tile bg-ground/70 px-5 py-5 @min-[720px]:grid-cols-[minmax(0,1.25fr)_repeat(5,minmax(0,1fr))] @min-[720px]:items-end">
        <div className="col-span-5 @min-[720px]:col-span-1 @min-[720px]:pr-4">
          <dt className="text-[13px] font-medium leading-4 text-muted">Agent time</dt>
          <dd className="mt-2 text-[36px] font-semibold leading-9 tracking-[-0.02em] tabular-nums">
            <DurationFigure ms={totals.agentTimeMs} />
          </dd>
        </div>
        {SIBLINGS(totals).map(([label, n]) => (
          <div key={label} className="flex h-full flex-col justify-between border-l border-line pl-3 pr-1">
            <dt className="text-pretty text-[12px] leading-4 text-muted">{label}</dt>
            <dd className="t-stat mt-2">{n}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
