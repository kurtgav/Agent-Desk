// ADR-0013 desktop signals: which items toast, the badge count and the tray dot. No electron import: unit-testable.
import type { HooksState } from '@shared/bridge'
import type { AttentionItem, AttentionKind, Session } from '@shared/snapshot'
import type { AppConfig } from './config'

export interface NotifyPrefs {
  pausedUntil: number | null
  /** P4 "ready for review" toasts. */
  completions: boolean
  /** Per-type toggles. */
  kinds: Record<AttentionKind, boolean>
  /** Minutes after local midnight; `from` > `to` spans midnight. */
  quietHours: { from: number; to: number } | null
}

const KINDS: AttentionKind[] = ['approval', 'question', 'failed', 'stuck', 'review']
const minutes = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1440 ? v : null)

/**
 * `config.notifications`, hand-edited until Settings arrives (M5), so every field is checked and falls back to its
 * default: everything on, no quiet hours.
 */
export function notifyPrefs(config: AppConfig): NotifyPrefs {
  const n = (typeof config.notifications === 'object' && config.notifications !== null ? config.notifications : {}) as Record<string, unknown>
  const kinds = (typeof n.kinds === 'object' && n.kinds !== null ? n.kinds : {}) as Record<string, unknown>
  const q = (typeof n.quietHours === 'object' && n.quietHours !== null ? n.quietHours : {}) as Record<string, unknown>
  const from = minutes(q.from)
  const to = minutes(q.to)
  return {
    pausedUntil: typeof n.pausedUntil === 'number' && Number.isFinite(n.pausedUntil) ? n.pausedUntil : null,
    completions: n.completions !== false,
    kinds: Object.fromEntries(KINDS.map((k) => [k, kinds[k] !== false])) as Record<AttentionKind, boolean>,
    quietHours: from !== null && to !== null && from !== to ? { from, to } : null
  }
}

export function inQuietHours(q: NotifyPrefs['quietHours'], at: Date): boolean {
  if (!q) return false
  const m = at.getHours() * 60 + at.getMinutes()
  return q.from < q.to ? m >= q.from && m < q.to : m >= q.from || m < q.to
}

export const isPaused = (p: NotifyPrefs, now: number): boolean => p.pausedUntil !== null && now < p.pausedUntil

/** ADR-0013: P1 and P2 toast; P4 only with completions on; P3 never. `viewing`: the focused window already shows it. */
export function shouldToast(item: AttentionItem, p: NotifyPrefs, at: Date, viewing: boolean): boolean {
  if (viewing || isPaused(p, at.getTime()) || inQuietHours(p.quietHours, at) || !p.kinds[item.kind]) return false
  return item.priority <= 2 || (item.priority === 4 && p.completions)
}

/** Items in `items` that `seen` has not had; `seen` null is the first snapshot, which only seeds (no toast storm at launch). */
export function newItems(seen: ReadonlySet<string> | null, items: readonly AttentionItem[]): AttentionItem[] {
  return seen === null ? [] : items.filter((i) => !seen.has(i.id))
}

/** The taskbar badge counts open P1 + P2 (ADR-0013). */
export const badgeCount = (items: readonly AttentionItem[]): number => items.filter((i) => i.priority <= 2).length

/** resources/badge-N.png, capped at 9+; null clears the overlay. */
export const badgeIcon = (n: number): string | null => (n <= 0 ? null : n > 9 ? 'badge-9plus' : `badge-${n}`)

export type TrayIcon = 'tray' | 'tray-attention' | 'tray-paused' | 'tray-failed'

/** ARCHITECTURE § 7: red = hooks missing, gray = paused, amber = needs you, plain = live. The first that applies wins. */
export function trayIcon(hooks: HooksState | null, paused: boolean, needsYou: number): TrayIcon {
  if (hooks !== null && hooks !== 'installed') return 'tray-failed'
  if (paused) return 'tray-paused'
  return needsYou > 0 ? 'tray-attention' : 'tray'
}

export function trayTooltip(icon: TrayIcon, needsYou: number, base: string): string {
  if (icon === 'tray-failed') return `${base}: hooks not installed`
  if (icon === 'tray-paused') return `${base}: notifications paused`
  return needsYou > 0 ? `${base}: ${needsYou} need${needsYou === 1 ? 's' : ''} you` : base
}

const HEADINGS: Record<AttentionKind, string> = {
  approval: 'Needs approval',
  question: 'Needs your answer',
  failed: 'Failed',
  stuck: 'Possibly stuck',
  review: 'Ready for review'
}

/** Toast text: what happened and where, then the exact command or question without Markdown backticks. */
export function toastText(item: AttentionItem, session: Session | undefined): { title: string; body: string } {
  return {
    title: session ? `${HEADINGS[item.kind]} · ${session.name}` : HEADINGS[item.kind],
    body: item.title.replace(/`/g, '')
  }
}

/** "Pause until tomorrow": 08:00 local on the next calendar day. */
export function tomorrowMorning(now: number): number {
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  d.setHours(8, 0, 0, 0)
  return d.getTime()
}
