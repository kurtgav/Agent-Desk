import type { ReactNode } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { ChevronRight, Ellipsis, House, Plus, Search } from 'lucide-react'
import type { PauseChoice } from '@shared/bridge'
import { HOME, useUi } from '@/store'
import { projectName, running } from '@/lib/selectors'
import { Avatar } from './Avatar'
import { IntegrationDialog } from './Integration'
import { PAGE_TITLE } from './pages/Page'
import { focusComposer } from './Sidebar'
import { Button, Hint, IconButton, PendingMenuItem, cn, type Milestone } from './ui'

const MENU_ITEMS: [string, Milestone][] = [
  ['Diagnostics', 'M5'],
  ['Settings', 'M5']
]

const ITEM = 'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-ground'
const clock = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

type Tone = 'done' | 'idle' | 'failed'

function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <>
      <span className="size-1.5 rounded-full" style={{ background: `var(--${tone})` }} aria-hidden />
      {children}
    </>
  )
}
const CHIP = 'inline-flex h-[26px] items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium'
const tint = (tone: Tone) => ({ background: `var(--${tone}-bg)`, color: `var(--${tone}-ink)` })

/** UI_MAP Live chip: Live / Paused / Hooks missing (click to repair). Live mode only; NotLive covers a stopped collector. */
function LiveChip({ onRepair }: { onRepair: () => void }) {
  const status = useUi((s) => s.status)
  const link = useUi((s) => s.link)
  const now = useUi((s) => s.now)
  if (!status || link !== 'up') return null
  if (status.hooks !== 'installed' || status.conflicts.length > 0) {
    const why = status.hooks === 'error' ? status.hooksError : status.conflicts[0] ?? 'Sessions are not reporting to AgentDeck yet.'
    return (
      <Hint label={`${why} Click to repair.`}>
        <button type="button" onClick={onRepair} style={tint('failed')} className={cn(CHIP, 'transition-transform duration-150 ease-out active:scale-[0.96]')}>
          <Chip tone="failed">Hooks missing</Chip>
        </button>
      </Hint>
    )
  }
  if (status.pausedUntil !== null && now < status.pausedUntil) {
    return (
      <Hint label={`Notifications paused until ${clock(status.pausedUntil)}. Resume from the ⋯ menu.`}>
        <span tabIndex={0} style={tint('idle')} className={CHIP}>
          <Chip tone="idle">Paused</Chip>
        </span>
      </Hint>
    )
  }
  return (
    <Hint label="Hooks installed. Your sessions report to AgentDeck as they work.">
      <span tabIndex={0} style={tint('done')} className={CHIP}>
        <Chip tone="done">Live</Chip>
      </span>
    </Hint>
  )
}

function PauseMenu() {
  const status = useUi((s) => s.status)
  const now = useUi((s) => s.now)
  if (!status) return null // demo: nothing to pause
  const paused = status.pausedUntil !== null && now < status.pausedUntil
  const pause = (c: PauseChoice | null): void => void window.agentdeck?.pauseNotifications(c).catch(() => undefined)
  return (
    <Menu.Sub>
      <Menu.SubTrigger className={ITEM}>
        <span className="flex flex-col">
          <span>{paused ? 'Notifications paused' : 'Pause notifications'}</span>
          {paused && <span className="text-[12px] text-muted">Until {clock(status.pausedUntil!)}</span>}
        </span>
        <ChevronRight size={14} strokeWidth={1.75} className="ml-auto text-muted" />
      </Menu.SubTrigger>
      <Menu.Portal>
        <Menu.SubContent sideOffset={6} className="z-50 min-w-48 rounded-tile border border-line bg-surface p-1 text-[13px] shadow-[0_8px_24px_rgb(0_0_0/0.10)]">
          {paused && (
            <Menu.Item className={ITEM} onSelect={() => pause(null)}>
              Resume now
            </Menu.Item>
          )}
          <Menu.Item className={ITEM} onSelect={() => pause('hour')}>
            For 1 hour
          </Menu.Item>
          <Menu.Item className={ITEM} onSelect={() => pause('tomorrow')}>
            Until tomorrow, 08:00
          </Menu.Item>
        </Menu.SubContent>
      </Menu.Portal>
    </Menu.Sub>
  )
}

