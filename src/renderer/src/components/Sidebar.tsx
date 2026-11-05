import type { ComponentType, ReactNode } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { Activity, Check, ChevronDown, Files, FolderClosed, Gauge, House, LayoutList, PanelLeft, Plus, Search, Settings, ShieldCheck } from 'lucide-react'
import { HOME, useUi, type Page } from '@/store'
import { needsOkCount, recentProjects } from '@/lib/selectors'
import { tokens, usd } from '@/lib/format'
import { Avatar, Mark } from './Avatar'
import { PAGE_TITLE } from './pages/Page'
import { Button, Hint, IconButton, PENDING_LABEL, PendingMenuItem, cn, pending } from './ui'

type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

export const USER_NAME = 'Kurt' // D-014; editable in Settings (M5)

/** The composer lives on Home; from another page, go there first. */
export function focusComposer(): void {
  useUi.getState().go(HOME)
  requestAnimationFrame(() => document.getElementById('composer-input')?.focus())
}

const TOGGLE_ID = 'sidebar-toggle'

/** Collapse and Expand are different buttons in different places; keep focus on whichever now exists. */
function toggleAndKeepFocus(toggle: () => void): void {
  toggle()
  requestAnimationFrame(() => document.getElementById(TOGGLE_ID)?.focus())
}

function NavItem({ icon: I, label, current, badge, collapsed, onClick }: { icon: Icon; label: string; current?: boolean; badge?: number; collapsed: boolean; onClick(): void }) {
  const button = (
    <button
      type="button"
      aria-current={current ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      onClick={onClick}
      className={cn(
        'flex h-[30px] w-full items-center gap-2.5 rounded-lg px-2 text-[14px] transition-colors duration-150',
        current ? 'bg-active font-medium' : 'hover:bg-active/60',
        collapsed && 'justify-center px-0'
      )}
    >
      <I size={16} strokeWidth={1.75} className={current ? 'text-ink' : 'text-muted'} />
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && badge ? (
        <span className="ml-auto text-[12px] font-medium tabular-nums text-muted">
          {badge}
          <span className="sr-only"> open</span>
        </span>
      ) : null}
    </button>
  )
  return <li>{collapsed ? <Hint side="right" label={label}>{button}</Hint> : button}</li>
}

function Group({ title, collapsed, children }: { title: string; collapsed: boolean; children: ReactNode }) {
  if (collapsed) return null
  return (
    <div className="mt-6">
      <h2 className="px-2 pb-1 text-[12px] font-medium text-muted">{title}</h2>
      <ul>{children}</ul>
    </div>
  )
}

function Switcher({ collapsed }: { collapsed: boolean }) {
  const version = useUi((s) => s.version)
  const demo = useUi((s) => s.snapshot.mode === 'demo')
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button type="button" aria-label="Third Code workspace menu" className="app-no-drag flex h-8 items-center gap-2 rounded-lg px-1.5 hover:bg-active">
          <Mark size={20} />
          {!collapsed && (
            <>
              <span className="text-[14px] font-semibold">Third Code</span>
              <ChevronDown size={14} className="text-muted" />
            </>
          )}
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="start" sideOffset={6} className="z-50 min-w-56 rounded-tile border border-line bg-surface p-1 text-[13px] shadow-[0_8px_24px_rgb(0_0_0/0.10)]">
          <Menu.Label className="px-2 py-1.5 text-[12px] text-muted">AgentDeck {version}</Menu.Label>
          {/* ADR-0011: main switches the data source and reloads the window into the new mode. */}
          <Menu.CheckboxItem
            checked={demo}
            onCheckedChange={(on) => void window.agentdeck?.setDemo(on)}
            className="flex cursor-default items-start gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-ground"
          >
            <span className="mt-0.5 w-3.5 flex-none">
              <Menu.ItemIndicator>
                <Check size={14} className="text-ink" />
              </Menu.ItemIndicator>
            </span>
            <span className="flex flex-col">
              <span>Demo data</span>
              <span className="text-[12px] text-muted">{demo ? 'Showing sample sessions' : 'Off: showing your sessions'}</span>
            </span>
          </Menu.CheckboxItem>
          <Menu.Separator className="my-1 h-px bg-rule" />
          <PendingMenuItem label="Diagnostics" m="M5" icon={<span className="w-3.5 flex-none" />} />
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}

