// ADR-0013 desktop signals from the attention items: toasts, taskbar overlay badge, tray dot, flashFrame.
import { join } from 'node:path'
import { Notification, nativeImage, type BrowserWindow, type Tray } from 'electron'
import type { HooksState } from '@shared/bridge'
import type { AttentionItem, Snapshot } from '@shared/snapshot'
import { badgeCount, badgeIcon, isPaused, newItems, shouldToast, toastText, trayIcon, trayTooltip, type NotifyPrefs } from './notify'

export interface SignalDeps {
  resources: string
  title: () => string
  window: () => BrowserWindow | undefined
  tray: () => Tray | undefined
  prefs: () => NotifyPrefs
  /** null in demo mode or before the first check: no red dot for something we haven't looked at. */
  hooks: () => HooksState | null
  /** A toast was clicked. */
  open: (itemId: string) => void
}

const alive = (w: BrowserWindow | undefined): w is BrowserWindow => !!w && !w.isDestroyed()

export class Signals {
  private seen: Set<string> | null = null
  private items: readonly AttentionItem[] = []
  /** Kept referenced so a click from the Action Center still reaches us; closed when the item resolves. */
  private readonly toasts = new Map<string, Notification>()
  private shown = ''

  constructor(private readonly d: SignalDeps) {}

  /** A fresh snapshot; null (collector restarting) keeps what is shown until it is back. */
  update(s: Snapshot | null): void {
    if (s) {
      const fresh = newItems(this.seen, s.attention)
      this.items = s.attention
      this.seen = new Set(s.attention.map((i) => i.id))
      for (const [id, n] of this.toasts) {
        if (this.seen.has(id)) continue
        n.close() // answered: its toast is stale
        this.toasts.delete(id)
      }
      for (const item of fresh) this.announce(item, s)
    }
    this.render()
  }

  /** Demo mode: no live signals. */
  clear(): void {
    this.seen = null
    this.items = []
    for (const n of this.toasts.values()) n.close()
    this.toasts.clear()
    this.render()
  }

  private announce(item: AttentionItem, s: Snapshot): void {
    const w = this.d.window()
    const focused = alive(w) && w.isFocused()
    if (item.priority === 1 && alive(w) && !focused) w.flashFrame(true)
    const viewing = focused && w.isVisible() && !w.isMinimized()
    if (!Notification.isSupported() || !shouldToast(item, this.d.prefs(), new Date(), viewing)) return
    const n = new Notification({ ...toastText(item, s.sessions.find((x) => x.id === item.sessionId)), icon: join(this.d.resources, 'icon.png') })
    n.on('click', () => this.d.open(item.id))
    this.toasts.set(item.id, n)
    n.show()
  }

  /** Badge and tray dot from the current items; also called when pause or hooks state change. */
  render(): void {
    const count = badgeCount(this.items)
    const tray = trayIcon(this.d.hooks(), isPaused(this.d.prefs(), Date.now()), count)
    const badge = badgeIcon(count)
    const w = this.d.window()
    const key = `${tray}|${badge}|${count}|${this.d.title()}|${alive(w) ? w.id : ''}`
    if (key === this.shown) return
    this.shown = key
    const image = (name: string): Electron.NativeImage => nativeImage.createFromPath(join(this.d.resources, `${name}.png`))
    if (alive(w)) w.setOverlayIcon(badge ? image(badge) : null, badge ? `${count} need${count === 1 ? 's' : ''} you` : '')
    const t = this.d.tray()
    if (t) {
      t.setImage(image(tray))
      t.setToolTip(trayTooltip(tray, count, this.d.title()))
    }
  }
}
