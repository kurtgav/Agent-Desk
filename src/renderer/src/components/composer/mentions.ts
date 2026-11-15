/**
 * Mentions as text. A chosen agent is written into the message as `@role-id` (the id of the Roles catalog: `@cto`,
 * `@frontend-developer`), so the text itself is the truth: chips are what that text parses to, a draft restores from a string,
 * and copy and paste, undo and the screen reader's reading all work on plain characters. Only an id the catalog knows is a mention;
 * `@everyone` or an email address is just text.
 */

export interface MentionSpan {
  /** Lower case, as in the catalog. */
  id: string
  /** `[start, end)` in the text, `@` included. */
  start: number
  end: number
}

/** `@id` at the start or after a space or an opening bracket or quote; the id ends where an id character stops. */
const MENTION = /(^|[\s([{"'`])@([a-z0-9][a-z0-9-]{0,79})(?![a-z0-9_-])/gi

export function parseMentions(text: string, has: (id: string) => boolean): MentionSpan[] {
  const out: MentionSpan[] = []
  for (const m of text.matchAll(MENTION)) {
    const id = m[2]!.toLowerCase()
    if (!has(id)) continue
    const start = m.index + m[1]!.length
    out.push({ id, start, end: start + 1 + m[2]!.length })
  }
  return out
}

/** Each distinct agent once, in the order they were written: the first leads. */
export function mentionIds(spans: readonly MentionSpan[]): string[] {
  return [...new Set(spans.map((s) => s.id))]
}

export interface Segment {
  text: string
  /** The agent this piece of text is a mention of, or null for plain text. */
  id: string | null
  /** The first mention of the message. */
  lead: boolean
}

/** The text cut at its mentions, for drawing them as chips behind the box. */
export function segmentsOf(text: string, spans: readonly MentionSpan[]): Segment[] {
  const out: Segment[] = []
  let at = 0
  spans.forEach((s, i) => {
    if (s.start > at) out.push({ text: text.slice(at, s.start), id: null, lead: false })
    out.push({ text: text.slice(s.start, s.end), id: s.id, lead: i === 0 })
    at = s.end
  })
  if (at < text.length) out.push({ text: text.slice(at), id: null, lead: false })
  return out
}

/** The message as it reads to Claude and to a person: every `@id` written as `@Name`. */
export function displayText(text: string, spans: readonly MentionSpan[], nameOf: (id: string) => string): string {
  let out = ''
  let at = 0
  for (const s of spans) {
    out += text.slice(at, s.start) + `@${nameOf(s.id)}`
    at = s.end
  }
  return out + text.slice(at)
}

/** What is left to say once the mentions are taken out. A message with nothing else is not a message. */
export function hasMessage(text: string, spans: readonly MentionSpan[]): boolean {
  return removeRanges(text, spans.map((s): [number, number] => [s.start, s.end])).text.trim() !== ''
}

/** Text without the given `[from, to)` ranges (overlaps merge), and where an old offset lands in the new text. */
export function removeRanges(text: string, ranges: readonly [number, number][]): { text: string; map(offset: number): number } {
  const merged: [number, number][] = []
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
    const last = merged.at(-1)
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else merged.push([a, b])
  }
  let out = ''
  let at = 0
  for (const [a, b] of merged) {
    out += text.slice(at, a)
    at = b
  }
  out += text.slice(at)
  const map = (offset: number): number => {
    let removed = 0
    for (const [a, b] of merged) {
      if (offset >= b) removed += b - a
      else if (offset > a) return a - removed
    }
    return offset - removed
  }
  return { text: out, map }
}

/** A token and one space beside it, so taking `@cto` out of `@cto fix it` leaves `fix it`, not ` fix it`. */
function withSpace(text: string, s: MentionSpan): [number, number] {
  if (text[s.end] === ' ') return [s.start, s.end + 1]
  if (s.start > 0 && text[s.start - 1] === ' ') return [s.start - 1, s.end]
  return [s.start, s.end]
}

/** The text with the chosen mentions taken out. */
export function dropMentions(text: string, spans: readonly MentionSpan[], which: (s: MentionSpan, i: number) => boolean): string {
  return removeRanges(text, spans.filter(which).map((s) => withSpace(text, s))).text
}

export interface Edit {
  text: string
  /** Where the caret goes. */
  caret: number
}

/** `@id ` in place of the word being completed (`[start, end)`); the space is not doubled when one is already there. */
export function insertMention(text: string, at: { start: number; end: number }, id: string): Edit {
  const head = text.slice(0, at.start)
  const tail = text.slice(at.end)
  const before = head && !/\s$/.test(head) ? ' ' : ''
  const token = `${before}@${id}`
  const gap = /^\s/.test(tail) ? '' : ' '
  const skip = gap ? 1 : /^[^\S\n]/.test(tail) ? 1 : 0
  return { text: `${head}${token}${gap}${tail}`, caret: head.length + token.length + skip }
}

/** Makes `id` the first mention: any other mention of it goes, and it is written at the start. */
export function makeLead(text: string, spans: readonly MentionSpan[], id: string): Edit {
  const rest = dropMentions(text, spans, (s) => s.id === id)
  const next = `@${id} ${rest}`
  return { text: next, caret: next.length }
}

/** Writes `id` over the mention at `index`, and takes out any other mention of the same agent. */
export function swapMention(text: string, spans: readonly MentionSpan[], index: number, id: string): Edit {
  const target = spans[index]
  if (!target) return insertMention(text, { start: text.length, end: text.length }, id)
  const others = spans.filter((s, i) => i !== index && s.id === id).map((s) => withSpace(text, s))
  const { text: rest, map } = removeRanges(text, others)
  const start = map(target.start)
  const next = `${rest.slice(0, start)}@${id}${rest.slice(start + (target.end - target.start))}`
  return { text: next, caret: start + 1 + id.length }
}

/** Adds `id` right after the last mention, or at the start when there is none. Already there: nothing changes. */
export function addMention(text: string, spans: readonly MentionSpan[], id: string): Edit {
  if (spans.some((s) => s.id === id)) return { text, caret: text.length }
  const last = spans.at(-1)
  if (last) return insertMention(text, { start: last.end, end: last.end }, id)
  const next = `@${id} ${text.replace(/^\s+/, '')}`
  return { text: next, caret: next.length }
}

/**
 * The range Backspace or Delete removes when the caret touches a mention: all of it, as one unit (and the space after it, so no
 * stray space is left at the start). `null` when the caret is not on one, or when text is selected: a selection deletes what it covers.
 */
export function unitDelete(text: string, spans: readonly MentionSpan[], selStart: number, selEnd: number, dir: 'back' | 'forward'): [number, number] | null {
  if (selStart !== selEnd) return null
  const s = spans.find((m) => (dir === 'back' ? selStart > m.start && selStart <= m.end : selStart >= m.start && selStart < m.end))
  if (!s) return null
  const atStart = s.start === 0 || /\s/.test(text[s.start - 1] ?? '')
  return [s.start, text[s.end] === ' ' && atStart ? s.end + 1 : s.end]
}

/** The smallest edit that turns `a` into `b`: what to cut and what to write in its place. */
export function diffEdit(a: string, b: string): { from: number; to: number; insert: string } {
  let from = 0
  const max = Math.min(a.length, b.length)
  while (from < max && a[from] === b[from]) from++
  let tail = 0
  while (tail < max - from && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  return { from, to: a.length - tail, insert: b.slice(from, b.length - tail) }
}

/** A task has one agent: everything mentioned except `id` goes, and the caret lands after `id`'s mention. */
export function keepOnly(text: string, spans: readonly MentionSpan[], id: string): Edit {
  const next = dropMentions(text, spans, (s) => s.id !== id)
  return { text: next, caret: Math.min(next.length, (parseMentionsOf(next, id)?.end ?? next.length) + 1) }
}

function parseMentionsOf(text: string, id: string): MentionSpan | undefined {
  return parseMentions(text, (x) => x === id).find((s) => s.id === id)
}
