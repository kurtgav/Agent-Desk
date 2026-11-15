import { describe, expect, it } from 'vitest'
import type { SessionAction } from '@shared/bridge'
import { NOT_DELETABLE, type SessionMetaPatch } from '@shared/session-meta'
import type { Session } from '@shared/snapshot'
import { ARCHIVED, ARCHIVED_RUNNING, NOT_A_TERMINAL, NO_FOLDER, NO_SESSION_ID, acceleratorMap, answerAction, buildMenu, forkBlocked, itemForKey, type MenuDo, type MenuEntry, type MenuInput, type MenuItem, type MenuSub } from './model'

const session = (over: Partial<Session> = {}): Session => ({
  id: 's1', bgId: null, name: 'auth-tests', cwd: 'C:\\clients\\acme', surface: 'cli', status: 'working', startedAt: 0, lastEventAt: 0, activity: '', plan: null, waitingSince: null, subagents: [], ...over
})

interface Calls {
  details: number
  action: SessionAction[]
  note: SessionMetaPatch[]
  rename: number
  fork: number
  newSection: number
  stop: number
  remove: number
}
/** Records what the menu asked for, so a test reads it back. */
function fakeDo(): MenuDo & { calls: Calls } {
  const calls: Calls = { details: 0, action: [], note: [], rename: 0, fork: 0, newSection: 0, stop: 0, remove: 0 }
  return {
    calls,
    details: () => void calls.details++,
    action: (a) => void calls.action.push(a),
    note: (p) => void calls.note.push(p),
    rename: () => void calls.rename++,
    fork: () => void calls.fork++,
    newSection: () => void calls.newSection++,
    stop: () => void calls.stop++,
    remove: () => void calls.remove++
  }
}
const input = (over: Partial<MenuInput> = {}): MenuInput => ({ session: session(), note: undefined, sections: [], tools: { cursor: true }, do: fakeDo(), ...over })

const items = (entries: readonly MenuEntry[]): MenuItem[] => entries.filter((e): e is MenuItem => e.kind === 'item')
const sub = (entries: readonly MenuEntry[], id: string): MenuSub => entries.find((e): e is MenuSub => e.kind === 'sub' && e.id === id)!
const byId = (entries: readonly MenuEntry[], id: string): MenuItem => items(entries).find((i) => i.id === id)!
const shape = (entries: readonly MenuEntry[]): string[] => entries.map((e) => (e.kind === 'item' ? `${e.key ?? '-'} ${e.label}` : e.kind === 'sub' ? `> ${e.label}` : e.kind === 'heading' ? `# ${e.text}` : '---'))

describe('the menu, top to bottom', () => {
  it('Open in, a rule, Pin, Mark as unread, Rename, Fork, a rule, Move to section, a rule, Archive, Delete, then a quiet group', () => {
    expect(shape(buildMenu(input()))).toEqual([
      '> Open in',
      '---',
      'p Pin',
      'u Mark as unread',
      'r Rename',
      'f Fork',
      '---',
      '> Move to section',
      '---',
      'a Archive',
      'd Delete',
      '---',
      'c Copy resume command'
    ])
  })

  it('every item that runs something has its own key, and a key is used once per level', () => {
    const main = buildMenu(input({ session: session({ bgId: 'afc61673', status: 'needs_you' }) }))
    const keys = items(main).map((i) => i.key)
    expect(keys).toEqual(['p', 'u', 'r', 'f', 'a', 'd', 't', 's', 'c'])
    expect(new Set(keys).size).toBe(keys.length)
    expect(acceleratorMap(main).size).toBe(keys.length)
  })

  it('offers neither Cloud nor a split view nor a new window: AgentDeck can not do them', () => {
    const labels = JSON.stringify(buildMenu(input()))
    for (const word of ['Cloud', 'Split', 'New window']) expect(labels).not.toContain(word)
  })

  it('Pin, Mark as unread and Archive turn into their opposites and keep their keys', () => {
    const menu = buildMenu(input({ note: { pinned: true, unread: true, archived: true } }))
    expect(items(menu).map((i) => `${i.key} ${i.label}`).slice(0, 5)).toEqual(['p Unpin', 'u Mark as read', 'r Rename', 'f Fork', 'a Unarchive'])
  })

  it('choosing Pin, Unread or Archive asks for the opposite of what is set', () => {
    const d = fakeDo()
    const menu = buildMenu(input({ note: { pinned: true }, do: d }))
    byId(menu, 'pin').run()
    byId(menu, 'unread').run()
    byId(menu, 'archive').run()
    expect(d.calls.note).toEqual([{ pinned: false }, { unread: true }, { archived: true }])
  })
})

