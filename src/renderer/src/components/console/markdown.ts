/**
 * A small, safe markdown reader for what Claude writes: paragraphs, headings, lists, quotes, tables, fenced code, and inline
 * code, bold, italic, strikethrough and links. It produces plain data; Markdown.tsx turns that into React elements, so there is
 * no HTML anywhere (a tag in the text stays text), and a link is never an anchor (ADR-0010: nothing opens without a click
 * AgentDeck controls, and v1 has no way to open a link). Text that is still being written parses too: an open fence is code so far.
 */

export type Inline =
  | { t: 'text'; s: string }
  | { t: 'code'; s: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'del'; c: Inline[] }
  /** `url` is set only for http, https and mailto; any other scheme (javascript:, data:, file:) is dropped and only the text remains. */
  | { t: 'link'; c: Inline[]; url: string | null }

export type Align = 'left' | 'center' | 'right' | null

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: 3 | 4 | 5; c: Inline[] }
  | { t: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { t: 'code'; lang: string; text: string }
  | { t: 'quote'; c: Block[] }
  | { t: 'hr' }
  | { t: 'table'; head: Inline[][]; align: Align[]; rows: Inline[][][] }

const SAFE_URL = /^(?:https?:\/\/|mailto:)[^\s<>"'`]+$/i
const NESTING_MAX = 6

export const safeUrl = (raw: string): string | null => {
  const url = raw.trim()
  return SAFE_URL.test(url) ? url : null
}

const isPunct = (c: string | undefined): boolean => c !== undefined && /[!-/:-@[-`{-~]/.test(c)
const isSpace = (c: string | undefined): boolean => c === undefined || /\s/.test(c)
const isWord = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c)

/** Inline spans. Unclosed markers stay as the characters they were. */
export function parseInline(src: string, depth = 0): Inline[] {
  const out: Inline[] = []
  let text = ''
  const flush = (): void => {
    if (text) out.push({ t: 'text', s: text })
    text = ''
  }
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    if (c === '\\' && isPunct(src[i + 1])) {
      text += src[i + 1]
      i += 2
      continue
    }
    if (c === '`') {
      let run = 1
      while (src[i + run] === '`') run++
      const close = src.indexOf('`'.repeat(run), i + run)
      if (close > 0 && src[close + run] !== '`') {
        flush()
        const body = src.slice(i + run, close).replace(/\n/g, ' ')
        out.push({ t: 'code', s: body.length > 2 && body.startsWith(' ') && body.endsWith(' ') ? body.slice(1, -1) : body })
        i = close + run
        continue
      }
      text += '`'.repeat(run)
      i += run
      continue
    }
    if (c === '[' && depth < NESTING_MAX) {
      const link = readLink(src, i)
      if (link) {
        flush()
        out.push({ t: 'link', c: parseInline(link.text, depth + 1), url: safeUrl(link.href) })
        i = link.end
        continue
      }
    }
    if ((c === '*' || c === '_' || c === '~') && depth < NESTING_MAX) {
      const span = readEmphasis(src, i)
      if (span) {
        flush()
        out.push({ t: span.kind, c: parseInline(span.inner, depth + 1) })
        i = span.end
        continue
      }
    }
    text += c
    i++
  }
  flush()
  return out
}

/** `[text](href)` at `i`, with one level of nested brackets and parentheses in the target. */
function readLink(src: string, i: number): { text: string; href: string; end: number } | null {
  let depth = 0
  let j = i
  for (; j < src.length; j++) {
    const c = src[j]
    if (c === '\\') j++
    else if (c === '[') depth++
    else if (c === ']' && --depth === 0) break
  }
  if (j >= src.length || src[j + 1] !== '(') return null
  let paren = 0
  let k = j + 1
  for (; k < src.length; k++) {
    const c = src[k]
    if (c === '(') paren++
    else if (c === ')' && --paren === 0) break
    else if (c === '\n') return null
  }
  if (k >= src.length) return null
  const href = src.slice(j + 2, k).trim().split(/\s+/)[0] ?? ''
  return { text: src.slice(i + 1, j), href, end: k + 1 }
}

/** `**strong**`, `*em*`, `_em_`, `__strong__`, `~~del~~` at `i` (the closing marker must follow text, not a space). */
function readEmphasis(src: string, i: number): { kind: 'strong' | 'em' | 'del'; inner: string; end: number } | null {
  const c = src[i]!
  const double = src[i + 1] === c
  if (c === '~' && !double) return null
  const mark = double ? c + c : c
  const after = src[i + mark.length]
  if (isSpace(after) || after === c) return null
  // _ stays inside words (snake_case): it opens only at a word edge.
  if (c === '_' && isWord(src[i - 1])) return null
  let j = i + mark.length
  while (j < src.length) {
    const at = src.indexOf(mark, j)
    if (at < 0) return null
    const before = src[at - 1]
    const next = src[at + mark.length]
    const closes = !isSpace(before) && (c !== '_' || !isWord(next)) && (double || next !== c)
    if (closes && at > i + mark.length) {
      return { kind: c === '~' ? 'del' : double ? 'strong' : 'em', inner: src.slice(i + mark.length, at), end: at + mark.length }
    }
    j = at + mark.length
  }
  return null
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/
const ITEM = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/
const QUOTE = /^ {0,3}>\s?(.*)$/
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/

const cells = (line: string): string[] => {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
}

const startsBlock = (line: string): boolean => FENCE.test(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line) || ITEM.test(line)

export function parseMarkdown(src: string, depth = 0): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) {
      i++
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      const mark = fence[1]!
      const body: string[] = []
      i++
      while (i < lines.length && !new RegExp(`^ {0,3}${mark[0]}{${mark.length},}\\s*$`).test(lines[i]!)) body.push(lines[i++]!)
      i++ // the closing fence, if there was one: text still being written ends inside the code
      blocks.push({ t: 'code', lang: (fence[2] ?? '').slice(0, 24), text: body.join('\n') })
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      const n = heading[1]!.length
      blocks.push({ t: 'h', level: n <= 2 ? 3 : n === 3 ? 4 : 5, c: parseInline(heading[2]!) })
      i++
      continue
    }
    if (HR.test(line)) {
      blocks.push({ t: 'hr' })
      i++
      continue
    }
    if (QUOTE.test(line) && depth < NESTING_MAX) {
      const inner: string[] = []
      while (i < lines.length && QUOTE.test(lines[i]!)) inner.push(QUOTE.exec(lines[i++]!)![1]!)
      blocks.push({ t: 'quote', c: parseMarkdown(inner.join('\n'), depth + 1) })
      continue
    }
    if (ITEM.test(line) && depth < NESTING_MAX) {
      i = readList(lines, i, blocks, depth)
      continue
    }
    if (line.includes('|') && TABLE_RULE.test(lines[i + 1] ?? '') && cells(line).length > 1) {
      const head = cells(line)
      const align = cells(lines[i + 1]!).map((c): Align => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null))
      i += 2
      const rows: Inline[][][] = []
      while (i < lines.length && lines[i]!.trim() && lines[i]!.includes('|')) {
        const row = cells(lines[i++]!)
        rows.push(head.map((_, k) => parseInline(row[k] ?? '')))
      }
      blocks.push({ t: 'table', head: head.map((h) => parseInline(h)), align, rows })
      continue
    }
    const para: string[] = [line]
    i++
    while (i < lines.length && lines[i]!.trim() && !startsBlock(lines[i]!)) para.push(lines[i++]!)
    blocks.push({ t: 'p', c: parseInline(para.map((l) => l.trim()).join('\n')) })
  }
  return blocks
}

