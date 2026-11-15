/**
 * Suggested agents while you type, with no model: the text is held for a moment, ranked once, and the answer is dropped if the text
 * moved on meanwhile. Pushing never blocks and never clears what is on screen at once: the last suggestions stay until the new ones
 * (or "none") arrive, so the row does not flash on every key.
 */

export interface SuggesterOptions<T> {
  delayMs: number
  /** Whether the text is long enough to suggest from; when it is not, the suggestions go away after the delay. */
  eligible(text: string): boolean
  run(text: string): Promise<T>
  /** `null`: nothing to suggest any more. */
  onResult(value: T | null): void
}

export interface Suggester {
  push(text: string): void
  /** Forget what is waiting and ignore what is in flight (the box went away). */
  cancel(): void
}

export function createSuggester<T>(o: SuggesterOptions<T>): Suggester {
  let timer: ReturnType<typeof setTimeout> | null = null
  let turn = 0
  const stop = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    turn++
  }
  return {
    push(text) {
      stop()
      const mine = turn
      timer = setTimeout(() => {
        timer = null
        if (!o.eligible(text)) return o.onResult(null)
        o.run(text).then(
          (value) => {
            if (turn === mine) o.onResult(value)
          },
          () => {
            if (turn === mine) o.onResult(null)
          }
        )
      }, o.delayMs)
    },
    cancel: stop
  }
}

/** Words that are not mentions: enough to say what the work is (three words, or a sentence's worth of letters). */
export function longEnough(text: string): boolean {
  const t = text.trim()
  return !t.startsWith('/') && (t.split(/\s+/).length >= 3 || t.length >= 24)
}