describe('Fork', () => {
  it('is in reach for a session with a Claude Code id and a folder, and runs', () => {
    const d = fakeDo()
    const fork = byId(buildMenu(input({ do: d })), 'fork')
    expect(fork).toMatchObject({ key: 'f' })
    expect(fork.disabled).toBeUndefined()
    fork.run()
    expect(d.calls.fork).toBe(1)
  })

  it('is out of reach only for what cannot be copied, and says why (never "arrives later")', () => {
    expect(byId(buildMenu(input({ session: session({ id: '' }) })), 'fork').disabled).toBe(NO_SESSION_ID)
    expect(byId(buildMenu(input({ session: session({ id: '--help' }) })), 'fork').disabled).toBe(NO_SESSION_ID)
    expect(byId(buildMenu(input({ session: session({ cwd: '' }) })), 'fork').disabled).toBe(NO_FOLDER)
    expect(forkBlocked(session({ id: '9c1d2e3f-aaaa-4bbb-8ccc-0123456789ab' }))).toBeNull()
    expect(NO_SESSION_ID).not.toMatch(/next update|arrives/i)
  })
})

describe('Archive', () => {
  it('says what it did, and that a running session keeps running and still shows in Needs you', () => {
    expect(ARCHIVED_RUNNING).toBe('Archived. It keeps running and still shows in Needs you when it needs you.')
    expect(ARCHIVED).toContain('Archived')
  })
})

describe('Delete', () => {
  it('is out of reach for a session Claude Code keeps, and the tooltip says what AgentDeck does instead', () => {
    for (const s of [session(), session({ surface: 'desktop' }), session({ surface: 'vscode' })]) {
      expect(byId(buildMenu(input({ session: s })), 'delete')).toMatchObject({ disabled: NOT_DELETABLE, danger: true, key: 'd' })
    }
    expect(NOT_DELETABLE).toBe("Claude Code keeps this session's history. AgentDeck can archive it, but it never deletes Claude Code's files.")
  })

  it('is available for a background session and asks for the confirmation', () => {
    const d = fakeDo()
    const del = byId(buildMenu(input({ session: session({ bgId: 'afc61673', surface: 'background' }), do: d })), 'delete')
    expect(del.disabled).toBeUndefined()
    del.run()
    expect(d.calls.remove).toBe(1)
  })
})

describe('under the quiet divider', () => {
  const ids = (s: Session): string[] => items(buildMenu(input({ session: s }))).map((i) => i.id).slice(6)

  it('an interactive session: Copy resume command only (it can not be stopped from here)', () => {
    expect(ids(session())).toEqual(['copy-resume'])
  })

  it('a background session that has not ended can be stopped; one that is done can not', () => {
    expect(ids(session({ bgId: 'afc61673', status: 'working' }))).toEqual(['stop', 'copy-resume'])
    expect(ids(session({ bgId: 'afc61673', status: 'done' }))).toEqual(['copy-resume'])
  })

  it('a waiting session can be answered where it runs', () => {
    expect(answerAction(session({ status: 'needs_you' }))).toEqual({ action: 'focus-terminal', label: 'Answer in terminal' })
    expect(answerAction(session({ bgId: 'afc61673' }))).toEqual({ action: 'attach', label: 'Answer in terminal' })
    expect(answerAction(session({ surface: 'desktop' }))).toEqual({ action: 'open-desktop', label: 'Answer in Claude Desktop' })
    expect(ids(session({ status: 'needs_you' }))).toEqual(['answer', 'copy-resume'])
    expect(ids(session({ status: 'working' }))).not.toContain('answer')
  })

  it('Stop asks for its confirmation instead of stopping', () => {
    const d = fakeDo()
    byId(buildMenu(input({ session: session({ bgId: 'afc61673' }), do: d })), 'stop').run()
    expect(d.calls.stop).toBe(1)
    expect(d.calls.action).toEqual([])
  })
})

