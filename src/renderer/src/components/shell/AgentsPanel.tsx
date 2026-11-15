import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import type { RolesCatalog } from '@shared/roles'
import { useUi } from '@/store'
import { agentRows, recentRoleIds, type AgentRow } from '@/lib/agentsTree'
import { Button, CountBadge, EmptyState, Hint, Skeleton, cn } from '../ui'
import { useRolesCatalog, useRolesStore } from '../roles/store'
import { startSessionAs } from './actions'
import { useEntries } from './useEntries'
import { useRoving } from './useRoving'
import { useWindowed } from './useWindowed'

const ROW_HEIGHT = 32
/** A closed division list is short and drawn whole; with every division open (or a broad filter) only the rows on screen are. */
const WINDOW_AFTER_ROWS = 60

function Heading({ row, index, tabIndex }: { row: Extract<AgentRow, { kind: 'heading' }>; index: number; tabIndex: 0 | -1 }) {
  const toggle = useUi((s) => s.toggleAgentSection)
  return (
    <li data-row={index} style={{ height: ROW_HEIGHT }}>
      <button
        type="button"
        data-focus
        tabIndex={tabIndex}
        aria-expanded={row.open}
        onClick={() => toggle(row.id)}
        className="press flex h-full w-full items-center gap-1.5 rounded-lg px-2 text-left text-[12px] font-medium text-muted outline-none hover:bg-active/60 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
      >
        <ChevronRight size={13} strokeWidth={1.75} aria-hidden className={cn('flex-none transition-transform motion-reduce:transition-none', row.open && 'rotate-90')} />
        {row.color && <span aria-hidden className="size-1.5 flex-none rounded-full" style={{ background: row.color }} />}
        <span className="truncate">{row.label}</span>
        <span className="ml-auto flex-none tabular-nums">{row.count}</span>
      </button>
    </li>
  )
}

function Agent({ row, index, tabIndex }: { row: Extract<AgentRow, { kind: 'role' }>; index: number; tabIndex: 0 | -1 }) {
  const { role } = row
  return (
    <li data-row={index} style={{ height: ROW_HEIGHT }}>
      <Hint
        side="right"
        label={
          <span className="block">
            <span className="block font-medium">{role.name}</span>
            <span className="block">{role.vibe || role.description}</span>
          </span>
        }
      >
        <button
          type="button"
          data-focus
          tabIndex={tabIndex}
          onClick={() => startSessionAs(role.id)}
          aria-label={`${role.name}: start a session`}
          className="press flex h-full w-full items-center gap-2 rounded-lg px-2 pl-4 text-left text-[13px] outline-none hover:bg-active/60 focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span aria-hidden className="w-5 flex-none text-center text-[14px] leading-none">
            {role.emoji}
          </span>
          <span className="truncate">{role.name}</span>
        </button>
      </Hint>
    </li>
  )
}

function List({ catalog, query }: { catalog: RolesCatalog; query: string }) {
  const entries = useEntries()
  const sections = useUi((s) => s.agentSections)
  const stored = useUi((s) => s.recentRoles)
  const scroller = useRef<HTMLDivElement>(null)
  const view = useMemo(
    () => agentRows(catalog, { query, open: new Set(sections), recent: [...new Set([...stored, ...recentRoleIds(entries.map((e) => e.role))])] }),
    [catalog, query, sections, stored, entries]
  )
  const heights = useMemo(() => view.rows.map(() => ROW_HEIGHT), [view.rows])
  const targets = useMemo(() => view.rows.map((_, i) => i), [view.rows])
  const win = useWindowed(scroller, heights, WINDOW_AFTER_ROWS)
  const roving = useRoving(scroller, targets, win)

  return (
    <div ref={scroller} {...roving.containerProps} className="scroll-fade min-h-0 flex-1 overflow-y-auto px-2.5">
      {view.rows.length === 0 ? (
        <EmptyState center className="px-3 py-4 text-[12px]">
          No agent matches “{query.trim()}”. Try a role such as cto or qa.
        </EmptyState>
      ) : (
        <ul role="list" aria-label={query.trim() ? `${view.matches} matching agents` : 'Agents by team'} style={{ paddingTop: win.padTop, paddingBottom: win.padBottom }} className="pb-1">
          {view.rows.slice(win.range.start, win.range.end).map((r, k) => {
            const i = win.range.start + k
            return r.kind === 'heading' ? <Heading key={r.id} row={r} index={i} tabIndex={roving.tabIndexFor(i)} /> : <Agent key={r.id} row={r} index={i} tabIndex={roving.tabIndexFor(i)} />
          })}
        </ul>
      )}
    </div>
  )
}

