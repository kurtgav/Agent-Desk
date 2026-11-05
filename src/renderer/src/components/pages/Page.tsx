import { useEffect, useRef, useState, type ReactNode } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown } from 'lucide-react'
import type { History } from '@shared/detail'
import { useUi, type Page } from '@/store'
import { demoHistory } from '@/demo/snapshot'
import { Button, cn } from '../ui'

export const PAGE_TITLE: Record<Page, string> = {
  home: 'Home',
  sessions: 'Sessions',
  approvals: 'Approvals',
  files: 'Files',
  activity: 'Activity',
  agents: 'Agents'
}

/** A list page: Home's canvas, a page title in the greeting's type role, one line of what it shows, then its cards. */
export function PageFrame({ page, lede, children }: { page: Page; lede: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-4 px-9 pb-6 pt-6">
      <header>
        <h1 className="text-balance text-[28px] font-semibold leading-9 tracking-[-0.02em]">{PAGE_TITLE[page]}</h1>
        <p className="mt-1 text-pretty text-[14px] text-muted">{lede}</p>
      </header>
      {children}
    </div>
  )
}

/** The drawer's segmented tabs (SessionDrawer `tab`), as a filter: one choice pressed at a time. */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange(v: T): void }) {
  return (
    <div role="group" aria-label={label} className="flex w-fit gap-0.5 rounded-full bg-well p-0.5">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={v === value}
          onClick={() => onChange(v)}
          className={cn(
            'h-7 rounded-full px-3 text-[13px] font-medium text-muted outline-none transition-[background-color,color] duration-150 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent',
            v === value && 'bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)]'
          )}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

export function SearchBox({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={label}
      aria-label={label}
      className="h-8 w-64 rounded-full bg-well px-3 text-[13px] outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent"
    />
  )
}

/** A filter with more choices than fit a segmented row: the app's dropdown menu, one choice checked. */
export function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange(v: T): void }) {
  const current = options.find(([v]) => v === value)?.[1] ?? value
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button size="sm" aria-label={`${label}: ${current}`}>
          <span className="text-muted">{label}</span>
          <span className="max-w-40 truncate">{current}</span>
          <ChevronDown size={14} strokeWidth={1.75} className="text-muted" />
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="start" sideOffset={6} className="z-50 max-h-80 min-w-48 overflow-y-auto rounded-tile border border-line bg-surface p-1 text-[13px] shadow-[0_8px_24px_rgb(0_0_0/0.10)]">
          <Menu.RadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
            {options.map(([v, text]) => (
              <Menu.RadioItem key={v} value={v} className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-ground">
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

export function Empty({ children }: { children: ReactNode }) {
  return <p className="border-t border-rule px-4 py-6 text-[13px] text-muted">{children}</p>
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
