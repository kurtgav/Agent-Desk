import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { LayoutGrid, Pin } from 'lucide-react'
import type { RoleDivision } from '@shared/roles'
import { cn } from '../ui'
import { roleIcon } from './icons'

export type RailChoice = { kind: 'all' } | { kind: 'pinned' } | { kind: 'division'; id: string }

interface Item {
  key: string
  label: string
  count: number
  icon: ReturnType<typeof roleIcon>
  choice: RailChoice
}

interface RailProps {
  divisions: RoleDivision[]
  total: number
  pinned: number
  current: RailChoice
  onChoose(c: RailChoice): void
  /** Under the list: where roles come from, and how to update them. */
  footer: ReactNode
}

const same = (a: RailChoice, b: RailChoice): boolean => a.kind === b.kind && (a.kind !== 'division' || (b.kind === 'division' && a.id === b.id))

/**
 * The divisions as a list down the left: All roles and Pinned first, then Leadership, the clone's divisions, Custom and Your agents.
 * Icons are neutral (the colour is on the cards' faces); the current one is the page's only filled row. One tab stop; arrows move.
 */
export function DivisionRail({ divisions, total, pinned, current, onChoose, footer }: RailProps) {
  const list = useRef<HTMLUListElement>(null)
  const lead: Item[] = [
    { key: 'all', label: 'All roles', count: total, icon: LayoutGrid, choice: { kind: 'all' } },
    { key: 'pinned', label: 'Pinned', count: pinned, icon: Pin, choice: { kind: 'pinned' } }
  ]
  const items: Item[] = [...lead, ...divisions.map((d): Item => ({ key: d.id, label: d.label, count: d.count, icon: roleIcon(d.icon), choice: { kind: 'division', id: d.id } }))]
  const stop = items.find((i) => same(i.choice, current))?.key ?? 'all'

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>): void => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button[data-rail]') ?? [])]
    const i = buttons.findIndex((b) => b === document.activeElement)
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : Math.min(buttons.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))
    buttons[to]?.focus()
  }

  return (
    <aside aria-label="Role divisions" className="sticky top-6 flex max-h-[calc(100vh-7rem)] w-[208px] flex-none flex-col self-start">
      <nav aria-label="Divisions" className="scroll-fade -mx-1 min-h-0 flex-1 overflow-y-auto px-1 py-1">
        <ul ref={list} onKeyDown={onKeyDown} className="flex flex-col gap-0.5">
          {items.map((it, i) => {
            const on = same(it.choice, current)
            const Icon = it.icon
            return (
              <li key={it.key}>
                {i === 2 && <h2 className="px-2 pb-1 pt-4 text-[12px] font-medium text-muted">Divisions</h2>}
                <button
                  type="button"
                  data-rail
                  tabIndex={it.key === stop ? 0 : -1}
                  aria-current={on ? 'true' : undefined}
                  onClick={() => onChoose(it.choice)}
                  className={cn(
                    'flex h-[30px] w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] transition-colors',
                    on ? 'bg-active font-medium text-ink' : 'text-ink hover:bg-active/60'
                  )}
                >
                  <Icon size={15} strokeWidth={1.75} aria-hidden className={cn('flex-none', on ? 'text-ink' : 'text-muted')} />
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  <span className="text-[12px] tabular-nums text-muted">{it.count}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="mt-3 flex-none border-t border-line pt-3">{footer}</div>
    </aside>
  )
}
