import { useUi } from '@/store'
import { Hint, Pill } from './ui'

export const clock = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** UI_MAP Live chip: Live / Paused / Hooks missing (click to repair). Live mode only; NotLive covers a stopped collector. */
export function LiveChip({ onRepair }: { onRepair: () => void }) {
  const status = useUi((s) => s.status)
  const link = useUi((s) => s.link)
  const now = useUi((s) => s.now)
  if (!status || link !== 'up') return null
  if (status.hooks !== 'installed' || status.conflicts.length > 0) {
    const why = status.hooks === 'error' ? status.hooksError : status.conflicts[0] ?? 'Sessions are not reporting to AgentDeck yet.'
    return (
      <Hint label={`${why} Click to repair.`}>
        <button type="button" onClick={onRepair} className="press rounded-full">
          <Pill tone="failed" size="md">Hooks missing</Pill>
        </button>
      </Hint>
    )
  }
  if (status.pausedUntil !== null && now < status.pausedUntil) {
    return (
      <Hint label={`Notifications paused until ${clock(status.pausedUntil)}. Resume from the ⋯ menu.`}>
        <Pill tone="idle" size="md" tabIndex={0}>Paused</Pill>
      </Hint>
    )
  }
  return (
    <Hint label="Hooks installed. Your sessions report to AgentDeck as they work.">
      <Pill tone="done" size="md" tabIndex={0}>Live</Pill>
    </Hint>
  )
}

/** Demo data is never mixed with live, and says so: focusable, so keyboard users can reach the explanation. */
export function DemoChip() {
  const demo = useUi((s) => s.snapshot.mode === 'demo')
  if (!demo) return null
  return (
    <Hint label="Sample sessions, not yours. Turn off under Third Code › Demo data.">
      <Pill tone="needs" size="md" tabIndex={0}>Demo data</Pill>
    </Hint>
  )
}
