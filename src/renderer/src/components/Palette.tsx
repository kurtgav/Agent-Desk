import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Activity, Files, FileText, FolderClosed, House, LayoutList, Play, Search, ShieldCheck, Users, type LucideIcon } from 'lucide-react'
import { useUi, type Nav, type Page } from '@/store'
import { openChangedFile } from '@/lib/act'
import { projectName, recentProjects, recentSessions } from '@/lib/selectors'
import { latestPerPath } from './RecentFiles'
import { PAGE_TITLE } from './pages/Page'
import { focusComposer } from './Sidebar'
import { cn } from './ui'

export interface Command {
  id: string
  group: 'Go to' | 'Actions' | 'Sessions' | 'Projects' | 'Files'
  label: string
  meta?: string
  icon: LucideIcon
  run(): void
}

const PAGE_ICON: Record<Page, LucideIcon> = { home: House, sessions: LayoutList, approvals: ShieldCheck, files: Files, activity: Activity, agents: Users }
/** Per group once something is typed; with nothing typed, pages, actions and the five newest sessions. */
const PER_GROUP = 8

/** Everything the palette can do right now (UI_MAP § Top bar: sessions, projects, files, actions). */
export function commands(): Command[] {
  const ui = useUi.getState()
  const { snapshot, status } = ui
  const go = (nav: Nav) => () => ui.go(nav)
  const paused = status?.pausedUntil != null && Date.now() < status.pausedUntil
  const pages = (Object.keys(PAGE_TITLE) as Page[]).map((p): Command => ({ id: `page:${p}`, group: 'Go to', label: PAGE_TITLE[p], icon: PAGE_ICON[p], run: go({ page: p }) }))
  const actions: Command[] = [
    { id: 'new-task', group: 'Actions', label: 'New task', icon: Play, run: focusComposer },
    ...(status
      ? [
          paused
            ? { id: 'resume', group: 'Actions' as const, label: 'Resume notifications', icon: Play, run: () => void window.agentdeck?.pauseNotifications(null).catch(() => undefined) }
            : { id: 'pause', group: 'Actions' as const, label: 'Pause notifications for 1 hour', icon: Play, run: () => void window.agentdeck?.pauseNotifications('hour').catch(() => undefined) },
          { id: 'remote', group: 'Actions' as const, label: 'Remote approvals…', icon: ShieldCheck, run: () => ui.setIntegration('install') }
        ]
      : [])
  ]
  const sessions = recentSessions(snapshot, snapshot.sessions.length).map((s): Command => ({
    id: `session:${s.id}`, group: 'Sessions', label: s.name, meta: projectName(s.cwd), icon: LayoutList, run: () => ui.openDrawer(s.id)
  }))
  const projects = recentProjects(snapshot, snapshot.sessions.length).map((p): Command => ({
    id: `project:${p.cwd}`, group: 'Projects', label: p.name, meta: p.cwd, icon: FolderClosed, run: go({ page: 'sessions', project: p.cwd })
  }))
  const files = latestPerPath(snapshot.files, Infinity).map((f): Command => ({
    id: `file:${f.path}`, group: 'Files', label: projectName(f.path), meta: f.path, icon: FileText, run: () => void openChangedFile(f.path)
  }))
  return [...pages, ...actions, ...sessions, ...projects, ...files]
}

export function search(all: Command[], q: string): Command[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return all.filter((c) => c.group === 'Go to' || c.group === 'Actions').concat(all.filter((c) => c.group === 'Sessions').slice(0, 5))
  const counts = new Map<string, number>()
  return all.filter((c) => {
    if (!c.label.toLowerCase().includes(needle) && !(c.meta ?? '').toLowerCase().includes(needle)) return false
    const n = counts.get(c.group) ?? 0
    counts.set(c.group, n + 1)
    return n < PER_GROUP
  })
}

/** Results in their group order, each with its position in the flat list the arrows walk. */
function groups(shown: Command[]): [string, [Command, number][]][] {
  const out: [string, [Command, number][]][] = []
  shown.forEach((c, i) => {
    const last = out.at(-1)
    if (last?.[0] === c.group) last[1].push([c, i])
    else out.push([c.group, [[c, i]]])
  })
  return out
}

