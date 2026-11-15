import type { SessionAction } from '@shared/bridge'
import { RESUME_PATTERN } from '@shared/console'
import { NOT_DELETABLE, type SessionMetaEntry, type SessionMetaPatch } from '@shared/session-meta'
import { PROVIDER_NAME, type Session } from '@shared/snapshot'
import { isMac } from '@/lib/platform'

/**
 * What a session's menu holds, as plain data: the labels, the key that runs each item, and why an item is out of reach.
 * SessionMenu.tsx only draws it, so the rules here (which items exist, which are disabled and why, which key does what) are
 * tested without a window.
 */

export type IconKey =
  | 'open' | 'details' | 'code' | 'cursor' | 'explorer' | 'terminal' | 'desktop' | 'attach'
  | 'pin' | 'unpin' | 'unread' | 'read' | 'rename' | 'fork' | 'move' | 'archive' | 'unarchive' | 'delete' | 'stop' | 'copy' | 'plus'

export interface MenuItem {
  kind: 'item'
  /** Stable, for tests and `data-` hooks. */
  id: string
  label: string
  icon?: IconKey
  /** The one key that runs it while its menu is open (a letter in the main menu, a digit in a submenu). */
  key?: string
  danger?: boolean
  checked?: boolean
  /** Why it can not run. The item stays in the menu, focusable, and says this as its tooltip (D-103). */
  disabled?: string
  run(): void
}
export interface MenuSub {
  kind: 'sub'
  id: string
  label: string
  icon?: IconKey
  entries: MenuEntry[]
}
export interface MenuHeading {
  kind: 'heading'
  text: string
}
export interface MenuRule {
  kind: 'rule'
}
export type MenuEntry = MenuItem | MenuSub | MenuHeading | MenuRule

/** What choosing an item does. SessionMenu wires these to the store, the dialogs and the bridge; a test passes fakes. */
export interface MenuDo {
  details(): void
  /** A session action main runs (open a folder, attach, copy the resume command…). Demo says nothing was run. */
  action(action: SessionAction): void
  note(patch: SessionMetaPatch): void
  rename(): void
  fork(): void
  newSection(): void
  stop(): void
  remove(): void
}

export interface MenuInput {
  session: Session
  note: SessionMetaEntry | undefined
  /** The user's sections, in order. */
  sections: readonly string[]
  /** Which optional programs this PC has. */
  tools: { cursor: boolean }
  do: MenuDo
}

/** Fork is out of reach only for a session that can not be copied: Claude Code is asked for it by id, in its folder. */
export const NO_SESSION_ID = "AgentDeck does not know this session's Claude Code id, so it cannot be forked."
/** Said after Archive: a running or waiting session is never hidden from where you answer it. */
export const ARCHIVED_RUNNING = 'Archived. It keeps running and still shows in Needs you when it needs you.'
export const ARCHIVED = 'Archived. Find it under Sessions, with Archived set to Included.'
export const NO_FOLDER = "AgentDeck does not know this session's folder."
/** The CLI a session runs in when it is not Claude Code: AgentDeck only watches those (ADR-0014). */
export const otherCli = (s: Session): string | null => (s.provider && s.provider !== 'claude' ? PROVIDER_NAME[s.provider] : null)
export const NOT_A_TERMINAL = 'This session runs in Claude Desktop, not in a terminal.'

const rule: MenuRule = { kind: 'rule' }
const heading = (text: string): MenuHeading => ({ kind: 'heading', text })

/** Why a session can not be forked (the Console starts `claude --resume <id> --fork-session` in its folder), or null when it can. */
export function forkBlocked(s: Session): string | null {
  const cli = otherCli(s)
  if (cli) return `This session runs in ${cli}, so it cannot be forked.`
  if (!RESUME_PATTERN.test(s.id)) return NO_SESSION_ID
  return s.cwd ? null : NO_FOLDER
}

/** Working, or waiting for you. */
const stoppable = (s: Session): boolean => s.bgId !== null && s.status !== 'done'

/** A waiting session is answered where it runs: its terminal, Claude Desktop, or a terminal attached to it. */
export function answerAction(s: Session): { action: SessionAction; label: string } {
  if (s.surface === 'desktop') return { action: 'open-desktop', label: 'Answer in Claude Desktop' }
  if (s.bgId) return { action: 'attach', label: 'Answer in terminal' }
  return { action: 'focus-terminal', label: 'Answer in terminal' }
}

