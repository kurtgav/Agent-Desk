import { cleanLine } from './roles'

/**
 * Front matter of a role file (the format Claude Code's subagents and the agency-agents personas share): a `---` block of
 * `key: value` lines, then the role's text. A tolerant reader of that subset of YAML, not a YAML parser: one-line values, quoted
 * values (with escapes), folded and literal blocks, and indented continuation lines. Anything else is ignored, never thrown on.
 * Pure, so main, the demo catalog and the tests all read roles the same way.
 */

/** A front matter longer than this is not one: the reader gives up instead of scanning a file for a closing line. */
const FRONT_MATTER_MAX = 32 * 1024
const VALUE_MAX = 4_000
const CONTINUATION_MAX = 60

export interface FrontMatter {
  /** Lower-cased keys; the first of a repeated key wins. */
  fields: Record<string, string>
  /** Everything after the closing `---`. */
  body: string
  /** Characters the front matter takes, delimiters included (BOM excluded). */
  headLength: number
}

/** Escapes of a YAML double-quoted scalar that matter here (JSON.stringify output round-trips). */
function unescapeDouble(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|["\\/nrt0 ])/g, (_m, e: string) => {
    if (e.length > 1) return String.fromCharCode(parseInt(e.slice(1), 16))
    return e === 'n' ? '\n' : e === 'r' ? '\r' : e === 't' ? '\t' : e === '0' ? '\0' : e
  })
}

/** Reads one quoted scalar that starts at `raw[0]`, taking more lines when the closing quote is not on the first. Null when unclosed. */
function readQuoted(raw: string, rest: string[]): { value: string; used: number } | null {
  const quote = raw[0]!
  let text = raw.slice(1)
  let used = 0
  for (;;) {
    let i = 0
    for (; i < text.length; i++) {
      if (quote === '"' && text[i] === '\\') i++
      else if (text[i] === quote) {
        if (quote === "'" && text[i + 1] === "'") i++
        else break
      }
    }
    if (i < text.length) {
      const inner = text.slice(0, i)
      return { value: quote === '"' ? unescapeDouble(inner) : inner.replace(/''/g, "'"), used }
    }
    const next = rest[used]
    if (next === undefined || used >= CONTINUATION_MAX) return null
    text = `${text} ${next.trim()}`
    used++
  }
}

const isIndented = (line: string): boolean => /^[ \t]/.test(line)

/** Splits `text` into its front matter fields and body; null when there is no `---` block at the top. */
export function parseFrontMatter(text: string): FrontMatter | null {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const open = /^---[ \t]*\r?\n/.exec(s)
  if (!open) return null
  const close = /\r?\n---[ \t]*(?:\r?\n|$)/g
  close.lastIndex = open[0].length - 1
  const end = close.exec(s)
  if (!end || end.index > FRONT_MATTER_MAX) return null
  const block = s.slice(open[0].length, end.index)
  const lines = block.split(/\r?\n/)
  const fields: Record<string, string> = {}
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z_][\w-]*)[ \t]*:[ \t]*(.*)$/.exec(lines[i]!)
    if (!m) continue
    const key = m[1]!.toLowerCase()
    const raw = m[2]!.trim()
    let value: string
    if (/^[>|][+-]?\d?$/.test(raw)) {
      // Block scalar: the indented lines that follow. Folded (>) joins them with spaces, literal (|) keeps the breaks.
      const taken: string[] = []
      while (i + 1 < lines.length && taken.length < CONTINUATION_MAX && (isIndented(lines[i + 1]!) || lines[i + 1]!.trim() === '')) taken.push(lines[++i]!.trim())
      value = raw[0] === '>' ? taken.filter(Boolean).join(' ') : taken.join('\n').trim()
    } else if (raw[0] === '"' || raw[0] === "'") {
      const q = readQuoted(raw, lines.slice(i + 1))
      if (q) {
        value = q.value
        i += q.used
      } else value = raw.slice(1)
    } else {
      // Plain scalar, possibly continued on indented lines. A ` #` starts a comment, as in YAML.
      const parts = [raw.replace(/\s+#.*$/, '')]
      while (i + 1 < lines.length && parts.length <= CONTINUATION_MAX && isIndented(lines[i + 1]!) && lines[i + 1]!.trim() !== '' && !/^\s*-\s/.test(lines[i + 1]!)) {
        parts.push(lines[++i]!.trim().replace(/\s+#.*$/, ''))
      }
      value = parts.filter(Boolean).join(' ')
    }
    if (!(key in fields)) fields[key] = value.slice(0, VALUE_MAX)
  }
  const bodyStart = end.index + end[0].length
  return { fields, body: s.slice(bodyStart), headLength: bodyStart }
}

export interface RoleMeta {
  name: string
  description: string
  vibe: string
  emoji: string
}

const FALLBACK_EMOJI = '🤖'
const NAME_MAX = 80

/** The first sentence of a description, for a card that has no one-liner of its own. */
export function firstSentence(text: string, max = 110): string {
  const t = cleanLine(text)
  const cut = /^(.{20,}?[.!?])(\s|$)/.exec(t)?.[1] ?? t
  return cut.length <= max ? cut : `${cut.slice(0, max - 1).trimEnd()}…`
}

/**
 * What a card needs from a front matter. Null when there is no usable name (a file without one is not a role).
 * Display text is cleaned of invisible and bidi characters; the name is cut at 80 characters.
 */
export function roleMeta(fields: Record<string, string>): RoleMeta | null {
  const name = cleanLine(fields.name ?? '').slice(0, NAME_MAX).trim()
  if (!name) return null
  const description = cleanLine(fields.description ?? '')
  const vibe = cleanLine(fields.vibe ?? '') || firstSentence(description)
  const emoji = cleanLine(fields.emoji ?? '')
  return { name, description, vibe, emoji: emoji && emoji.length <= 16 ? emoji : FALLBACK_EMOJI }
}
