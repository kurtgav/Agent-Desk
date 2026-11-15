import * as Menu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, FolderClosed, type LucideIcon } from 'lucide-react'
import { projectName } from '@/lib/selectors'
import { Button, Hint, Tag, cn, menuItem, menuLabel, menuPanel } from '../ui'
import { ProjectMenu } from '../work/ProjectMenu'

export interface Choice {
  id: string
  label: string
  hint?: string
}

/** One setting of a new conversation: a chip that opens its choices, each with a line saying what it means. */
export function Setting({ icon: I, name, current, choices, onPick, width = 'w-72' }: { icon: LucideIcon; name: string; current: string; choices: Choice[]; onPick(id: string): void; width?: string }) {
  const label = choices.find((c) => c.id === current)?.label ?? current
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button variant="ghost" size="sm" className="px-2.5 text-muted" aria-label={`${name}: ${label}. Change ${name.toLowerCase()}`}>
          <I size={14} strokeWidth={1.75} aria-hidden />
          <span className="text-ink">{label}</span>
          <ChevronDown size={13} strokeWidth={1.75} aria-hidden />
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="start" sideOffset={6} className={cn(menuPanel, width)}>
          <Menu.Label className={menuLabel}>{name}</Menu.Label>
          <Menu.RadioGroup value={current} onValueChange={onPick}>
            {choices.map((c) => (
              <Menu.RadioItem key={c.id} value={c.id} className={cn(menuItem, 'items-start')}>
                <span className="mt-0.5 w-3.5 flex-none">
                  <Menu.ItemIndicator>
                    <Check size={14} className="text-ink" />
                  </Menu.ItemIndicator>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block">{c.label}</span>
                  {c.hint && <span className="block text-pretty text-[12px] leading-4 text-muted">{c.hint}</span>}
                </span>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}

/** The folder the work happens in: the recent projects, Browse…, and (for a task) "No project". */
export function ProjectChip({ cwd, none = false, onPick }: { cwd: string | null; none?: boolean; onPick(cwd: string | null): void }) {
  const name = cwd ? projectName(cwd) : null
  return (
    <ProjectMenu current={cwd} none={none} onPick={onPick}>
      <Button variant="ghost" size="sm" className="-ml-2 px-2.5 text-muted" aria-label={`Project: ${name ?? 'none'}. Change project`}>
        <FolderClosed size={14} strokeWidth={1.75} aria-hidden />
        {name ? <span className="max-w-44 truncate text-ink">{name}</span> : <span>{none ? 'No project' : 'Choose a project'}</span>}
        <ChevronDown size={13} strokeWidth={1.75} aria-hidden />
      </Button>
    </ProjectMenu>
  )
}

/** The settings are fixed once a conversation runs: shown as facts, not controls. */
export function Facts({ items }: { items: string[] }) {
  return (
    <Hint label="Set when the conversation started.">
      <span className="flex flex-wrap items-center gap-1.5 text-muted" tabIndex={0}>
        {items.map((t) => (
          <Tag key={t}>{t}</Tag>
        ))}
      </span>
    </Hint>
  )
}
