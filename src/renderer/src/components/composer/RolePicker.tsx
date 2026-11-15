import { useMemo, useState, type KeyboardEvent, type ReactElement } from 'react'
import * as Popover from '@radix-ui/react-popover'
import type { RoleSummary } from '@shared/roles'
import { cn, menuPanel } from '../ui'
import { MentionList } from './MentionList'
import { menuRows, optionsOf } from './rank'
import type { RoleIndex } from './useRoleIndex'

export type PickerMode = { kind: 'add' } | { kind: 'change'; id: string }

const LIST_ID = 'composer-picker'

/**
 * Choosing an agent without typing `@`: a search box over the same list. It opens beside the chips (the child is its anchor) from the
 * chips' own menus, so the lead can be changed or a helper added with the mouse alone.
 */
export function RolePicker({ mode, index, recent, onPick, onClose, children }: { mode: PickerMode | null; index: RoleIndex; recent: readonly string[]; onPick(role: RoleSummary): void; onClose(): void; children: ReactElement }) {
  return (
    <Popover.Root open={mode !== null} onOpenChange={(o) => !o && onClose()}>
      <Popover.Anchor asChild>{children}</Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          aria-label={mode?.kind === 'change' ? `Change ${index.get(mode.id)?.name ?? 'agent'}` : 'Add an agent'}
          // Closing hands the focus back to whatever opened it, which the chip's menu has already unmounted: put it in the message.
          onCloseAutoFocus={(e) => e.preventDefault()}
          className={cn(menuPanel, 'w-[400px] max-w-[calc(100vw-24px)] p-0')}
        >
          {mode && <Body index={index} recent={recent} onPick={onPick} />}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function Body({ index, recent, onPick }: { index: RoleIndex; recent: readonly string[]; onPick(role: RoleSummary): void }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rows = useMemo(() => menuRows(index.roles, index.divisions, query, { pinned: index.pinned, recent }), [index, query, recent])
  const options = useMemo(() => optionsOf(rows), [rows])
  const at = Math.min(active, Math.max(0, options.length - 1))
  const key = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing) return
    const n = options.length
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(n ? (at + (e.key === 'ArrowDown' ? 1 : -1) + n) % n : 0)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const role = options[at]
      if (role) onPick(role)
    }
  }
  return (
    <>
      <div className="border-b border-line p-1.5">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={key}
          placeholder="Search agents: cto, qa, marketing…"
          aria-label="Search agents"
          role="combobox"
          aria-expanded
          aria-controls={LIST_ID}
          aria-activedescendant={options[at] ? `${LIST_ID}-${options[at].id}` : undefined}
          autoComplete="off"
          spellCheck={false}
          className="h-8 w-full rounded-lg bg-ground px-2.5 text-[13px] outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent"
        />
      </div>
      {options.length > 0 ? (
        <MentionList rows={rows} active={at} listId={LIST_ID} label="Agents" onActive={setActive} onPick={(i) => options[i] && onPick(options[i])} />
      ) : (
        <p role="status" className="px-3 py-4 text-[13px] text-muted">
          {index.ready ? 'No agent matches.' : 'Reading the agents…'}
        </p>
      )}
    </>
  )
}
