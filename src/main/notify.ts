// ADR-0013 desktop signals: which items toast, the badge count and the tray dot. No electron import (types only): unit-testable.
import type { NativeImage, NotificationConstructorOptions } from 'electron'
import type { ActionResult, HooksState } from '@shared/bridge'
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
 * `config.notifications`, written by Settings and still hand-editable, so every field is checked and falls back to its
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

/** macOS: the same count as the Dock badge's text, capped like the overlay; '' clears it. */
export const dockBadge = (n: number): string => (n <= 0 ? '' : n > 9 ? '9+' : String(n))

export type TrayIcon = 'tray' | 'tray-attention' | 'tray-paused' | 'tray-failed'

/**
 * The file under resources/ for a tray state. macOS: the plain state is a template image (black and alpha, `*Template.png`)
 * that the menu bar tints for light and dark; the coloured states keep their colour, because the colour is the message.
 */
export const trayImage = (icon: TrayIcon, platform: NodeJS.Platform = process.platform): string =>
  platform === 'darwin' && icon === 'tray' ? 'trayTemplate' : icon

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
const TOAST_MAX = 120

/**
 * One short plain line. Windows keeps toast text in its notification database, and control or bidi characters
 * from a command could reorder or hide part of it (M3 security review).
 */
function plain(s: string): string {
  const t = s.replace(/[\p{Cc}\p{Cf}`]/gu, ' ').replace(/\s+/g, ' ').trim()
  return t.length > TOAST_MAX ? `${t.slice(0, TOAST_MAX - 1)}…` : t
}

export interface ToastText {
  title: string
  body: string
}

export function toastText(item: AttentionItem, session: Session | undefined): ToastText {
  return {
    title: plain(session ? `${HEADINGS[item.kind]} · ${session.name}` : HEADINGS[item.kind]),
    body: plain(item.title)
  }
}

/**
 * The one shape of every toast AgentDeck shows: the bot image, plain capped text, the user's Windows sound setting, and
 * no action buttons (an approval needs a click in the window, ADR-0006). Windows' default toast layout needs no `toastXml`.
 */
export function toastOptions(text: ToastText, icon: NativeImage): NotificationConstructorOptions {
  return { title: plain(text.title), body: plain(text.body), icon, silent: false }
}

/** "Send a test notification": always shown, whatever pause and quiet hours say (the user asked for it). */
export const TEST_TOAST: ToastText = {
  title: 'AgentDeck can reach you here',
  body: 'This is what a notification looks like. Click it to open AgentDeck.'
}
export const TEST_TOAST_WAIT_MS = 2000

/** What the OS did with the test toast. */
export type TestToastEvent = { kind: 'show' } | { kind: 'failed'; error: string } | { kind: 'timeout' } | { kind: 'unsupported' }

/** Where each OS keeps the switch, and what can hide a toast that was shown. */
const OS_WORDS = {
  win32: { os: 'Windows', where: 'Windows Settings > System > Notifications', quiet: 'Focus assist or Do not disturb' },
  darwin: { os: 'macOS', where: 'System Settings > Notifications', quiet: 'A Focus mode' }
}

export function testToastResult(e: TestToastEvent, platform: NodeJS.Platform = process.platform): ActionResult {
  const { os, where, quiet } = platform === 'darwin' ? OS_WORDS.darwin : OS_WORDS.win32
  switch (e.kind) {
    case 'show':
      return { ok: true }
    case 'unsupported':
      return { ok: false, error: `${os} says AgentDeck cannot show notifications on this computer. Check ${where}.` }
    case 'failed': {
      const why = plain(e.error)
      return { ok: false, error: `${os} would not show the notification${why ? ` (${why})` : ''}. Check ${where}.` }
    }
    case 'timeout':
      return { ok: false, error: `${os} did not show it. ${quiet} may be hiding it, or notifications for AgentDeck may be off in ${where}.` }
  }
}

/** The part of Electron's Notification the wait needs: events, and `show`. */
export type Showable = Pick<NodeJS.EventEmitter, 'once'> & { show(): void }

/** Shows the toast and resolves with its first sign of life: 'show', 'failed', or nothing within `ms`. */
export function showAndWait(n: Showable, ms: number): Promise<TestToastEvent> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ kind: 'timeout' }), ms)
    const done = (e: TestToastEvent): void => {
      clearTimeout(timer)
      resolve(e)
    }
    n.once('show', () => done({ kind: 'show' }))
    n.once('failed', (_event: unknown, error: unknown) => done({ kind: 'failed', error: typeof error === 'string' ? error : '' }))
    try {
      n.show()
    } catch (err) {
      done({ kind: 'failed', error: err instanceof Error ? err.message : '' })
    }
  })
}

/** "Pause until tomorrow": 08:00 local on the next calendar day. */
export function tomorrowMorning(now: number): number {
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  d.setHours(8, 0, 0, 0)
  return d.getTime()
}