/** What the panel shows before there is a catalog: still reading, could not read, or nothing to read. */
function Unavailable({ phase }: { phase: 'idle' | 'loading' | 'ready' | 'error' }) {
  const go = useUi((s) => s.go)
  if (phase === 'error') {
    return (
      <div role="alert" className="px-4 py-3 text-[12px] leading-4 text-muted">
        <p>AgentDeck could not read your agents. Your sessions are not affected.</p>
        <Button size="sm" className="mt-2" onClick={() => void useRolesStore.getState().load()}>
          Try again
        </Button>
      </div>
    )
  }
  if (phase === 'ready') {
    return (
      <div className="px-4 py-3 text-[12px] leading-4 text-muted">
        <p>No agents found yet.</p>
        <Button size="sm" className="mt-2" onClick={() => go({ page: 'roles' })}>
          Set up agents
        </Button>
      </div>
    )
  }
  return (
    <div role="status" aria-label="Loading agents" className="flex flex-col gap-1.5 px-4 pt-1">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-6" />
      ))}
    </div>
  )
}

/**
 * Every agent, always reachable (IA § 3): Favourites, Leadership, then each division with its count. The filter looks through all of
 * them; a click starts a new session as that agent. About 350 rows are drawn by window, so the panel opens instantly.
 */
export function AgentsPanel() {
  const open = useUi((s) => s.agentsOpen)
  const setOpen = useUi((s) => s.setAgentsOpen)
  const tick = useUi((s) => s.agentsFocusTick)
  const go = useUi((s) => s.go)
  const { catalog, phase } = useRolesCatalog()
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (tick > 0) input.current?.focus()
  }, [tick])

  const total = catalog?.roles.length ?? 0
  return (
    <section aria-labelledby="sb-agents" className={cn('flex flex-col', open ? 'min-h-[132px] flex-[2]' : 'flex-none')}>
      <header className="flex h-8 flex-none items-center gap-1 px-2.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="agents-body"
          onClick={() => setOpen(!open)}
          className="press flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[12px] font-medium text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ChevronRight size={13} strokeWidth={1.75} aria-hidden className={cn('transition-transform motion-reduce:transition-none', open && 'rotate-90')} />
          <h2 id="sb-agents">Agents</h2>
          {total > 0 && <CountBadge n={total} label="agents" />}
        </button>
        <button type="button" onClick={() => go({ page: 'roles' })} className="press ml-auto rounded-md px-1.5 text-[12px] text-muted hover:text-ink">
          See all agents
        </button>
      </header>
      {open && (
        <div id="agents-body" className="flex min-h-0 flex-1 flex-col">
          {catalog && total > 0 ? (
            <>
              <div className="relative mx-2.5 mb-1 flex-none text-muted focus-within:text-ink">
                <Search size={13} strokeWidth={1.75} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  ref={input}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && query) {
                      e.preventDefault()
                      e.stopPropagation()
                      setQuery('')
                    }
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      document.querySelector<HTMLElement>('#agents-body [data-row] [data-focus][tabindex="0"]')?.focus()
                    }
                  }}
                  aria-label="Filter agents"
                  aria-keyshortcuts="Control+Shift+A"
                  placeholder="Filter agents"
                  className="h-8 w-full rounded-full bg-well pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>
              <List catalog={catalog} query={query} />
            </>
          ) : (
            <Unavailable phase={phase} />
          )}
        </div>
      )}
    </section>
  )
}
