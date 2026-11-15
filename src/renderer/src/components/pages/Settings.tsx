import { useEffect, useState } from 'react'
import { useUi } from '@/store'
import { AppearanceSection } from '../settings/AppearanceSection'
import { ClaudeSection } from '../settings/ClaudeSection'
import { DiagnosticsSection } from '../settings/DiagnosticsSection'
import { IntegrationSection } from '../settings/IntegrationSection'
import { NotificationsSection } from '../settings/NotificationsSection'
import { ProfileSection } from '../settings/ProfileSection'
import { ReportSection } from '../settings/ReportSection'
import type { SectionId } from '../settings/Section'
import { StartupSection } from '../settings/StartupSection'
import { useSettings } from '../settings/useSettings'
import { Button, cn } from '../ui'
import { PageFrame } from './Page'
import { ListCard, StateNote } from './kit'

const SECTIONS: [SectionId, string][] = [
  ['profile', 'Profile'],
  ['appearance', 'Appearance'],
  ['report', 'Daily report'],
  ['notifications', 'Notifications'],
  ['startup', 'Startup'],
  ['integration', 'Integration'],
  ['claude', 'Claude Code'],
  ['diagnostics', 'Diagnostics']
]

const section = (id: SectionId): HTMLElement | null => document.getElementById(`settings-${id}`)

/** Jump to a section. Smooth only when the person has not asked for less motion. */
function jumpTo(id: SectionId, smooth: boolean): void {
  const el = section(id)
  if (!el) return
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ block: 'start', behavior: smooth && !reduce ? 'smooth' : 'auto' })
  el.focus({ preventScroll: true })
}

/** The section nearest the top of the window: the band between 15% and 25% of its height decides, so a short section still gets its turn. */
function useActiveSection(watching: boolean): [SectionId, (id: SectionId) => void] {
  const [active, setActive] = useState<SectionId>('profile')
  useEffect(() => {
    if (!watching || typeof IntersectionObserver === 'undefined') return
    const watch = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id.replace('settings-', '') as SectionId)
      },
      { rootMargin: '-15% 0px -75% 0px' }
    )
    for (const [id] of SECTIONS) {
      const el = section(id)
      if (el) watch.observe(el)
    }
    return () => watch.disconnect()
  }, [watching])
  return [active, setActive]
}

function SectionList({ active, onPick }: { active: SectionId; onPick(id: SectionId): void }) {
  return (
    <nav aria-label="Settings sections" className="sticky top-6 self-start">
      <ul className="flex flex-col gap-0.5">
        {SECTIONS.map(([id, label]) => (
          <li key={id}>
            <button
              type="button"
              aria-current={id === active ? 'location' : undefined}
              onClick={() => onPick(id)}
              className={cn(
                'flex h-8 w-full items-center rounded-lg px-3 text-left text-[13px] font-medium text-muted outline-none transition-[background-color,color] duration-150 hover:bg-active/60 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent',
                id === active && 'bg-active text-ink hover:bg-active'
              )}
            >
              {label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** Settings and Diagnostics (UI_MAP § Settings): one page of sections, a list to jump between them on the left. */
export function SettingsPage() {
  const state = useSettings()
  // The whole Nav, not only its query: choosing Diagnostics again while here is a new Nav, and App scrolls to the top for it.
  const nav = useUi((s) => s.nav)
  const ready = state.kind === 'ready'
  const [active, setActive] = useActiveSection(ready)

  // App scrolls a new Nav to its top after this effect has run, so the jump waits one frame.
  useEffect(() => {
    const target = nav.query === 'diagnostics' || nav.query === 'claude' ? nav.query : null
    if (!ready || !target) return
    const frame = requestAnimationFrame(() => jumpTo(target, false))
    return () => cancelAnimationFrame(frame)
  }, [ready, nav])

  return (
    <PageFrame page="settings" lede="Your profile, the daily report, notifications and diagnostics. Everything is saved on this PC; nothing leaves it.">
      {state.kind === 'loading' && (
        <ListCard label="Settings">
          <StateNote tone="loading">Reading your settings…</StateNote>
        </ListCard>
      )}
      {state.kind === 'unavailable' && (
        <ListCard label="Settings">
          <StateNote title="Settings open from the AgentDeck window">They are saved on this PC, so a plain browser has nothing to show.</StateNote>
        </ListCard>
      )}
      {state.kind === 'failed' && (
        <ListCard label="Settings">
          <div role="alert">
            <StateNote tone="error" title="AgentDeck could not read its settings">
              {state.message}
            </StateNote>
          </div>
          <div className="flex justify-center pb-8">
            <Button onClick={state.retry}>Try again</Button>
          </div>
        </ListCard>
      )}
      {state.kind === 'ready' && (
        <div className="grid grid-cols-[168px_minmax(0,1fr)] items-start gap-8">
          <SectionList
            active={active}
            onPick={(id) => {
              setActive(id)
              jumpTo(id, true)
            }}
          />
          <div className="flex min-w-0 max-w-[800px] flex-col gap-4">
            <ProfileSection api={state.api} />
            <AppearanceSection api={state.api} />
            <ReportSection api={state.api} />
            <NotificationsSection api={state.api} />
            <StartupSection api={state.api} />
            <IntegrationSection />
            <ClaudeSection api={state.api} />
            <DiagnosticsSection />
          </div>
          <p role="status" aria-live="polite" className="sr-only">
            {state.api.savedSection ? 'Saved' : ''}
          </p>
        </div>
      )}
    </PageFrame>
  )
}
