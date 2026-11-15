import { useMemo, useState } from 'react'
import type { ConsoleCapabilities } from '@shared/console'
import type { RoleSummary } from '@shared/roles'
import { optionId } from './MentionList'
import { menuRows, optionsOf, type MenuRow } from './rank'
import { SLASH_LIST_ID, slashOptionId, type SlashNote } from './SlashList'
import { completionsFor, matchCompletions, stillDismissed, triggerAt, wordOf, type Completion, type Trigger } from './slash'
import type { RoleIndex } from './useRoleIndex'

export const MENTION_LIST_ID = 'composer-mentions'

export interface Menus {
  /** Which menu the caret's word opens: `/` for commands and skills, `@` for agents. Never both. */
  kind: 'slash' | 'mention' | null
  trigger: Trigger | null
  /** The menu is showing: a list, or the note saying why there is none. */
  open: boolean
  listed: boolean
  /** The highlighted entry, among those listed. */
  index: number
  count: number
  /** For `aria-activedescendant`, set only while entries are listed. */
  activeId: string | undefined
  listId: string | undefined
  slash: { items: Completion[]; note: SlashNote | null }
  mention: { rows: MenuRow[]; options: RoleSummary[] }
  move(delta: number): void
  setActive(i: number): void
  dismiss(): void
  /** The highlighted entry's slash command text, or null. */
  slashAt(i?: number): Completion | null
  mentionAt(i?: number): RoleSummary | null
}

interface Input {
  text: string
  caret: number
  /** The box has the focus. */
  focused: boolean
  /** `/` is the Console's, so a task has none. */
  slash: boolean
  caps: ConsoleCapabilities | null
  roles: RoleIndex
  recent: readonly string[]
}

const NO_ROWS: MenuRow[] = []
const NO_OPTIONS: RoleSummary[] = []

/**
 * Which menu is open for the word at the caret, what it lists, and the keys' effects on it. Esc closes the menu for that word only:
 * when the word changes the old Esc no longer applies, so the menu opens again (the Console had exactly that bug).
 */
export function useMenus({ text, caret, focused, slash, caps, roles, recent }: Input): Menus {
  const found = useMemo(() => triggerAt(text, caret), [text, caret])
  const trigger = found && (found.char === '@' || slash) ? found : null
  const word = wordOf(trigger)
  const [dismissed, setDismissed] = useState<string | null>(null)
  // Reset while rendering, not in an effect: the word changed, so the old Esc no longer applies.
  if (dismissed !== null && !stillDismissed(dismissed, word)) setDismissed(null)
  const [active, setActiveAt] = useState<{ word: string | null; i: number }>({ word: null, i: 0 })
  // A menu opens on its first entry, every time: closing it forgets the highlight, even when the same word comes back.
  if (active.word !== word) setActiveAt({ word, i: 0 })

  const commands = useMemo(() => completionsFor(caps), [caps])
  const items = useMemo(() => (trigger?.char === '/' ? matchCompletions(commands, trigger.query) : []), [trigger, commands])
  const query = trigger?.char === '@' ? trigger.query : null
  const rows = useMemo(() => (query === null ? NO_ROWS : menuRows(roles.roles, roles.divisions, query, { pinned: roles.pinned, recent })), [query, roles, recent])
  const options = useMemo(() => (query === null ? NO_OPTIONS : optionsOf(rows)), [query, rows])

  const kind = trigger ? (trigger.char === '/' ? 'slash' : 'mention') : null
  const count = kind === 'slash' ? items.length : kind === 'mention' ? options.length : 0
  const slashNote: SlashNote | null = kind === 'slash' && items.length === 0 ? (caps === null ? 'load' : 'none') : null
  // `@` always has something to say: the agents, or that they are loading, or that none match.
  const open = focused && kind !== null && dismissed !== word && (count > 0 || kind === 'mention' || slashNote !== null)
  const index = active.word === word ? Math.min(active.i, Math.max(0, count - 1)) : 0
  const activeId = open && count > 0 ? (kind === 'slash' ? slashOptionId(items[index]!) : optionId(MENTION_LIST_ID, options[index]!)) : undefined

  return {
    kind,
    trigger,
    open,
    listed: open && count > 0,
    index,
    count,
    activeId,
    listId: open && count > 0 ? (kind === 'slash' ? SLASH_LIST_ID : MENTION_LIST_ID) : undefined,
    slash: { items, note: slashNote },
    mention: { rows, options },
    move: (delta) => setActiveAt({ word, i: count ? (index + delta + count) % count : 0 }),
    setActive: (i) => setActiveAt({ word, i }),
    dismiss: () => setDismissed(word),
    slashAt: (i = index) => (kind === 'slash' ? (items[i] ?? null) : null),
    mentionAt: (i = index) => (kind === 'mention' ? (options[i] ?? null) : null)
  }
}
