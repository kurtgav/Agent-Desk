import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Pin } from 'lucide-react'
import type { RoleHit, RoleSummary } from '@shared/roles'
import { Button, CountBadge } from '../ui'
import { roleIcon } from './icons'
import { capFor, nextCard, type Box, type NavKey, type Section } from './logic'
import { RoleCard } from './RoleCard'
import { useColumns, MIN_CARD } from './useColumns'

interface BrowserProps {
  /** Null = one flat list (a search, a division, Pinned); otherwise the grouped front page. */
  sections: Section[] | null
  flat: RoleSummary[]
  hits: ReadonlyMap<string, RoleHit> | null
  pinned: readonly string[]
  /** The list mixes divisions, so cards name theirs. */
  showDivision: boolean
  onOpen(id: string): void
  onPin(id: string): void
  onSeeAll(divisionId: string): void
  /** What to show when there is nothing. */
  empty: ReactNode
}

const KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']

/**
 * The cards. One tab stop for the whole page: the arrow keys move between cards by where they are on screen (across the sections'
 * grids too), Home and End jump to the ends, Enter opens, and P pins the focused card.
 */
export function RoleBrowser({ sections, flat, hits, pinned, showDivision, onOpen, onPin, onSeeAll, empty }: BrowserProps) {
  const [measure, columns] = useColumns()
  const root = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<string | null>(null)
  const setRoot = useCallback(
    (el: HTMLDivElement | null) => {
      root.current = el
      measure(el)
    },
    [measure]
  )
  const pins = new Set(pinned)

  // What is on screen, in reading order. The tab stop is the last card used if it is still here, otherwise the first.
  const rows = sections ? sections.map((s) => ({ section: s, roles: s.roles.slice(0, capFor(s, columns)) })) : null
  const ids = rows ? rows.flatMap((r) => r.roles.map((x) => x.id)) : flat.map((r) => r.id)
  const stop = active && ids.includes(active) ? active : (ids[0] ?? null)

  const grid = (roles: RoleSummary[]): ReactNode => (
    <ul className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${MIN_CARD}px, 1fr))` }}>
      {roles.map((r) => (
        <RoleCard
          key={r.id}
          role={r}
          pinned={pins.has(r.id)}
          active={r.id === stop}
          matched={hits?.get(r.id)?.matched}
          showDivision={showDivision}
          onOpen={() => {
            setActive(r.id)
            onOpen(r.id)
          }}
          onPin={() => onPin(r.id)}
        />
      ))}
    </ul>
  )

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('[data-role-card]')
    if (!card || e.ctrlKey || e.metaKey || e.altKey) return
    const id = card.dataset.roleCard!
    if (e.key.toLowerCase() === 'p' && !e.shiftKey) {
      e.preventDefault()
      onPin(id)
      return
    }
    if (!KEYS.includes(e.key)) return
    e.preventDefault()
    const cards = [...(root.current?.querySelectorAll<HTMLElement>('[data-role-card]') ?? [])]
    const boxes: Box[] = cards.map((c) => {
      const r = c.getBoundingClientRect()
      return { id: c.dataset.roleCard!, x: r.left, y: r.top, w: r.width, h: r.height }
    })
    const to = nextCard(boxes, id, e.key as NavKey)
    setActive(to)
    cards.find((c) => c.dataset.roleCard === to)?.focus()
  }

  return (
    <div ref={setRoot} onKeyDown={onKeyDown} className="min-w-0 flex-1">
      {ids.length === 0
        ? empty
        : rows
          ? rows.map(({ section: s, roles }) => {
              const Icon = s.division ? roleIcon(s.division.icon) : s.id === 'pinned' ? Pin : null
              return (
                <section key={s.id} aria-labelledby={`section-${s.id}`} className="mb-7 last:mb-0">
                  <header className="mb-3 flex h-8 items-center gap-2.5">
                    {Icon && (
                      <span className="flex size-6 flex-none items-center justify-center rounded-lg text-ink" style={{ background: s.division ? `color-mix(in oklab, ${s.division.color} 17%, var(--surface))` : 'var(--well)' }}>
                        <Icon size={14} strokeWidth={1.75} aria-hidden />
                      </span>
                    )}
                    <h2 id={`section-${s.id}`} className="t-title">
                      {s.label}
                    </h2>
                    <CountBadge n={s.roles.length} label={s.roles.length === 1 ? 'role' : 'roles'} />
                    {s.id !== 'pinned' && s.roles.length > roles.length && (
                      <Button variant="quiet" size="sm" className="ml-auto" aria-label={`Show all ${s.roles.length} ${s.label} roles`} onClick={() => onSeeAll(s.id)}>
                        Show all {s.roles.length}
                      </Button>
                    )}
                  </header>
                  {grid(roles)}
                </section>
              )
            })
          : grid(flat)}
    </div>
  )
}
