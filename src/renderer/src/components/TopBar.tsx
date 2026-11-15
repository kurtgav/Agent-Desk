import * as Menu from '@radix-ui/react-dropdown-menu'
import { Bell, ChevronLeft, ChevronRight } from 'lucide-react'
import type { PauseChoice } from '@shared/bridge'
import { useUi, type Nav } from '@/store'
import { projectName } from '@/lib/selectors'
import { findEntry } from '@/lib/sessionList'
import { IntegrationDialog } from './Integration'
import { PAGE_TITLE } from './pages/Page'
import { openSettings } from './settings/actions'
import { useEntries } from './shell/useEntries'
import { DemoChip, LiveChip, clock } from './StatusChips'
import { ThemeButton } from './ThemeButton'
import { Hint, IconButton, menuItem, menuPanel, menuSeparator } from './ui'

function PauseMenu() {
  const status = useUi((s) => s.status)
  const now = useUi((s) => s.now)
  if (!status) return null // demo: nothing to pause
  const paused = status.pausedUntil !== null && now < status.pausedUntil
  const pause = (c: PauseChoice | null): void => void window.agentdeck?.pauseNotifications(c).catch(() => undefined)
  return (
    <Menu.Sub>
      <Menu.SubTrigger className={menuItem}>
        <span className="flex flex-col">
          <span>{paused ? 'Notifications paused' : 'Pause notifications'}</span>
          {paused && <span className="text-[12px] text-muted">Until {clock(status.pausedUntil!)}</span>}
        </span>
        <ChevronRight size={14} strokeWidth={1.75} className="ml-auto text-muted" />
      </Menu.SubTrigger>
      <Menu.Portal>
        <Menu.SubContent sideOffset={6} className={menuPanel}>
          {paused && (
            <Menu.Item className={menuItem} onSelect={() => pause(null)}>
              Resume now
            </Menu.Item>
          )}
          <Menu.Item className={menuItem} onSelect={() => pause('hour')}>
            For 1 hour
          </Menu.Item>
          <Menu.Item className={menuItem} onSelect={() => pause('tomorrow')}>
            Until tomorrow, 08:00
          </Menu.Item>
        </Menu.SubContent>
      </Menu.Portal>
    </Menu.Sub>
  )
}

/** The trail the page sits on: Sessions › its project for a filtered list, a session's project, otherwise just the page. */
export function trailFor(nav: Nav, project: string): string[] {
  if (nav.page === 'session') return [PAGE_TITLE.sessions, project || PAGE_TITLE.session]
  if (nav.page === 'sessions' && nav.project) return [PAGE_TITLE.sessions, projectName(nav.project)]
  return [PAGE_TITLE[nav.page]]
}

/** Back and forward through where you have been (Alt+Left, Alt+Right). */
function History() {
  const canBack = useUi((s) => s.canBack)
  const canForward = useUi((s) => s.canForward)
  const back = useUi((s) => s.back)
  const forward = useUi((s) => s.forward)
  return (
    <div className="app-no-drag flex flex-none items-center">
      <Hint label="Back (Alt Left)">
        <IconButton aria-label="Back" aria-keyshortcuts="Alt+ArrowLeft" disabled={!canBack} onClick={back} className="size-7">
          <ChevronLeft size={16} strokeWidth={1.75} />
        </IconButton>
      </Hint>
      <Hint label="Forward (Alt Right)">
        <IconButton aria-label="Forward" aria-keyshortcuts="Alt+ArrowRight" disabled={!canForward} onClick={forward} className="size-7">
          <ChevronRight size={16} strokeWidth={1.75} />
        </IconButton>
      </Hint>
    </div>
  )
}

function Breadcrumb() {
  const nav = useUi((s) => s.nav)
  const go = useUi((s) => s.go)
  const entry = findEntry(useEntries(), nav.session)
  const trail = trailFor(nav, nav.page === 'session' ? (entry?.project ?? '') : '')
  return (
    <nav aria-label="Breadcrumb" className="app-no-drag flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[14px] font-medium">
      {trail.map((t, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1.5">
          {i > 0 && <ChevronRight size={14} strokeWidth={1.75} className="flex-none text-muted" aria-hidden />}
          {i === trail.length - 1 ? (
            <span aria-current="page" className="max-w-[32ch] truncate">
              {t}
            </span>
          ) : (
            <button type="button" onClick={() => go({ page: nav.page === 'session' ? 'sessions' : nav.page })} className="rounded-md px-1 text-muted transition-colors hover:text-ink">
              {t}
            </button>
          )}
        </span>
      ))}
    </nav>
  )
}

/**
 * Slim on purpose (IA § 7): where you are, then the things that are about the whole app: the theme, whether sessions are reporting,
 * and the notifications menu. New session and Search live in the sidebar, once.
 */
export function TopBar() {
  const live = useUi((s) => s.status !== null)
  const dialog = useUi((s) => s.integration)
  const setDialog = useUi((s) => s.setIntegration)
  return (
    <header className="app-drag caption-inset flex h-12 flex-none items-center gap-2 border-b border-line bg-surface pl-3">
      <History />
      <Breadcrumb />
      <div className="flex-1" />
      <div className="app-no-drag flex flex-none items-center gap-2">
        <DemoChip />
        <LiveChip onRepair={() => setDialog('install')} />
        <ThemeButton />
        <Menu.Root>
          <Hint label="Notifications and integration">
            <Menu.Trigger asChild>
              <IconButton aria-label="Notifications and integration">
                <Bell size={16} strokeWidth={1.75} />
              </IconButton>
            </Menu.Trigger>
          </Hint>
          <Menu.Portal>
            <Menu.Content align="end" sideOffset={6} className={menuPanel}>
              <PauseMenu />
              {live && (
                <Menu.Item className={menuItem} onSelect={() => setDialog('install')}>
                  Remote approvals…
                </Menu.Item>
              )}
              {live && (
                <Menu.Item className={menuItem} onSelect={() => setDialog('uninstall')}>
                  Uninstall integration…
                </Menu.Item>
              )}
              {live && <Menu.Separator className={menuSeparator} />}
              <Menu.Item className={menuItem} onSelect={() => openSettings('diagnostics')}>
                Diagnostics
              </Menu.Item>
              <Menu.Item className={menuItem} onSelect={() => openSettings()}>
                Settings
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </div>
      <IntegrationDialog mode={dialog} onClose={() => setDialog(null)} />
    </header>
  )
}
