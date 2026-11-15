import * as Menu from '@radix-ui/react-dropdown-menu'
import { AtSign, ChevronDown, Plus, X } from 'lucide-react'
import type { RoleSummary } from '@shared/roles'
import { RoleEmoji } from '../roles/RoleEmoji'
import { Button, IconButton, cn, menuItem, menuPanel } from '../ui'
import { MENTIONS_MAX, type Variant } from './types'
import type { RoleIndex } from './useRoleIndex'

export interface ChipActions {
  onRemove(id: string): void
  onLead(id: string): void
  onChange(id: string): void
  onAdd(): void
}

/** The same tint the pill behind the text has, so a chip and the mention it stands for read as one thing. */
const tint = (color: string, pct: number) => ({
  background: `color-mix(in oklab, ${color} ${pct}%, var(--surface))`,
  boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} ${pct + 12}%, transparent)`
})

function Chip({ role, lead, actions }: { role: RoleSummary; lead: boolean; actions: ChipActions }) {
  return (
    <span className="inline-flex h-7 items-center rounded-full pl-1 pr-0.5" style={tint(role.color, lead ? 22 : 14)} data-role-chip={role.id}>
      <Menu.Root>
        <Menu.Trigger asChild>
          <button type="button" aria-label={`${lead ? 'Leading' : 'Also'}: ${role.name}. Change`} className="press flex h-7 items-center gap-1.5 rounded-full pr-1 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <RoleEmoji emoji={role.emoji} color={role.color} size={20} />
            <span className="max-w-32 truncate">{role.name}</span>
            <ChevronDown size={12} strokeWidth={1.75} aria-hidden className="text-muted" />
          </button>
        </Menu.Trigger>
        <Menu.Portal>
          {/* Every choice puts the focus where it belongs (the message, or the picker it opens), so the menu does not take it back. */}
          <Menu.Content align="start" sideOffset={6} className={cn(menuPanel, 'w-52')} onCloseAutoFocus={(e) => e.preventDefault()}>
            {!lead && (
              <Menu.Item className={menuItem} onSelect={() => actions.onLead(role.id)}>
                Make {role.name} the lead
              </Menu.Item>
            )}
            <Menu.Item className={menuItem} onSelect={() => actions.onChange(role.id)}>
              Change agent…
            </Menu.Item>
            <Menu.Item className={menuItem} onSelect={() => actions.onRemove(role.id)}>
              Remove
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      <button
        type="button"
        aria-label={`Remove ${role.name}`}
        onClick={() => actions.onRemove(role.id)}
        className="press grid size-6 flex-none place-items-center rounded-full text-muted outline-none hover:bg-active hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
      >
        <X size={12} strokeWidth={1.75} aria-hidden />
      </button>
    </span>
  )
}

const WORD: Record<Variant, string> = { 'new-session': 'Leading', reply: 'Asking', task: '' }

/**
 * The agents in the message, as chips under the text: `Leading` and `Also` for a new session, who a reply is addressed to, the agent
 * of a task. They are the same mentions that are in the text (taking one out here takes it out of the text), and with none yet there is
 * one quiet chip that opens the list.
 */
export function RoleChips({ variant, ids, index, actions, className }: { variant: Variant; ids: readonly string[]; index: RoleIndex; actions: ChipActions; className?: string }) {
  const roles = ids.flatMap((id) => index.get(id) ?? [])
  const full = roles.length >= MENTIONS_MAX[variant]
  if (roles.length === 0) {
    return (
      <Button variant="ghost" size="sm" className={cn('px-2.5 text-muted', className)} onClick={actions.onAdd} aria-label={variant === 'task' ? 'Pick an agent for this task' : 'Choose an agent. You can also type @'}>
        <AtSign size={14} strokeWidth={1.75} aria-hidden />
        <span>{variant === 'task' ? 'Agent' : 'Choose an agent'}</span>
      </Button>
    )
  }
  const [first, ...rest] = roles
  return (
    <span role="group" aria-label="Agents in this message" className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {WORD[variant] && <span className="t-meta text-muted">{WORD[variant]}</span>}
      <Chip role={first!} lead actions={actions} />
      {rest.length > 0 && <span className="t-meta text-muted">Also</span>}
      {rest.map((r) => (
        <Chip key={r.id} role={r} lead={false} actions={actions} />
      ))}
      {!full && (
        <IconButton aria-label="Add another agent" className="size-7" onClick={actions.onAdd}>
          <Plus size={15} strokeWidth={1.75} aria-hidden />
        </IconButton>
      )}
    </span>
  )
}