function ActiveAgents() {
  const active = running(useUi((s) => s.snapshot))
  const go = useUi((s) => s.go)
  const shown = active.slice(0, 3)
  const more = active.length - shown.length
  if (!active.length) return null
  return (
    <Hint label={`${active.length} active sessions. Show them in Sessions.`}>
      <button
        type="button"
        aria-label={`${active.length} active sessions`}
        onClick={() => go({ page: 'sessions', active: true })}
        className="flex items-center rounded-full p-0.5 transition-[background-color] duration-150 hover:bg-active"
      >
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

/** UI_MAP § Top bar: Home, then the list page, then the project a Sessions list is filtered to. */
function Breadcrumb() {
  const nav = useUi((s) => s.nav)
  const go = useUi((s) => s.go)
  const trail = [PAGE_TITLE[nav.page], ...(nav.page === 'sessions' && nav.project ? [projectName(nav.project)] : [])]
  return (
    <nav aria-label="Breadcrumb" className="app-no-drag flex min-w-0 items-center gap-1.5 text-[14px] font-medium">
      <House size={16} strokeWidth={1.75} className="flex-none text-muted" />
      {nav.page === 'home' ? (
        <span aria-current="page">Home</span>
      ) : (
        <>
          <button type="button" onClick={() => go(HOME)} className="rounded-md px-1 text-muted transition-colors duration-150 hover:text-ink">
            Home
          </button>
          {trail.map((t, i) => (
            <span key={i} className="flex min-w-0 items-center gap-1.5">
              <ChevronRight size={14} strokeWidth={1.75} className="flex-none text-muted" aria-hidden />
              {i === trail.length - 1 ? (
                <span aria-current="page" className="truncate">{t}</span>
              ) : (
                <button type="button" onClick={() => go({ page: nav.page })} className="truncate rounded-md px-1 text-muted transition-colors duration-150 hover:text-ink">
                  {t}
                </button>
              )}
            </span>
          ))}
        </>
      )}
    </nav>
  )
}

export function TopBar() {
  const mode = useUi((s) => s.snapshot.mode)
  const live = useUi((s) => s.status !== null)
  const dialog = useUi((s) => s.integration)
  const setDialog = useUi((s) => s.setIntegration)
  const openPalette = useUi((s) => s.setPalette)
  return (
    <header className="app-drag caption-inset flex h-12 flex-none items-center gap-3 border-b border-line bg-surface pl-4">
      <Breadcrumb />

      <div className="flex flex-1 justify-center">
        <button
          type="button"
          aria-keyshortcuts="Control+K"
          onClick={() => openPalette(true)}
          className="app-no-drag flex h-8 w-[300px] items-center gap-2 rounded-full bg-well px-3 text-[13px] text-muted transition-[background-color,color] duration-150 hover:bg-active hover:text-ink"
        >
          <Search size={14} strokeWidth={1.75} />
          Search sessions, projects, files
          <kbd className="ml-auto font-sans text-[12px]">Ctrl K</kbd>
        </button>
      </div>

      <div className="app-no-drag flex items-center gap-2">
        {mode === 'demo' && (
          <Hint label="Sample sessions, not yours. Turn off under Third Code › Demo data.">
            {/* Focusable so keyboard users can reach the explanation in the tooltip. */}
            <span tabIndex={0} className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-[var(--needs-bg)] px-2.5 text-[12px] font-medium text-[var(--needs-ink)]">
              <span className="size-1.5 rounded-full bg-[var(--needs)]" aria-hidden />
              Demo data
            </span>
          </Hint>
        )}
        <LiveChip onRepair={() => setDialog('install')} />
        <ActiveAgents />
        <Button onClick={focusComposer}>
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
              <PauseMenu />
              {live && (
                <Menu.Item className={ITEM} onSelect={() => setDialog('install')}>
                  Remote approvals…
                </Menu.Item>
              )}
              {live && (
                <Menu.Item className={ITEM} onSelect={() => setDialog('uninstall')}>
                  Uninstall integration…
                </Menu.Item>
              )}
              {live && <Menu.Separator className="my-1 h-px bg-rule" />}
              {MENU_ITEMS.map(([label, m]) => (
                <PendingMenuItem key={label} label={label} m={m} />
              ))}
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </div>
      <IntegrationDialog mode={dialog} onClose={() => setDialog(null)} />
    </header>
  )
}
