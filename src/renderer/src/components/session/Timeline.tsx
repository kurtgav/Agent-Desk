import type { TimelineEntry } from '@shared/detail'
import { clock } from '@/lib/format'
import { EmptyState, Inline, Tag } from '../ui'
import { DOT } from './labels'

/** What the session did, one line each: a dot for its weight, who did it when a subagent did, and when. `entries` come in the order to show. */
export function Timeline({ entries, now }: { entries: TimelineEntry[]; now: number }) {
  if (!entries.length) return <EmptyState center>No events yet. They appear here as the session works.</EmptyState>
  return (
    <ol className="flex flex-col">
      {entries.map((e) => (
        <li key={e.id} className="flex items-start gap-3 border-t border-rule py-2 first:border-t-0">
          <span className="mt-[7px] size-1.5 flex-none rounded-full" style={{ background: DOT[e.kind] ?? 'var(--idle)' }} aria-hidden />
          <p className="min-w-0 flex-1 text-[13px] leading-5 [overflow-wrap:anywhere]">
            {e.agentType && <Tag className="mr-1.5 align-baseline leading-4 text-ink">{e.agentType}</Tag>}
            <Inline text={e.summary} />
          </p>
          <time className="flex-none text-[12px] leading-5 tabular-nums text-muted" dateTime={new Date(e.ts).toISOString()}>
            {clock(e.ts, now)}
          </time>
        </li>
      ))}
    </ol>
  )
}
