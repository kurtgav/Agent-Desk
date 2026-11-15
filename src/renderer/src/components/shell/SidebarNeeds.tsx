import type { AttentionItem, Session } from '@shared/snapshot'
import { useUi } from '@/store'
import { ago } from '@/lib/format'
import { byPriority, sessionIndex, waitingWithoutItem } from '@/lib/selectors'
import { nameOf } from '@/lib/sessionMeta'
import { sessionAction } from '@/lib/act'
import { KIND, AttentionActions, useRevealedItem } from '../NeedsYou'
import { SessionMenu } from '../session-menu/SessionMenu'
import { Button, CountBadge, Inline, cn } from '../ui'

/** Every row is in the list and scrolls, so a revealed one never needs anything expanded. */
const NO_EXPAND = (): void => undefined

/** One item that waits, small enough to stack in a sidebar: what it asks, where, how long, and the buttons that answer it. */
function Item({ item, session, now, flash, rowRef }: { item: AttentionItem; session: Session | undefined; now: number; flash: boolean; rowRef: (el: HTMLLIElement | null) => void }) {
  const k = KIND[item.kind]
  const open = useUi((s) => s.openSession)
  const name = useUi((s) => (session ? nameOf(s.sessionMeta, session) : 'Unknown session'))
  const row = (
    <li
      ref={rowRef}
      tabIndex={-1}
      data-item={item.id}
      className={cn('flex-none rounded-tile border border-line bg-surface p-2.5 outline-none transition-[background-color] duration-300', flash && 'bg-[var(--needs-bg)]')}
    >
      <button type="button" onClick={() => open(item.sessionId)} className="flex w-full items-start gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <span className="mt-px grid size-6 flex-none place-items-center rounded-md" style={{ background: `var(--${k.tone}-bg)`, color: `var(--${k.tone}-ink)` }} role="img" aria-label={k.label}>
          <k.icon size={14} strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 block text-[13px] font-medium leading-[18px] [overflow-wrap:anywhere]">
            <Inline text={item.title} />
          </span>
          <span className="block truncate text-[12px] leading-4 text-muted">
            {name} · {ago(now - item.openedAt)}
          </span>
        </span>
      </button>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
        <AttentionActions item={item} session={session} />
      </div>
    </li>
  )
  return session ? <SessionMenu session={session}>{row}</SessionMenu> : row
}

/** A session the poll saw waiting with no item to name (D-054): it must never read as "nothing needs you". */
function Elsewhere({ session }: { session: Session }) {
  const name = useUi((s) => nameOf(s.sessionMeta, session))
  return (
    <li className="flex-none rounded-tile border border-line bg-surface p-2.5">
      <p className="truncate text-[13px] font-medium leading-[18px]">{name}</p>
      <p className="text-[12px] leading-4 text-muted">Waiting in its own window.</p>
      <div className="mt-2 flex justify-end">
        <Button size="sm" onClick={() => void sessionAction('focus-terminal', session)}>
          Go to window
        </Button>
      </div>
    </li>
  )
}

/**
 * Needs you, in the sidebar on every page (IA § 3): only when something waits, with the same answers as the Overview card. The rows
 * scroll inside a region of their own (the most urgent first), so a long queue never pushes the sessions and agents out of the window.
 */
export function SidebarNeeds() {
  const snapshot = useUi((s) => s.snapshot)
  const now = useUi((s) => s.now)
  const go = useUi((s) => s.go)
  const { flash, rows } = useRevealedItem(NO_EXPAND)
  const items = byPriority(snapshot.attention)
  const elsewhere = waitingWithoutItem(snapshot).filter((s) => !items.some((i) => i.sessionId === s.id))
  const sessions = sessionIndex(snapshot)
  const total = items.length + elsewhere.length
  if (total === 0) return null
  const urgent = items.some((i) => i.priority <= 2) || elsewhere.length > 0

  return (
    <section aria-labelledby="sb-needs" className="flex min-h-0 flex-none flex-col px-2.5 pb-1 pt-3">
      <header className="flex h-6 flex-none items-center gap-1.5 px-1.5">
        <h2 id="sb-needs" className="text-[12px] font-medium text-muted">
          Needs you
        </h2>
        <CountBadge n={total} label="open" tone={urgent ? 'needs' : 'neutral'} />
        <button type="button" onClick={() => go({ page: 'approvals' })} className="press ml-auto rounded-md px-1.5 text-[12px] text-muted hover:text-ink">
          Approvals
        </button>
      </header>
      <ul className="mt-1 flex max-h-[30vh] flex-col gap-1.5 overflow-y-auto pb-0.5">
        {items.map((i) => (
          <Item
            key={i.id}
            item={i}
            session={sessions.get(i.sessionId)}
            now={now}
            flash={flash === i.id}
            rowRef={(el) => {
              if (el) rows.set(i.id, el)
              else rows.delete(i.id)
            }}
          />
        ))}
        {elsewhere.map((s) => (
          <Elsewhere key={s.id} session={s} />
        ))}
      </ul>
    </section>
  )
}
