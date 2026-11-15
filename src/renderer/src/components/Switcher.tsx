import * as Menu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown } from 'lucide-react'
import { useUi } from '@/store'
import { Mark } from './Avatar'
import { openSettings } from './settings/actions'
import { cn, menuItem, menuLabel, menuPanel, menuSeparator } from './ui'

/** The workspace menu: the build, the Demo data switch and Diagnostics. */
export function Switcher({ collapsed }: { collapsed: boolean }) {
  const version = useUi((s) => s.version)
  const demo = useUi((s) => s.snapshot.mode === 'demo')
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button
          type="button"
          aria-label="Third Code workspace menu"
          className="app-no-drag press flex h-8 items-center gap-2 rounded-lg px-1.5 enabled:hover:bg-active"
        >
          <Mark size={20} />
          {!collapsed && (
            <>
              <span className="text-[14px] font-semibold">Third Code</span>
              <ChevronDown size={14} strokeWidth={1.75} className="text-muted" />
            </>
          )}
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="start" sideOffset={6} className={menuPanel}>
          <Menu.Label className={menuLabel}>AgentDeck {version}</Menu.Label>
          {/* ADR-0011: main switches the data source and reloads the window into the new mode. */}
          <Menu.CheckboxItem checked={demo} onCheckedChange={(on) => void window.agentdeck?.setDemo(on)} className={cn(menuItem, 'items-start')}>
            <span className="mt-0.5 w-3.5 flex-none">
              <Menu.ItemIndicator>
                <Check size={14} strokeWidth={1.75} className="text-ink" />
              </Menu.ItemIndicator>
            </span>
            <span className="flex flex-col">
              <span>Demo data</span>
              <span className="text-[12px] text-muted">{demo ? 'Showing sample sessions' : 'Off: showing your sessions'}</span>
            </span>
          </Menu.CheckboxItem>
          <Menu.Separator className={menuSeparator} />
          <Menu.Item onSelect={() => openSettings('diagnostics')} className={menuItem}>
            <span className="w-3.5 flex-none" />
            Diagnostics
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}