/** UI_MAP § Top bar › Search: Radix Dialog, a search box and one list; arrows move, Enter runs, Esc closes. */
export function Palette() {
  const open = useUi((s) => s.palette)
  const setOpen = useUi((s) => s.setPalette)
  // No Dialog.Trigger (Ctrl+K, two buttons), so Radix can't put focus back: remember the opener, as the drawer does.
  const opener = useRef<HTMLElement | null>(null)
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/20" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            const o = opener.current
            // After the command's own focus move (New task → the composer, a frame later): restore only if none happened.
            requestAnimationFrame(() => {
              if (o?.isConnected && (document.activeElement === null || document.activeElement === document.body)) o.focus()
            })
          }}
          className="fixed left-1/2 top-[12vh] z-[70] flex max-h-[70vh] w-[560px] -translate-x-1/2 flex-col overflow-hidden rounded-card border border-line bg-surface shadow-[0_16px_48px_rgb(0_0_0/0.16)]"
        >
          <Dialog.Title className="sr-only">Search AgentDeck</Dialog.Title>
          {/* Its own component, so the query and highlight reset whenever the palette closes, however it closes. */}
          <Results close={() => setOpen(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Results({ close }: { close(): void }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  // Read when it opens and as you type; the palette is short-lived, so it needn't follow every snapshot.
  const shown = search(commands(), q)
  const index = Math.min(active, Math.max(0, shown.length - 1))

  useEffect(() => {
    list.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const run = (c: Command | undefined): void => {
    if (!c) return
    close()
    c.run()
  }
  const keys = (e: KeyboardEvent): void => {
    if (e.nativeEvent.isComposing) return // Enter that commits an IME candidate
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (shown.length ? (Math.min(i, shown.length - 1) + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(shown[index])
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b border-line px-4">
        <Search size={16} strokeWidth={1.75} className="flex-none text-muted" aria-hidden />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setActive(0)
          }}
          onKeyDown={keys}
          role="combobox"
          aria-expanded={shown.length > 0}
          aria-controls={shown.length ? 'palette-list' : undefined}
          aria-activedescendant={shown[index] ? `palette-${index}` : undefined}
          aria-label="Search sessions, projects, files and actions"
          placeholder="Search sessions, projects, files and actions"
          className="h-12 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted"
        />
      </div>
      {shown.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-muted">Nothing matches.</p>
      ) : (
        <div ref={list} id="palette-list" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {groups(shown).map(([group, items]) => (
            <div key={group} role="group" aria-label={group}>
              <div aria-hidden className="px-2.5 pb-1 pt-2 text-[12px] font-medium text-muted">
                {group}
              </div>
              {items.map(([c, i]) => (
                <div
                  key={c.id}
                  id={`palette-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === index}
                  onMouseMove={() => i !== index && setActive(i)}
                  onClick={() => run(c)}
                  className={cn('flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 text-[13px]', i === index && 'bg-ground')}
                >
                  <c.icon size={15} strokeWidth={1.75} className="flex-none text-muted" aria-hidden />
                  <span className="truncate">{c.label}</span>
                  {c.meta && <span className="min-w-0 flex-1 truncate text-right text-[12px] text-muted">{c.meta}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

const CHORD_MS = 1_000
const CHORD: Record<string, Page> = { h: 'home', s: 'sessions', a: 'approvals' }

/** Ctrl+K opens the palette anywhere; `g h` / `g s` / `g a` go to Home, Sessions or Approvals when no field or dialog has focus. */
export function useShortcuts(): void {
  useEffect(() => {
    let g = 0
    const onKey = (e: globalThis.KeyboardEvent): void => {
      const ui = useUi.getState()
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        ui.setPalette(!ui.palette)
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]')) return
      const key = e.key.toLowerCase()
      if (g && Date.now() - g < CHORD_MS && CHORD[key]) {
        e.preventDefault()
        g = 0
        ui.go({ page: CHORD[key] })
        return
      }
      g = key === 'g' ? Date.now() : 0
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