function UsageCard() {
  const usage = useUi((s) => s.snapshot.usage)
  if (!usage) {
    return (
      <div className="rounded-tile border border-line bg-surface p-3">
        <p className="text-[13px] font-semibold">Usage</p>
        <p className="mt-1 text-[12px] text-muted">Token and cost figures need Claude Code telemetry.</p>
        <Hint label={PENDING_LABEL.M5}>
          <Button size="sm" className="mt-2" {...pending('M5')}>
            Enable usage
          </Button>
        </Hint>
      </div>
    )
  }
  const share = Math.min(1, usage.weekCostUsd / usage.weeklyBudgetUsd)
  return (
    <div role="group" className="rounded-tile border border-line bg-surface p-3" aria-label="Usage, estimated">
      <div className="flex items-center gap-2">
        <Gauge size={14} strokeWidth={1.75} className="text-muted" />
        <span className="text-[13px] font-semibold">Usage</span>
        <span className="ml-auto rounded-md bg-well px-1.5 text-[12px] text-muted">estimated</span>
      </div>
      <p className="mt-2 tabular-nums">
        <span className="text-[20px] font-semibold leading-6">{usd(usage.weekCostUsd)}</span>
        <span className="text-[12px] text-muted"> of {usd(usage.weeklyBudgetUsd)} this week</span>
      </p>
      <div
        role="meter"
        aria-label="Weekly budget used"
        aria-valuemin={0}
        aria-valuemax={usage.weeklyBudgetUsd}
        aria-valuenow={Math.min(usage.weekCostUsd, usage.weeklyBudgetUsd)}
        aria-valuetext={`${usd(usage.weekCostUsd)} of ${usd(usage.weeklyBudgetUsd)}`}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-track"
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${share * 100}%` }} />
      </div>
      <p className="mt-2 text-[12px] tabular-nums text-muted">
        Today {usd(usage.todayCostUsd)} · {tokens(usage.todayTokens)} tokens
      </p>
    </div>
  )
}

export function Sidebar() {
  const collapsed = useUi((s) => s.sidebarCollapsed)
  const toggle = useUi((s) => s.toggleSidebar)
  const snapshot = useUi((s) => s.snapshot)
  const version = useUi((s) => s.version)
  const nav = useUi((s) => s.nav)
  const go = useUi((s) => s.go)
  const openPalette = useUi((s) => s.setPalette)
  const projects = recentProjects(snapshot, 5)
  const page = (p: Page, icon: Icon, badge?: number) => (
    <NavItem icon={icon} label={PAGE_TITLE[p]} badge={badge} current={nav.page === p && !nav.project} collapsed={collapsed} onClick={() => go({ page: p })} />
  )

  return (
    <aside id="sidebar" aria-label="Sidebar" className={cn('flex h-full flex-none flex-col bg-ground', collapsed ? 'w-16' : 'w-[216px]')}>
      <div className={cn('app-drag flex h-12 flex-none items-center gap-1 px-2.5', collapsed && 'justify-center')}>
        <Switcher collapsed={collapsed} />
        {!collapsed && (
          <Hint label="Collapse sidebar">
            <IconButton
              id={TOGGLE_ID}
              aria-label="Collapse sidebar"
              aria-expanded
              aria-controls="sidebar"
              className="app-no-drag ml-auto"
              onClick={() => toggleAndKeepFocus(toggle)}
            >
              <PanelLeft size={16} strokeWidth={1.75} />
            </IconButton>
          </Hint>
        )}
      </div>

      <div className={cn('flex flex-none gap-2 px-2.5 pt-2', collapsed && 'flex-col items-center')}>
        {collapsed ? (
          <Hint side="right" label="Expand sidebar">
            <IconButton id={TOGGLE_ID} aria-label="Expand sidebar" aria-expanded={false} aria-controls="sidebar" onClick={() => toggleAndKeepFocus(toggle)}>
              <PanelLeft size={16} strokeWidth={1.75} />
            </IconButton>
          </Hint>
        ) : null}
        {collapsed ? (
          <Hint side="right" label="New task">
            <IconButton aria-label="New task" className="border border-control bg-surface" onClick={focusComposer}>
              <Plus size={16} strokeWidth={1.75} />
            </IconButton>
          </Hint>
        ) : (
          <Button className="flex-1 justify-start" onClick={focusComposer}>
            <Plus size={16} strokeWidth={1.75} />
            New task
          </Button>
        )}
        <Hint side={collapsed ? 'right' : 'bottom'} label="Search (Ctrl K)">
          <IconButton aria-label="Search" aria-keyshortcuts="Control+K" className="border border-control bg-surface" onClick={() => openPalette(true)}>
            <Search size={15} strokeWidth={1.75} />
          </IconButton>
        </Hint>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        <nav aria-label="Main" className="mt-3">
          <ul className="flex flex-col gap-0.5">
            {page('home', House)}
            {page('sessions', LayoutList)}
            {page('approvals', ShieldCheck, needsOkCount(snapshot))}
            {page('files', Files)}
            {page('activity', Activity)}
          </ul>
        </nav>
        <Group title="Recent" collapsed={collapsed}>
          {projects.map((p) => (
            <NavItem
              key={p.cwd}
              icon={FolderClosed}
              label={p.name}
              current={nav.page === 'sessions' && nav.project === p.cwd}
              collapsed={collapsed}
              onClick={() => go({ page: 'sessions', project: p.cwd })}
            />
          ))}
        </Group>
        <Group title="Agents" collapsed={collapsed}>
          {snapshot.recentAgentTypes.map((a) => (
            <li key={a}>
              <button
                type="button"
                aria-current={nav.page === 'agents' && nav.query === a ? 'page' : undefined}
                onClick={() => go({ page: 'agents', query: a })}
                className="flex h-[30px] w-full items-center gap-2.5 rounded-lg px-2 text-[14px] transition-colors duration-150 hover:bg-active/60 aria-[current=page]:bg-active aria-[current=page]:font-medium"
              >
                <Avatar seed={a} size={16} />
                <span className="truncate">{a}</span>
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              aria-current={nav.page === 'agents' && !nav.query ? 'page' : undefined}
              onClick={() => go({ page: 'agents' })}
              className="flex h-[30px] w-full items-center rounded-lg px-2 text-[14px] text-muted transition-colors duration-150 hover:bg-active/60 aria-[current=page]:bg-active aria-[current=page]:font-medium aria-[current=page]:text-ink"
            >
              All agents
              <span className="ml-auto text-[12px] tabular-nums">{snapshot.agentDefinitionCount}</span>
            </button>
          </li>
        </Group>
      </div>

      {!collapsed && (
        <div className="flex-none px-2.5 pb-3">
          <UsageCard />
          <div className="mt-3 flex items-center gap-2.5 px-1">
            <span aria-hidden className="grid size-8 place-items-center rounded-full bg-[var(--working-bg)] text-[13px] font-semibold text-[var(--working-ink)]">
              {USER_NAME[0]}
            </span>
            <div className="min-w-0 leading-4">
              <p className="text-[14px] font-medium">{USER_NAME}</p>
              <p className="truncate text-[12px] text-muted">AgentDeck {version}</p>
            </div>
            <Hint label={`Settings: ${PENDING_LABEL.M5}`}>
              <IconButton aria-label="Settings" className="ml-auto" {...pending('M5')}>
                <Settings size={16} strokeWidth={1.75} />
              </IconButton>
            </Hint>
          </div>
        </div>
      )}
    </aside>
  )
}
