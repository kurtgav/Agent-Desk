import { useEffect, useRef } from 'react'
import { Tag, cn } from '../ui'
import type { Completion } from './slash'

export const SLASH_LIST_ID = 'composer-slash'
export const slashOptionId = (c: Completion): string => `composer-slash-${c.id.replace(/[^\w-]/g, '_')}`

/** Why a `/` menu has nothing to list: no conversation has reported its commands yet, or nothing matches what was typed. */
export type SlashNote = 'load' | 'none'

/** The `/` menu's content: commands and skills as real `option` rows (the box keeps focus and points at one), or the note that says why there are none. */
export function SlashList({ items, index, note, onPick, onActive }: { items: readonly Completion[]; index: number; note: SlashNote | null; onPick(i: number): void; onActive(i: number): void }) {
  const list = useRef<HTMLUListElement>(null)
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index, items])
  if (items.length === 0) {
    return (
      <p className="rounded-tile border border-line bg-overlay px-3 py-2.5 text-[13px] text-muted shadow-pop">
        {note === 'load' ? 'Start the conversation to load them. A new one shows its own commands and skills as soon as Claude Code starts.' : 'Nothing matches.'}
      </p>
    )
  }
  return (
    <ul ref={list} id={SLASH_LIST_ID} role="listbox" tabIndex={0} onMouseDown={(e) => e.preventDefault()} aria-label="Commands and skills" className="max-h-72 overflow-y-auto rounded-tile border border-line bg-overlay p-1 text-[13px] shadow-pop outline-none">
      {items.map((c, i) => (
        <li
          key={c.id}
          id={slashOptionId(c)}
          role="option"
          aria-selected={i === index}
          onMouseMove={() => i !== index && onActive(i)}
          // mousedown, not click: the box must keep the caret and focus.
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(i)
          }}
          className={cn('flex cursor-default items-baseline gap-2 rounded-lg px-2.5 py-1.5', i === index && 'bg-well')}
        >
          <span className="flex-none font-medium">/{c.name}</span>
          {c.hint && <span className="flex-none text-[12px] text-muted">{c.hint}</span>}
          <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{c.description}</span>
          <Tag className="self-center">{c.kind}</Tag>
        </li>
      ))}
    </ul>
  )
}
