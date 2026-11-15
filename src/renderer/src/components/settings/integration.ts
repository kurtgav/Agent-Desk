import type { AppStatus, RemoteApprovals } from '@shared/bridge'

export interface HooksSummary {
  ok: boolean
  /** The word on the pill. */
  label: string
  /** One sentence for the row: what it means, or what to do. */
  detail: string
}

/** What the Integration section says about Claude Code's hooks, in the words of the Live chip in the top bar (D-068: a conflict is Hooks missing too). */
export function hooksSummary(s: AppStatus): HooksSummary {
  if (s.hooks === 'error') return { ok: false, label: 'Hooks missing', detail: s.hooksError ?? "AgentDeck can't read your Claude Code settings.json." }
  if (s.conflicts.length > 0) return { ok: false, label: 'Hooks missing', detail: s.conflicts[0]! }
  if (s.hooks === 'missing') return { ok: false, label: 'Hooks missing', detail: 'Sessions do not report to AgentDeck yet. Manage hooks to install them.' }
  return { ok: true, label: 'Live', detail: 'Your sessions report to AgentDeck as they work.' }
}

export function remoteSummary(ra: RemoteApprovals): string {
  return ra.enabled
    ? `On. A permission request waits here up to ${ra.waitSec} s before the terminal asks.`
    : 'Off. The terminal asks as usual; turn it on in Manage hooks to answer here instead.'
}
