import { useEffect, useMemo, useRef, useState } from 'react'
import type { RoleSummary } from '@shared/roles'
import { RoleEmoji } from '../roles/RoleEmoji'
import { cn } from '../ui'
import type { MenuRow } from './rank'
import { layoutOf, rangeAt, scrollToShow, topFor } from './window'

export const optionId = (listId: string, role: RoleSummary): string => `${listId}-${role.id}`

/** The list's tallest view: about seven roles. */
export const LIST_MAX_H = 360

interface Props {
  rows: readonly MenuRow[]
  /** Index among the roles (headers do not count): what the keys walk and Enter chooses. */
  active: number
  listId: string
  label: string
  onPick(option: number): void
  onActive(option: number): void
  /** The most it may take, in pixels: the room the menu has on screen. */
  room?: number
}

/**
 * Every agent, in a listbox that only draws what is in view: about 350 rows are laid out by arithmetic and the page holds a dozen,
 * so it opens at once. The box keeps the focus; this is a `listbox` the textarea points at with aria-activedescendant. The active
 * row is always drawn, so that pointer stays valid wherever the list is scrolled.
 */
export function MentionList({ rows, active, listId, label, onPick, onActive, room = LIST_MAX_H }: Props) {
  const layout = useMemo(() => layoutOf(rows), [rows])
  const optionRows = useMemo(() => rows.flatMap((r, i) => (r.kind === 'role' ? [i] : [])), [rows])
  const scroller = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const height = Math.max(96, Math.min(LIST_MAX_H, room, layout.total + 8))

  // A new list starts at the top.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0
  }, [rows])
  // The highlighted role, and its group's name when it is the first of the group, stay in view.
  useEffect(() => {
    const el = scroller.current
    const row = optionRows[active]
    if (!el || row === undefined) return
    const { top, height: h } = topFor(layout, row, rows)
    const next = scrollToShow(top, h, el.scrollTop, el.clientHeight - 8)
    if (next !== el.scrollTop) el.scrollTop = next
  }, [active, layout, optionRows, rows])

  const [from, to] = rangeAt(layout, scrollTop, height)
  const activeRow = optionRows[active]
  const drawn = new Set<number>()
  for (let i = from; i < to; i++) drawn.add(i)
  if (activeRow !== undefined) drawn.add(activeRow)

  return (
    <div ref={scroller} tabIndex={0} onMouseDown={(e) => e.preventDefault()} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} style={{ height }} className="overflow-y-auto overscroll-contain p-1 outline-none">
      <ul id={listId} role="listbox" aria-label={label} className="relative m-0 list-none p-0" style={{ height: layout.total }}>
        {[...drawn].sort((a, b) => a - b).map((i) => {
          const row = rows[i]!
          const style = { top: layout.tops[i], height: layout.heights[i] }
          if (row.kind === 'header') {
            return (
              <li key={`h-${row.id}`} role="presentation" aria-hidden style={style} className="absolute inset-x-0 flex items-end justify-between px-2 pb-1 text-[12px] font-medium text-muted">
                <span>{row.label}</span>
                <span className="tabular-nums">{row.count}</span>
              </li>
            )
          }
          const option = optionRows.indexOf(i)
          const on = option === active
          const r = row.role
          return (
            <li
              key={r.id}
              id={optionId(listId, r)}
              role="option"
              aria-selected={on}
              aria-posinset={option + 1}
              aria-setsize={optionRows.length}
              style={style}
              onMouseMove={() => !on && onActive(option)}
              // mousedown, not click: the box must keep the caret and the focus.
              onMouseDown={(e) => {
                e.preventDefault()
                onPick(option)
              }}
              className={cn('absolute inset-x-0 flex cursor-default items-center gap-3 rounded-lg px-2', on && 'bg-hover')}
            >
              <RoleEmoji role={r} size={32} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-[13px] font-medium">{r.name}</span>
                  <span className="flex-none text-[12px] text-muted">{r.divisionLabel}</span>
                </span>
                <span className="block truncate text-[12px] leading-4 text-muted">{r.vibe || r.description}</span>
              </span>
              <span className="hidden flex-none text-[12px] text-muted min-[560px]:inline">@{r.id.length > 22 ? `${r.id.slice(0, 21)}…` : r.id}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
