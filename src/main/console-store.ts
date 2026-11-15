import { HISTORY_MAX_BYTES, HISTORY_MAX_EVENTS, type ConsoleEvent } from '@shared/console'

const size = (e: ConsoleEvent): number =>
  120 + ('text' in e ? e.text.length : 0) + ('input' in e ? e.input.length : 0) + ('summary' in e ? e.summary.length : 0) + (e.kind === 'capabilities' ? CAPS_BYTES : 0)

/** What a capabilities event weighs for the cap (its lists are capped, so about this much). */
const CAPS_BYTES = 60_000

/** A message under construction is one entry that grows, and capabilities and the allow list are one entry each that is replaced: the page opened later sees the latest, not every step. */
const textKey = (e: ConsoleEvent): string | null =>
  e.kind === 'assistant-text' || e.kind === 'thinking' ? `${e.kind}:${e.messageId}` : e.kind === 'capabilities' || e.kind === 'allowed' ? e.kind : null

/**
 * What one conversation said, in memory only (never written anywhere), for a page opened after it began.
 * Capped by count and by size: the oldest events go first, and the page is told some were trimmed.
 */
export class History {
  private events: ConsoleEvent[] = []
  private bytes = 0
  private index = new Map<string, number>()
  private trimmed = false

  constructor(
    private readonly maxEvents = HISTORY_MAX_EVENTS,
    private readonly maxBytes = HISTORY_MAX_BYTES
  ) {}

  push(e: ConsoleEvent): void {
    const key = textKey(e)
    const at = key === null ? undefined : this.index.get(key)
    if (at !== undefined) {
      this.bytes += size(e) - size(this.events[at]!)
      this.events[at] = e
    } else {
      if (key !== null) this.index.set(key, this.events.length)
      this.events.push(e)
      this.bytes += size(e)
    }
    this.trim()
  }

  private trim(): void {
    let drop = 0
    let bytes = this.bytes
    while (this.events.length - drop > 1 && (this.events.length - drop > this.maxEvents || bytes > this.maxBytes)) {
      bytes -= size(this.events[drop]!)
      drop++
    }
    if (drop === 0) return
    this.events.splice(0, drop)
    this.bytes = bytes
    this.trimmed = true
    this.index = new Map()
    this.events.forEach((e, i) => {
      const key = textKey(e)
      if (key !== null) this.index.set(key, i)
    })
  }

  list(): ConsoleEvent[] {
    const first = this.events[0]
    if (!this.trimmed || !first) return [...this.events]
    const marker: ConsoleEvent = {
      id: `${first.conversation}:0`,
      conversation: first.conversation,
      seq: 0,
      ts: first.ts,
      kind: 'notice',
      level: 'info',
      text: 'Earlier messages were trimmed to keep AgentDeck light.'
    }
    return [marker, ...this.events]
  }
}
