import { useEffect, useRef, useState, type ReactNode } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, Search } from 'lucide-react'
import type { History } from '@shared/detail'
import { useUi, type Page } from '@/store'
import { demoHistory } from '@/demo/snapshot'
import { Button, cn, menuItem, menuPanel, segList, segTab } from '../ui'

export const PAGE_TITLE: Record<Page, string> = {
  new: 'New session',
  session: 'Session',
  overview: 'Overview',
  tasks: 'Tasks',
  sessions: 'All sessions',
  approvals: 'Approvals',
  files: 'Files',
  activity: 'Activity',
  report: 'Daily report',
  roles: 'Agents',
  settings: 'Settings'
}

/**
 * Every page has one anatomy: the title with one line of what it shows, one toolbar row (filters on the left, the page's own
 * action on the right), then the content. The canvas and the 16 px gap are the Overview's.
 */
export function PageFrame({ page, lede, filters, actions, children }: { page: Page; lede: string; filters?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-4 px-9 pb-8 pt-6">
      <header className="pb-1">
        <h1 className="t-display">{PAGE_TITLE[page]}</h1>
        <p className="mt-1 text-pretty text-[14px] text-muted">{lede}</p>
      </header>
      {(filters || actions) && (
        <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-2">
          {filters}
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  )
}

/** Segmented pill tabs, as a filter: one choice pressed at a time. */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange(v: T): void }) {
  return (
    <div role="group" aria-label={label} className={cn(segList, 'h-8')}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={v === value}
          onClick={() => onChange(v)}
          className={segTab}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

export function SearchBox({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  return (
    <div className="relative w-64 text-muted focus-within:text-ink">
      <Search size={14} strokeWidth={1.75} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        aria-label={label}
        className="h-8 w-full rounded-full bg-well pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent"
      />
    </div>
  )
}

/** A filter with more choices than fit a segmented row: the app's dropdown menu, one choice checked. */
export function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange(v: T): void }) {
  const current = options.find(([v]) => v === value)?.[1] ?? value
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button aria-label={`${label}: ${current}`}>
          <span className="text-muted">{label}</span>
          <span className="max-w-40 truncate">{current}</span>
          <ChevronDown size={14} strokeWidth={1.75} className="text-muted" />
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="start" sideOffset={6} className={cn(menuPanel, 'max-h-80 min-w-48 overflow-y-auto')}>
          <Menu.RadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
            {options.map(([v, text]) => (
              <Menu.RadioItem key={v} value={v} className={menuItem}>
                <span className="w-3.5 flex-none">
                  <Menu.ItemIndicator>
                    <Check size={14} className="text-ink" />
                  </Menu.ItemIndicator>
                </span>
                <span className="truncate">{text}</span>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}

const REFRESH_EVERY_MS = 1_000

/**
 * Activity and the audit log. Read when the page opens, then again after each snapshot but at most once a second,
 * so new events show up without a request per hook event. Null while loading; `failed` when the collector didn't
 * answer the first time (a later miss keeps the last rows).
 */
export function useHistory(): History | 'failed' | null {
  const snapshot = useUi((s) => s.snapshot)
  const demo = snapshot.mode === 'demo' || !window.agentdeck
  const at = snapshot.generatedAt
  const [got, setGot] = useState<History | 'failed' | null>(null)
  const last = useRef(0)
  const seq = useRef(0)
  // Unmounting drops a read still in flight; a newer snapshot doesn't (steady events would drop every one).
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (demo) return
    const t = setTimeout(
      () => {
        last.current = Date.now()
        const n = ++seq.current
        void window.agentdeck!
          .getHistory()
          .catch(() => null)
          .then((h) => {
            if (mounted.current && n === seq.current) setGot((prev) => h ?? (prev && prev !== 'failed' ? prev : 'failed'))
          })
      },
      Math.max(0, last.current + REFRESH_EVERY_MS - Date.now())
    )
    return () => clearTimeout(t)
  }, [demo, at])
  return demo ? demoHistory(snapshot) : got
}
