import type { ConsoleCapabilities } from '@shared/console'

/**
 * The `/` menu of the composer, as the Console built it. In a `-p` conversation a message that starts with `/name args` runs the skill
 * or command (checked on 2.1.323: skills run as a turn; local commands like /context, /mcp and /clear answer at once, free; commands
 * that exist only in the interactive app are not offered). `@` is the agents' menu now (mentions.ts, rank.ts); this file also finds
 * which of the two the caret is in, so the two menus can never both be open.
 */

export interface Completion {
  /** `command:name` or `skill:name`: the option's id in the list. */
  id: string
  kind: 'skill' | 'command'
  name: string
  /** What goes into the message, with the space after it. */
  insert: string
  description: string
  hint: string
}

export type Trigger = { char: '/' | '@'; query: string; start: number; end: number }

export const MENU_MAX = 40

/** The commands and skills a conversation can use (what its init reported), as menu entries. */
export function completionsFor(caps: ConsoleCapabilities | null): Completion[] {
  return (caps?.commands ?? []).map((c) => ({ id: `${c.kind}:${c.name}`, kind: c.kind, name: c.name, insert: `/${c.name} `, description: c.description, hint: c.hint }))
}

/**
 * Whether the caret is inside a word a menu completes: `/` only at the very start of the message (that is where Claude Code reads a
 * command), `@` at the start of a word. `query` is what was typed after it; `end` is where the word ends, so choosing replaces all of it.
 */
export function triggerAt(text: string, caret: number): Trigger | null {
  if (caret < 1 || caret > text.length) return null
  let start = caret
  while (start > 0 && !/\s/.test(text[start - 1]!)) start--
  const char = text[start]
  if (char !== '/' && char !== '@') return null
  if (char === '/' && start !== 0) return null
  let end = caret
  while (end < text.length && !/\s/.test(text[end]!)) end++
  const query = text.slice(start + 1, caret)
  // `@agent-name` is how Claude Code's own docs write a subagent mention: search for the name.
  return { char, query: char === '@' ? query.replace(/^agent-?/i, '') : query, start, end }
}

/** Matches best first: the name starts with it, then a part after `:` (`help` finds `caveman:caveman-help`) does, then the name, then the description contains it. */
export function matchCompletions(items: readonly Completion[], query: string, max = MENU_MAX): Completion[] {
  const q = query.trim().toLowerCase()
  const scored: [number, Completion][] = []
  for (const item of items) {
    const name = item.name.toLowerCase()
    const score = !q || name.startsWith(q) ? 0 : name.split(/[:/-]/).some((part) => part.startsWith(q)) ? 1 : name.includes(q) ? 2 : item.description.toLowerCase().includes(q) ? 3 : -1
    if (score >= 0) scored.push([score, item])
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).slice(0, max).map(([, item]) => item)
}

/** The text and caret after choosing `item` for `trigger`: its word is replaced, and the caret lands after the space. */
export function applyCompletion(text: string, trigger: Trigger, item: Completion): { text: string; caret: number } {
  const after = text.slice(trigger.end).replace(/^[^\S\n]*/, '')
  return { text: `${text.slice(0, trigger.start)}${item.insert}${after}`, caret: trigger.start + item.insert.length }
}

/** Esc closes the menu for the word it was pressed in. Any other word, even the same one typed again later, opens it again. */
export const stillDismissed = (dismissed: string | null, word: string | null): boolean => dismissed !== null && dismissed === word

/** The word a menu was opened on: its character, where it starts and what was typed. Esc is remembered against it. */
export const wordOf = (t: Trigger | null): string | null => (t ? `${t.char}${t.start}:${t.query}` : null)
