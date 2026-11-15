import { useState } from 'react'
import { Terminal } from 'lucide-react'
import type { AttentionItem, Session } from '@shared/snapshot'
import { useUi } from '@/store'
import { ago } from '@/lib/format'
import { byPriority, sessionIndex, waitingWithoutItem } from '@/lib/selectors'
import { nameOf } from '@/lib/sessionMeta'
import { shortAgo } from '@/lib/sessionList'
import { sessionAction } from '@/lib/act'
import { KIND, AttentionActions, useRevealedItem } from '../NeedsYou'
import { SessionMenu } from '../session-menu/SessionMenu'
import { CountBadge, cn } from '../ui'

/** Every row is in the list and scrolls, so a revealed one never needs anything expanded. */
const NO_EXPAND = (): void => undefined

const ROW = 'press flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left outline-none hover:bg-active/60 focus-visible:ring-2 focus-visible:ring-accent'

interface ItemProps {
  item: AttentionItem
  session: Session | undefined
  now: number
  open: boolean
  flash: boolean
  onToggle(): void
  rowRef(el: HTMLLIElement | null): void
}

/** One item that waits, on one line: what kind, what it asks, how long. Click it for where it is from and the buttons that answer it. */
function Item({ item, session, now, open, flash, onToggle, rowRef }: ItemProps) {
  const k = KIND[item.kind]
  const name = useUi((s) => (session ? nameOf(s.sessionMeta, session) : 'Unknown session'))
  const panel = `sb-need-${item.id}`
  const row = (
    <li ref={rowRef} tabIndex={-1} data-item={item.id} className={cn('flex-none rounded-lg outline-none transition-[background-color] duration-300', flash ? 'bg-[var(--needs-bg)]' : open && 'bg-active/60')}>
      <button type="button" aria-expanded={open} aria-controls={open ? panel : undefined} onClick={onToggle} title={item.title.replace(/`/g, '')} className={ROW}>
        <span role="img" aria-label={k.label} className="flex flex-none" style={{ color: `var(--${k.tone}-ink)` }}>
          <k.icon size={16} strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-ink">{item.title.replace(/`/g, '')}</span>
        <span className="flex-none text-[12px] tabular-nums text-muted">{shortAgo(item.openedAt, now)}</span>
      </button>
      {open && (
        <div id={panel} className="px-2 pb-2">
          <p className="truncate pl-[26px] text-[12px] leading-4 text-muted">
            {name} · {ago(now - item.openedAt)}
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
            <AttentionActions item={item} session={session} />
          </div>
        </div>
      )}
    </li>
  )
  return session ? <SessionMenu session={session}>{row}</SessionMenu> : row
}

/** A session the poll saw waiting with no item to name (D-054): it must never read as "nothing needs you". One click goes to its window. */
function Elsewhere({ session }: { session: Session }) {
  const name = useUi((s) => nameOf(s.sessionMeta, session))
  return (
    <li className="flex-none">
      <button type="button" aria-label={`${name}, waiting in its own window. Go to window`} title="Waiting in its own window" onClick={() => void sessionAction('focus-terminal', session)} className={ROW}>
        <Terminal size={16} strokeWidth={1.75} aria-hidden className="flex-none" style={{ color: 'var(--needs-ink)' }} />
        <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-ink">{name}</span>
        <span className="flex-none text-[12px] text-muted">Go to window</span>
      </button>
    </li>
  )
}

/**
 * Needs you, in the sidebar on every page (IA § 3): only when something waits, one quiet line per item, the most urgent first. Click a
 * line to answer it there; a toast you click opens its line. The list scrolls inside a short region of its own and gives way first
 * in a short window, so a long queue never pushes your sessions out of the window.
 */
export function SidebarNeeds() {
  const snapshot = useUi((s) => s.snapshot)
  const now = useUi((s) => s.now)
  const { flash, rows } = useRevealedItem(NO_EXPAND)
  const [open, setOpen] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<string | null>(null)
  // A toast was clicked: open that line too, once (adjusting state while rendering, not in an effect).
  if (flash !== revealed) {
    setRevealed(flash)
    if (flash) setOpen(flash)
  }
  const items = byPriority(snapshot.attention)
  const elsewhere = waitingWithoutItem(snapshot).filter((s) => !items.some((i) => i.sessionId === s.id))
  const sessions = sessionIndex(snapshot)
  const total = items.length + elsewhere.length
  if (total === 0) return null
  const urgent = items.some((i) => i.priority <= 2) || elsewhere.length > 0

  return (
    <section aria-labelledby="sb-needs" className="flex min-h-[72px] flex-initial flex-col px-2.5 pt-3">
      <header className="flex h-7 flex-none items-center gap-1.5 px-2">
        <h2 id="sb-needs" className="text-[12px] font-medium text-muted">
          Needs you
        </h2>
        <CountBadge n={total} label="open" tone={urgent ? 'needs' : 'neutral'} />
      </header>
      <ul className="flex max-h-[240px] min-h-0 flex-col gap-0.5 overflow-y-auto">
        {items.map((i) => (
          <Item
            key={i.id}
            item={i}
            session={sessions.get(i.sessionId)}
            now={now}
            open={open === i.id}
            flash={flash === i.id}
            onToggle={() => setOpen(open === i.id ? null : i.id)}
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