describe('Open in ▸', () => {
  const open = (over: Partial<MenuInput> = {}): MenuSub => sub(buildMenu(input(over)), 'open')

  it('two groups, numbered 1 to 7', () => {
    expect(shape(open().entries)).toEqual([
      '# Open in',
      '1 Details panel',
      '2 VS Code',
      '3 Cursor',
      '4 Explorer',
      '5 Terminal here',
      '# Continue in',
      '6 Claude Desktop',
      "7 The session's terminal"
    ])
  })

  it('leaves Cursor out when it is not installed, and the numbers close up', () => {
    const entries = open({ tools: { cursor: false } }).entries
    expect(items(entries).map((i) => i.label)).not.toContain('Cursor')
    expect(items(entries).map((i) => i.key)).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  it('a background session attaches instead of focusing a terminal', () => {
    const d = fakeDo()
    const attach = byId(open({ session: session({ bgId: 'afc61673' }), do: d }).entries, 'attach')
    expect(attach.label).toBe('Attach in a terminal')
    attach.run()
    expect(d.calls.action).toEqual(['attach'])
  })

  it('runs the right action for each item', () => {
    const d = fakeDo()
    const entries = open({ do: d }).entries
    for (const id of ['details', 'vscode', 'cursor', 'explorer', 'terminal-here', 'desktop', 'terminal']) byId(entries, id).run()
    expect(d.calls.details).toBe(1)
    expect(d.calls.action).toEqual(['open-folder', 'open-cursor', 'open-explorer', 'open-terminal', 'open-desktop', 'focus-terminal'])
  })

  it('without a folder, the items that need one are out of reach and say why; the others still work', () => {
    const entries = open({ session: session({ cwd: '' }) }).entries
    for (const id of ['vscode', 'cursor', 'explorer', 'terminal-here']) expect(byId(entries, id).disabled).toBe(NO_FOLDER)
    for (const id of ['details', 'desktop', 'terminal']) expect(byId(entries, id).disabled).toBeUndefined()
  })

  it('a Claude Desktop session has no terminal to go to', () => {
    expect(byId(open({ session: session({ surface: 'desktop' }) }).entries, 'terminal').disabled).toBe(NOT_A_TERMINAL)
  })

  it('a Codex CLI session keeps its folder and terminal, and says why it cannot fork or open in Claude Desktop', () => {
    const s = session({ id: 'codex:019a7c2e-5b1d-7f20-9c4e-2d8f6a1b3c50', provider: 'codex' })
    const entries = open({ session: s }).entries
    for (const id of ['vscode', 'explorer', 'terminal-here', 'terminal']) expect(byId(entries, id).disabled).toBeUndefined()
    expect(byId(entries, 'desktop').disabled).toBe('This session runs in Codex CLI, not in Claude Desktop.')
    expect(forkBlocked(s)).toBe('This session runs in Codex CLI, so it cannot be forked.')
  })
})

describe('Move to section ▸', () => {
  const move = (over: Partial<MenuInput> = {}): MenuSub => sub(buildMenu(input(over)), 'move')

  it('lists the sections with a check on the current one, then None, a rule and New section…', () => {
    const entries = move({ sections: ['Client work', 'Home'], note: { section: 'Home' } }).entries
    expect(shape(entries)).toEqual(['1 Client work', '2 Home', '3 None', '---', 'n New section…'])
    expect(items(entries).map((i) => i.checked)).toEqual([false, true, false, undefined])
  })

  it('None is checked when the session is in no section', () => {
    expect(byId(move({ sections: ['Home'] }).entries, 'section:none').checked).toBe(true)
  })

  it('files the session, or takes it out, or starts a new section', () => {
    const d = fakeDo()
    const entries = move({ sections: ['Home'], do: d }).entries
    byId(entries, 'section:Home').run()
    byId(entries, 'section:none').run()
    byId(entries, 'new-section').run()
    expect(d.calls.note).toEqual([{ section: 'Home' }, { section: null }])
    expect(d.calls.newSection).toBe(1)
  })

  it('with no sections yet it says so and offers New section…', () => {
    expect(shape(move().entries)).toEqual(['# No sections yet', 'n New section…'])
  })

  it('numbers only the first nine, the rest are reached with the arrows', () => {
    const sections = Array.from({ length: 12 }, (_, i) => `S${i + 1}`)
    const keys = items(move({ sections }).entries).map((i) => i.key)
    expect(keys.slice(0, 9)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9'])
    expect(keys.slice(9)).toEqual([undefined, undefined, undefined, undefined, 'n'])
  })
})

describe('accelerators', () => {
  const press = (key: string, over: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean; repeat: boolean }> = {}) => ({ key, ctrlKey: false, altKey: false, metaKey: false, ...over })
  const main = buildMenu(input())

  it('a letter runs its item in the main menu, in either case', () => {
    expect(itemForKey(main, press('p'))?.id).toBe('pin')
    expect(itemForKey(main, press('P'))?.id).toBe('pin')
    expect(itemForKey(main, press('d'))?.id).toBe('delete')
  })

  it('a digit runs the submenu item, and means nothing in the main menu', () => {
    const open = sub(main, 'open').entries
    expect(itemForKey(open, press('1'))?.id).toBe('details')
    expect(itemForKey(open, press('6'))?.id).toBe('desktop')
    expect(itemForKey(main, press('1'))).toBeUndefined()
    expect(itemForKey(open, press('p'))).toBeUndefined()
  })

  it('a key with Ctrl, Alt or Meta, a held key, an arrow and Enter are not accelerators', () => {
    for (const e of [press('p', { ctrlKey: true }), press('p', { altKey: true }), press('p', { metaKey: true }), press('p', { repeat: true }), press('ArrowDown'), press('Enter'), press(' ')]) {
      expect(itemForKey(main, e)).toBeUndefined()
    }
  })

  it('reaches a disabled item too, so the press can say why it does nothing', () => {
    expect(itemForKey(main, press('d'))?.disabled).toBe(NOT_DELETABLE)
    expect(itemForKey(main, press('f'))?.disabled).toBeUndefined()
    expect(itemForKey(buildMenu(input({ session: session({ id: '' }) })), press('f'))?.disabled).toBe(NO_SESSION_ID)
  })
})
