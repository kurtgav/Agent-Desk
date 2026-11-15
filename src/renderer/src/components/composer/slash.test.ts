import { describe, expect, it } from 'vitest'
import { demoCapabilities } from '../console/demo'
import { MENU_MAX, applyCompletion, completionsFor, matchCompletions, stillDismissed, triggerAt, wordOf, type Completion } from './slash'

const item = (name: string, kind: Completion['kind'] = 'command', description = ''): Completion => ({
  id: `${kind}:${name}`, kind, name, insert: `/${name} `, description, hint: ''
})

describe('triggerAt', () => {
  it.each([
    ['/', 1, { char: '/', query: '', start: 0, end: 1 }],
    ['/co', 3, { char: '/', query: 'co', start: 0, end: 3 }],
    ['/context', 3, { char: '/', query: 'co', start: 0, end: 8 }], // the caret is inside the word: the whole word is replaced
    ['/compact keep the tests', 4, { char: '/', query: 'com', start: 0, end: 8 }],
    ['ask @Exp', 8, { char: '@', query: 'Exp', start: 4, end: 8 }],
    ['@', 1, { char: '@', query: '', start: 0, end: 1 }],
    ['@agent-code', 11, { char: '@', query: 'code', start: 0, end: 11 }]
  ])('%j at %i', (text, caret, trigger) => {
    expect(triggerAt(text, caret)).toEqual(trigger)
  })

  it.each([
    ['', 0], ['hello', 5], ['say /context', 12], ['/context now', 12], ['a/b', 3], ['mail me@work', 12], ['/compact ', 9], ['/x', 0], ['/x', 5]
  ])('%j at %i is not a menu', (text, caret) => {
    expect(triggerAt(text, caret)).toBeNull()
  })

  it('does not treat a slash after the first word as a command (Claude Code reads one only at the start of a message)', () => {
    expect(triggerAt('/context\n/mcp', 13)).toBeNull()
  })
})

describe('matchCompletions', () => {
  const items = [item('context', 'command', 'Show current context usage'), item('compact', 'command', 'Clear history but keep a summary'), item('caveman:caveman-help', 'skill', 'Quick-reference card'),
    item('aside', 'skill', 'Answer a side question'), item('plugin-a:review-pr', 'skill', 'Review a pull request'), item('clear', 'command')]

  it('lists everything, in name order, when nothing is typed', () => {
    expect(matchCompletions(items, '').map((c) => c.name)).toEqual(['aside', 'caveman:caveman-help', 'clear', 'compact', 'context', 'plugin-a:review-pr'])
  })

  it('puts names that start with the text first, then a part after a colon or dash, then names that contain it, then descriptions', () => {
    expect(matchCompletions(items, 'co').map((c) => c.name)).toEqual(['compact', 'context'])
    expect(matchCompletions(items, 'help').map((c) => c.name)).toEqual(['caveman:caveman-help'])
    expect(matchCompletions(items, 'view').map((c) => c.name)).toEqual(['plugin-a:review-pr'])
    expect(matchCompletions(items, 'summary').map((c) => c.name)).toEqual(['compact'])
    expect(matchCompletions(items, 'REVIEW').map((c) => c.name)).toEqual(['plugin-a:review-pr'])
  })

  it('finds nothing for nonsense, and caps the list', () => {
    expect(matchCompletions(items, 'zzzz')).toEqual([])
    const many = Array.from({ length: 300 }, (_, i) => item(`cmd-${String(i).padStart(3, '0')}`))
    expect(matchCompletions(many, '')).toHaveLength(MENU_MAX)
    expect(matchCompletions(many, 'cmd-29', 5)).toHaveLength(5)
  })
})

describe('applyCompletion', () => {
  it('replaces the typed word with the command and a space, caret after it', () => {
    expect(applyCompletion('/co', { char: '/', query: 'co', start: 0, end: 3 }, item('compact'))).toEqual({ text: '/compact ', caret: 9 })
  })

  it('keeps what follows, with one space between', () => {
    expect(applyCompletion('/co fix the tests', { char: '/', query: 'co', start: 0, end: 3 }, item('compact'))).toEqual({ text: '/compact fix the tests', caret: 9 })
    expect(applyCompletion('/context   later', { char: '/', query: 'co', start: 0, end: 8 }, item('compact'))).toEqual({ text: '/compact later', caret: 9 })
  })

  it('keeps a line break after the word', () => {
    expect(applyCompletion('/co\nnext line', { char: '/', query: 'co', start: 0, end: 3 }, item('compact'))).toEqual({ text: '/compact \nnext line', caret: 9 })
  })
})

describe('completionsFor', () => {
  it('turns what the conversation reported into entries, skills and commands', () => {
    const commands = completionsFor(demoCapabilities())
    expect(commands.find((c) => c.name === 'aside')).toMatchObject({ kind: 'skill', insert: '/aside ', hint: '<question>' })
    expect(commands.find((c) => c.name === 'context')).toMatchObject({ kind: 'command', insert: '/context ' })
    expect(commands.map((c) => c.name)).not.toContain('doctor')
  })

  it('has nothing before any conversation has reported', () => {
    expect(completionsFor(null)).toEqual([])
  })
})

describe('stillDismissed', () => {
  it('holds only for the very word Esc was pressed in', () => {
    expect(stillDismissed('/0:as', '/0:as')).toBe(true)
    expect(stillDismissed('/0:as', '/0:asi')).toBe(false)
    expect(stillDismissed('/0:as', null)).toBe(false)
    expect(stillDismissed(null, null)).toBe(false)
    expect(stillDismissed(null, '/0:as')).toBe(false)
  })
})

describe('wordOf', () => {
  it('names the word a menu is open on, so Esc can be remembered against it', () => {
    expect(wordOf(triggerAt('ask @Exp', 8))).toBe('@4:Exp')
    expect(wordOf(null)).toBeNull()
  })
})
