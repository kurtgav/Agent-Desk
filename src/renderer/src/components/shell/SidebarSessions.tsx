import { useMemo, useRef } from 'react'
import { ChevronRight } from 'lucide-react'
import { useUi } from '@/store'
import { buildList, findEntry, listable, type SessionEntry, type SidebarList } from '@/lib/sessionList'
import { EmptyState, Skeleton } from '../ui'
import { ROW_HEIGHT, SessionRow } from './SessionRow'
import { useEntries } from './useEntries'
import { useRoving } from './useRoving'
import { useWindowed } from './useWindowed'

const HEADING_HEIGHT = 28

type Row = { kind: 'heading'; key: string; title: string } | { kind: 'entry'; entry: SessionEntry }

function flatten(list: SidebarList): Row[] {
  return [
    ...(list.pinned.length ? [{ kind: 'heading' as const, key: 'pinned', title: 'Pinned' }] : []),
    ...list.pinned.map((entry) => ({ kind: 'entry' as const, entry })),
    ...list.sections.flatMap((s) => [{ kind: 'heading' as const, key: s.key, title: s.title }, ...s.entries.map((entry) => ({ kind: 'entry' as const, entry }))])
  ]
}

/** The list's states: the collector has not answered, it stopped, or there is simply nothing yet. */
function Placeholder({ loading, down }: { loading: boolean; down: boolean }) {
  if (loading) {
    return (
      <div role="status" aria-label="Loading sessions" className="flex flex-col gap-2 px-2 pt-1">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-7" />
        ))}
      </div>
    )
  }
  if (down) return <EmptyState center className="px-3 py-4 text-[12px]">The collector stopped. AgentDeck is restarting it, and your sessions come back with it.</EmptyState>
  return <EmptyState center className="px-3 py-4 text-[12px]">No sessions yet. Start one with New session, or in a terminal.</EmptyState>
}

/**
 * The sidebar's daily driver: every session AgentDeck knows, pinned first, then Today, Yesterday, This week and Earlier. Past about
 * 200 rows only the ones on screen are drawn. The Sessions page, with its filters, folders and archive, is one click below.
 */
export function SidebarSessions() {
  const entries = useEntries()
  const meta = useUi((s) => s.sessionMeta)
  const now = useUi((s) => s.now)
  const link = useUi((s) => s.link)
  const nav = useUi((s) => s.nav)
  const go = useUi((s) => s.go)
  const scroller = useRef<HTMLDivElement>(null)

  const shown = useMemo(() => listable(entries, meta), [entries, meta])
  const rows = useMemo(() => flatten(buildList(shown, now)), [shown, now])
  const heights = useMemo(() => rows.map((r) => (r.kind === 'heading' ? HEADING_HEIGHT : ROW_HEIGHT)), [rows])
  const targets = useMemo(() => rows.flatMap((r, i) => (r.kind === 'entry' ? [i] : [])), [rows])
  const win = useWindowed(scroller, heights)
  const roving = useRoving(scroller, targets, win)
  const open = nav.page === 'session' ? findEntry(entries, nav.session)?.key : undefined

  return (
    <section aria-labelledby="sb-sessions" className="flex min-h-[196px] flex-[3] flex-col pt-3">
      <h2 id="sb-sessions" className="flex h-7 flex-none items-center px-[18px] text-[12px] font-medium text-muted">
        Sessions
      </h2>

      <div ref={scroller} {...roving.containerProps} className="scroll-fade min-h-0 flex-1 overflow-y-auto px-2.5">
        {rows.length === 0 ? (
          <Placeholder loading={link === 'connecting'} down={link === 'down'} />
        ) : (
          <ul role="list" aria-label="Sessions" style={{ paddingTop: win.padTop, paddingBottom: win.padBottom }} className="pb-1">
            {rows.slice(win.range.start, win.range.end).map((r, k) => {
              const i = win.range.start + k
              if (r.kind === 'heading') {
                return (
                  <li key={r.key} style={{ height: HEADING_HEIGHT }} className="flex items-end px-2 pb-1 text-[12px] text-muted">
                    <h3 className="truncate">{r.title}</h3>
                  </li>
                )
              }
              return <SessionRow key={r.entry.key} entry={r.entry} current={r.entry.key === open} now={now} row={i} tabIndex={roving.tabIndexFor(i)} />
            })}
          </ul>
        )}
      </div>

      <button
        type="button"
        aria-current={nav.page === 'sessions' ? 'page' : undefined}
        onClick={() => go({ page: 'sessions' })}
        className="press mx-2.5 mt-1 flex h-8 flex-none items-center gap-2.5 rounded-lg px-2 text-[14px] text-ink/80 outline-none hover:bg-active/60 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent aria-[current=page]:bg-active aria-[current=page]:font-medium aria-[current=page]:text-ink"
      >
        All sessions
        <ChevronRight size={16} strokeWidth={1.75} aria-hidden className="ml-auto text-muted" />
      </button>
    </section>
  )
}