/** A list starting at `lines[i]`: items of one kind at one indent; deeper lines belong to the item above. Returns the next line. */
function readList(lines: string[], start: number, out: Block[], depth: number): number {
  const first = ITEM.exec(lines[start]!)!
  const indent = first[1]!.length
  const ordered = /\d/.test(first[2]!)
  const items: Block[][] = []
  let i = start
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]!)
    if (!m || m[1]!.length !== indent || /\d/.test(m[2]!) !== ordered) break
    const width = m[1]!.length + m[2]!.length + 1
    const body = [m[3]!]
    i++
    while (i < lines.length) {
      const l = lines[i]!
      if (!l.trim()) {
        // A blank line keeps the item open only when what follows is indented under it.
        const nextLine = lines[i + 1]
        if (nextLine !== undefined && nextLine.trim() && nextLine.length - nextLine.trimStart().length >= width) {
          body.push('')
          i++
          continue
        }
        break
      }
      const lead = l.length - l.trimStart().length
      if (lead >= width || (lead > indent && !ITEM.test(l))) body.push(l.slice(Math.min(lead, width)))
      else if (!ITEM.test(l) && !startsBlock(l)) body.push(l.trim()) // a lazy continuation line
      else break
      i++
    }
    items.push(parseMarkdown(body.join('\n'), depth + 1))
    while (i < lines.length && !lines[i]!.trim() && ITEM.test(lines[i + 1] ?? '') && (ITEM.exec(lines[i + 1]!)![1]!.length === indent)) i++
  }
  out.push({ t: 'list', ordered, start: ordered ? Number.parseInt(first[2]!, 10) : 1, items })
  return i
}