/** Open in ▸ : the numbered items, in two groups. Numbers run on from 1 over what is there, so a missing Cursor leaves no gap. */
function openIn({ session: s, tools, do: d }: MenuInput): MenuSub {
  const folder = (item: Omit<MenuItem, 'kind' | 'disabled'>): MenuItem => ({ ...item, kind: 'item', disabled: s.cwd ? undefined : NO_FOLDER })
  const background = s.bgId !== null
  const terminal: MenuItem = background
    ? { kind: 'item', id: 'attach', label: 'Attach in a terminal', icon: 'attach', run: () => d.action('attach') }
    : {
        kind: 'item',
        id: 'terminal',
        label: "The session's terminal",
        icon: 'attach',
        disabled: s.surface === 'desktop' ? NOT_A_TERMINAL : undefined,
        run: () => d.action('focus-terminal')
      }
  const items: MenuEntry[] = [
    heading('Open in'),
    { kind: 'item', id: 'details', label: 'Details panel', icon: 'details', run: d.details },
    folder({ id: 'vscode', label: 'VS Code', icon: 'code', run: () => d.action('open-folder') }),
    ...(tools.cursor ? [folder({ id: 'cursor', label: 'Cursor', icon: 'cursor', run: () => d.action('open-cursor') })] : []),
    folder({ id: 'explorer', label: isMac() ? 'Finder' : 'Explorer', icon: 'explorer', run: () => d.action('open-explorer') }),
    folder({ id: 'terminal-here', label: 'Terminal here', icon: 'terminal', run: () => d.action('open-terminal') }),
    heading('Continue in'),
    { kind: 'item', id: 'desktop', label: 'Claude Desktop', icon: 'desktop', disabled: otherCli(s) ? `This session runs in ${otherCli(s)}, not in Claude Desktop.` : undefined, run: () => d.action('open-desktop') },
    terminal
  ]
  let n = 0
  return { kind: 'sub', id: 'open', label: 'Open in', icon: 'open', entries: items.map((e) => (e.kind === 'item' ? { ...e, key: String(++n) } : e)) }
}

/** Move to section ▸ : the sections (checked on the current one), None, then a new one. */
function moveTo({ note, sections, do: d }: MenuInput): MenuSub {
  const current = note?.section
  const choices: MenuItem[] = [
    ...sections.map((name): MenuItem => ({ kind: 'item', id: `section:${name}`, label: name, checked: current === name, run: () => d.note({ section: name }) })),
    { kind: 'item', id: 'section:none', label: 'None', checked: current === undefined, run: () => d.note({ section: null }) }
  ]
  const numbered = choices.map((c, i) => (i < 9 ? { ...c, key: String(i + 1) } : c))
  const create: MenuItem = { kind: 'item', id: 'new-section', label: 'New section…', icon: 'plus', key: 'n', run: d.newSection }
  return { kind: 'sub', id: 'move', label: 'Move to section', icon: 'move', entries: sections.length ? [...numbered, rule, create] : [heading('No sections yet'), create] }
}

export function buildMenu(input: MenuInput): MenuEntry[] {
  const { session: s, note, do: d } = input
  const pinned = note?.pinned === true
  const unread = note?.unread === true
  const archived = note?.archived === true
  const waiting = s.status === 'needs_you'
  const answer = answerAction(s)
  const extras: MenuItem[] = [
    ...(waiting ? [{ kind: 'item' as const, id: 'answer', label: answer.label, icon: 'attach' as const, key: 't', run: () => d.action(answer.action) }] : []),
    ...(stoppable(s) ? [{ kind: 'item' as const, id: 'stop', label: 'Stop', icon: 'stop' as const, key: 's', run: d.stop }] : []),
    { kind: 'item', id: 'copy-resume', label: 'Copy resume command', icon: 'copy', key: 'c', run: () => d.action('copy-resume') }
  ]
  return [
    openIn(input),
    rule,
    { kind: 'item', id: 'pin', label: pinned ? 'Unpin' : 'Pin', icon: pinned ? 'unpin' : 'pin', key: 'p', run: () => d.note({ pinned: !pinned }) },
    { kind: 'item', id: 'unread', label: unread ? 'Mark as read' : 'Mark as unread', icon: unread ? 'read' : 'unread', key: 'u', run: () => d.note({ unread: !unread }) },
    { kind: 'item', id: 'rename', label: 'Rename', icon: 'rename', key: 'r', run: d.rename },
    { kind: 'item', id: 'fork', label: 'Fork', icon: 'fork', key: 'f', disabled: forkBlocked(s) ?? undefined, run: d.fork },
    rule,
    moveTo(input),
    rule,
    { kind: 'item', id: 'archive', label: archived ? 'Unarchive' : 'Archive', icon: archived ? 'unarchive' : 'archive', key: 'a', run: () => d.note({ archived: !archived }) },
    {
      kind: 'item',
      id: 'delete',
      label: 'Delete',
      icon: 'delete',
      key: 'd',
      danger: true,
      disabled: s.bgId === null ? NOT_DELETABLE : undefined,
      run: d.remove
    },
    rule,
    ...extras
  ]
}

/** The items a key can reach in one menu level (a submenu has its own), by lower-case key. */
export function acceleratorMap(entries: readonly MenuEntry[]): Map<string, MenuItem> {
  const map = new Map<string, MenuItem>()
  for (const e of entries) if (e.kind === 'item' && e.key && !map.has(e.key.toLowerCase())) map.set(e.key.toLowerCase(), e)
  return map
}

/** The item a key press runs, or undefined: held keys, shortcuts with Ctrl, Alt or Meta, and anything that is not one character are not accelerators. */
export function itemForKey(entries: readonly MenuEntry[], e: { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; repeat?: boolean }): MenuItem | undefined {
  if (e.ctrlKey || e.altKey || e.metaKey || e.repeat || e.key.length !== 1) return undefined
  return acceleratorMap(entries).get(e.key.toLowerCase())
}
