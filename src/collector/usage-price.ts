// API-equivalent cost of the token counts in Claude Code's local logs (ADR-0009 amendment). No electron import: unit-testable.
//
// Prices: US dollars per million tokens, from https://platform.claude.com/docs/en/about-claude/pricing, read 2026-11-13.
// Cross-check: Claude Code's own `claude_code.cost.usage` for 2 input / 181 output / 34,834 cache-read / 4,763 cache-write
// tokens on claude-haiku-5-5 was $0.00139164, which this table gives only with the cache writes at the 1h rate.
// A subscription is a flat fee, so this is "what the API would charge", never a bill.
//
// A model that is not in the table, or a request billed another way (fast mode, US-only inference: both change the price),
// gets NO cost: its tokens still count and the UI says "cost partly unknown". A price is never guessed.
// To update: change PRICES and PRICE_TABLE_DATE together and add the new model to usage-price.test.ts.

export const PRICE_TABLE_DATE = '2026-11-13'

export interface Price {
  input: number
  write5m: number
  write1h: number
  read: number
  output: number
}

const p = (input: number, write5m: number, write1h: number, read: number, output: number): Price => ({ input, write5m, write1h, read, output })

/** Claude Haiku 5.5 is priced by the size of the prompt (docs: "for prompts up to / over 100,000 tokens"). */
const HAIKU_55_SPLIT = 100_000
const HAIKU_55_LOW = p(0.1, 0.125, 0.2, 0.01, 0.5)
const HAIKU_55_HIGH = p(0.5, 0.625, 1, 0.05, 2.5)

/** Keyed `<family>-<major>[-<minor>]`: `claude-opus-5-5-20260101` and `claude-opus-5-5` are both `opus-5-5`. */
const PRICES: Readonly<Record<string, Price>> = {
  'fable-5-2': p(8, 10, 16, 0.2, 40),
  'mythos-5-2': p(8, 10, 16, 0.2, 40),
  'fable-5-1': p(10, 12.5, 20, 0.25, 50),
  'mythos-5-1': p(10, 12.5, 20, 0.25, 50),
  'fable-5': p(10, 12.5, 20, 1, 50),
  'mythos-5': p(10, 12.5, 20, 1, 50),
  'opus-5-5': p(4, 5, 8, 0.2, 20),
  'opus-5': p(5, 6.25, 10, 0.5, 25),
  'opus-4-8': p(5, 6.25, 10, 0.5, 25),
  'opus-4-7': p(5, 6.25, 10, 0.5, 25),
  'opus-4-6': p(5, 6.25, 10, 0.5, 25),
  'opus-4-5': p(5, 6.25, 10, 0.5, 25),
  'opus-4-1': p(15, 18.75, 30, 1.5, 75),
  'opus-4': p(15, 18.75, 30, 1.5, 75),
  'sonnet-5-5': p(2, 2.5, 4, 0.1, 10),
  'sonnet-5': p(2, 2.5, 4, 0.2, 10),
  'sonnet-4-6': p(3, 3.75, 6, 0.3, 15),
  'sonnet-4-5': p(3, 3.75, 6, 0.3, 15),
  'sonnet-4': p(3, 3.75, 6, 0.3, 15),
  'haiku-4-5': p(1, 1.25, 2, 0.1, 5)
}

// claude-<family>-<major>[-<minor, 1-2 digits>][-<date, 8 digits>]; a date is never read as a minor version.
const MODEL = /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/

/** `claude-sonnet-5-5-20260101` → `sonnet-5-5`; null for a name that is not a current-style Claude model id. */
export function modelKey(model: string): string | null {
  const m = MODEL.exec(model)
  return m ? `${m[1]}-${m[2]}${m[3] ? `-${m[3]}` : ''}` : null
}

export interface Tokens {
  input: number
  output: number
  cacheRead: number
  /** All cache-creation tokens. */
  cacheWrite: number
  /** The part of `cacheWrite` kept for 1 hour; the rest is priced as the 5-minute kind. */
  cacheWrite1h: number
}

/** The price row for this request, or null when the model is not in the table. */
export function priceFor(model: string, t: Tokens): Price | null {
  const key = modelKey(model)
  if (key === 'haiku-5-5') return t.input + t.cacheRead + t.cacheWrite <= HAIKU_55_SPLIT ? HAIKU_55_LOW : HAIKU_55_HIGH
  return key ? (PRICES[key] ?? null) : null
}

/** Dollars at API prices, or null when the price is not known (unknown model, or `odd`: billed other than at the standard rate). */
export function costOf(model: string, t: Tokens, odd = false): number | null {
  const price = odd ? null : priceFor(model, t)
  if (!price) return null
  const w1h = Math.min(t.cacheWrite1h, t.cacheWrite)
  const w5m = t.cacheWrite - w1h
  return (t.input * price.input + t.output * price.output + t.cacheRead * price.read + w5m * price.write5m + w1h * price.write1h) / 1_000_000
}
