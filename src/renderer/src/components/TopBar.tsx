import * as Menu from '@radix-ui/react-dropdown-menu'
import { Ellipsis, House, Plus, Search } from 'lucide-react'
import { useUi } from '@/store'
import { running } from '@/lib/selectors'
import { Avatar } from './Avatar'
import { Button, Hint, IconButton, PENDING_LABEL, pending } from './ui'

const MENU_ITEMS: [string, keyof typeof PENDING_LABEL][] = [
  ['Pause notifications', 'M3'],
  ['Diagnostics', 'M5'],
  ['Settings', 'M5']
]

function ActiveAgents() {
  const active = running(useUi((s) => s.snapshot))
  const shown = active.slice(0, 3)
  const more = active.length - shown.length
  if (!active.length) return null
  return (
    <Hint label={`${active.length} active sessions. ${PENDING_LABEL.M2}`}>
      <button type="button" aria-label={`${active.length} active sessions`} {...pending('M2')} className="flex items-center rounded-full p-0.5 hover:bg-active">
        {shown.map((x, i) => (
          <span key={x.id} className={i ? '-ml-1.5' : ''}>
            <span className="grid size-7 place-items-center rounded-full bg-surface">
              <Avatar seed={x.name} size={22} />
            </span>
          </span>
        ))}
        {more > 0 && (
          <span className="-ml-1.5 grid size-7 place-items-center rounded-full border-2 border-surface bg-well text-[11px] font-semibold tabular-nums text-muted">
            +{more}
          </span>
        )}
      </button>
    </Hint>
  )
}

export function TopBar() {
  const mode = useUi((s) => s.snapshot.mode)
  return (
    <header className="app-drag caption-inset flex h-12 flex-none items-center gap-3 border-b border-line bg-surface pl-4">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-[14px] font-medium">
        <House size={16} strokeWidth={1.75} className="text-muted" />
        <span aria-current="page">Home</span>
      </nav>

      <div className="flex flex-1 justify-center">
        <Hint label={`Search: ${PENDING_LABEL.M2}`}>
          <button
            type="button"
            {...pending('M2')}
            className="app-no-drag flex h-8 w-[300px] items-center gap-2 rounded-full bg-well px-3 text-[13px] text-muted"
          >
            <Search size={14} strokeWidth={1.75} />
            Search sessions, projects, files
            <kbd className="ml-auto font-sans text-[12px]">Ctrl K</kbd>
          </button>
        </Hint>
      </div>

      <div className="app-no-drag flex items-center gap-2">
        {mode === 'demo' && (
          <Hint label="Sample data for the M1 design check. Live data arrives in M2.">
            <span role="status" className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-[var(--needs-bg)] px-2.5 text-[12px] font-medium text-[var(--needs-ink)]">
              <span className="size-1.5 rounded-full bg-[var(--needs)]" aria-hidden />
              Demo data
            </span>
          </Hint>
        )}
        <ActiveAgents />
        <Button onClick={() => document.getElementById('composer-input')?.focus()}>
          <Plus size={15} strokeWidth={1.75} />
          New task
        </Button>
        <Menu.Root>
          <Menu.Trigger asChild>
            <IconButton aria-label="More">
              <Ellipsis size={16} strokeWidth={1.75} />
            </IconButton>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content align="end" sideOffset={6} className="z-50 min-w-56 rounded-tile border border-line bg-surface p-1 text-[13px] shadow-[0_8px_24px_rgb(0_0_0/0.10)]">
              {MENU_ITEMS.map(([label, m]) => (
                <Menu.Item key={label} disabled className="flex items-center justify-between gap-4 rounded-md px-2 py-1.5 data-[disabled]:text-muted">
                  {label} <span className="text-[12px]">{m}</span>
                </Menu.Item>
              ))}
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </div>
    </header>
  )
}
