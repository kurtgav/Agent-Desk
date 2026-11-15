import { describe, expect, it } from 'vitest'
import { addMention, diffEdit, displayText, dropMentions, hasMessage, insertMention, keepOnly, makeLead, mentionIds, parseMentions, removeRanges, segmentsOf, swapMention, unitDelete } from './mentions'

const KNOWN = new Set(['cto', 'qa-lead', 'frontend-developer', 'qa'])
const has = (id: string): boolean => KNOWN.has(id)
const name = (id: string): string => ({ cto: 'CTO', 'qa-lead': 'QA Lead', 'frontend-developer': 'Frontend Developer', qa: 'QA' })[id] ?? id

describe('finding mentions in text (chips to ids)', () => {
  it('takes an id the catalog knows, at the start or after a space or bracket', () => {
    expect(parseMentions('@cto plan it', has)).toEqual([{ id: 'cto', start: 0, end: 4 }])
    expect(parseMentions('ask (@qa) and "@cto"', has).map((s) => s.id)).toEqual(['qa', 'cto'])
  })

  it('keeps the exact id, whatever the case that was typed', () => {
    expect(parseMentions('@CTO and @Frontend-Developer', has).map((s) => s.id)).toEqual(['cto', 'frontend-developer'])
  })

  it('reads the longest id: @qa-lead is not @qa', () => {
    expect(parseMentions('@qa-lead check', has).map((s) => s.id)).toEqual(['qa-lead'])
    expect(parseMentions('@qa check', has).map((s) => s.id)).toEqual(['qa'])
  })

  it('ignores what is only text: unknown ids, emails, a partly typed id', () => {
    expect(parseMentions('@everyone mail me@cto.dev or @cto-', has)).toEqual([])
    expect(parseMentions('@ct', has)).toEqual([])
  })

  it('stops an id at punctuation', () => {
    expect(parseMentions('thanks @cto, and @qa.', has).map((s) => s.id)).toEqual(['cto', 'qa'])
  })

  it('lists each agent once, first written first: the first leads', () => {
    const spans = parseMentions('@qa then @cto then @qa again', has)
    expect(spans).toHaveLength(3)
    expect(mentionIds(spans)).toEqual(['qa', 'cto'])
  })
})

describe('text to display text', () => {
  it('writes every mention as @Name and leaves the rest alone', () => {
    const text = '@cto review this,  with @frontend-developer'
    expect(displayText(text, parseMentions(text, has), name)).toBe('@CTO review this,  with @Frontend Developer')
  })

  it('cuts the text into plain pieces and mention pieces, the first mention marked as the lead', () => {
    const text = 'hi @qa and @cto'
    expect(segmentsOf(text, parseMentions(text, has))).toEqual([
      { text: 'hi ', id: null, lead: false },
      { text: '@qa', id: 'qa', lead: true },
      { text: ' and ', id: null, lead: false },
      { text: '@cto', id: 'cto', lead: false }
    ])
    expect(segmentsOf('', [])).toEqual([])
  })

  it('says whether anything is left to say besides the mentions', () => {
    expect(hasMessage('@cto ', parseMentions('@cto ', has))).toBe(false)
    expect(hasMessage('@cto @qa', parseMentions('@cto @qa', has))).toBe(false)
    expect(hasMessage('@cto go', parseMentions('@cto go', has))).toBe(true)
  })
})

describe('editing around mentions', () => {
  it('writes @id and a space over the word being completed', () => {
    expect(insertMention('fix @ct now', { start: 4, end: 7 }, 'cto')).toEqual({ text: 'fix @cto now', caret: 9 })
    expect(insertMention('@c', { start: 0, end: 2 }, 'cto')).toEqual({ text: '@cto ', caret: 5 })
    expect(insertMention('see @q', { start: 4, end: 6 }, 'qa')).toEqual({ text: 'see @qa ', caret: 8 })
  })

  it('does not double the space when one follows already', () => {
    expect(insertMention('@q review', { start: 0, end: 2 }, 'qa')).toEqual({ text: '@qa review', caret: 4 })
  })

  it('keeps a word glued on after the caret, with a space between', () => {
    expect(insertMention('@qFix the test', { start: 0, end: 2 }, 'qa')).toEqual({ text: '@qa Fix the test', caret: 4 })
  })

  it('starts a new word before a mention inserted straight after text', () => {
    expect(insertMention('look', { start: 4, end: 4 }, 'qa').text).toBe('look @qa ')
  })

  it('takes a mention out with one space, so no stray space is left', () => {
    const text = '@cto fix it'
    expect(dropMentions(text, parseMentions(text, has), () => true)).toBe('fix it')
    const end = 'fix it @cto'
    expect(dropMentions(end, parseMentions(end, has), () => true)).toBe('fix it')
    const twice = '@cto @qa go'
    expect(dropMentions(twice, parseMentions(twice, has), () => true)).toBe('go')
  })

  it('makes an agent the lead by writing it first, once', () => {
    const text = '@cto build it with @qa'
    expect(makeLead(text, parseMentions(text, has), 'qa').text).toBe('@qa @cto build it with')
  })

  it('swaps one mention for another and drops a repeat of the new one', () => {
    const text = '@cto build it with @qa'
    const spans = parseMentions(text, has)
    expect(swapMention(text, spans, 0, 'qa').text).toBe('@qa build it with')
    expect(swapMention('plain', [], 0, 'cto').text).toBe('plain @cto ')
  })

  it('adds an agent after the last mention, or at the start, and leaves a repeat alone', () => {
    const text = '@cto go'
    expect(addMention(text, parseMentions(text, has), 'qa').text).toBe('@cto @qa go')
    expect(addMention('go', [], 'qa').text).toBe('@qa go')
    expect(addMention(text, parseMentions(text, has), 'cto').text).toBe(text)
  })

  it('maps offsets through removed ranges, merging overlaps', () => {
    const { text, map } = removeRanges('abcdefghij', [[2, 4], [3, 6], [8, 9]])
    expect(text).toBe('abghj')
    expect(map(1)).toBe(1)
    expect(map(4)).toBe(2)
    expect(map(7)).toBe(3)
    expect(map(9)).toBe(4)
  })
})

describe('Backspace and Delete take a mention as one unit', () => {
  const text = '@cto fix it'
  const spans = parseMentions(text, has)

  it('removes the whole mention, and its space, with Backspace at its end or inside it', () => {
    expect(unitDelete(text, spans, 4, 4, 'back')).toEqual([0, 5])
    expect(unitDelete(text, spans, 2, 2, 'back')).toEqual([0, 5])
  })

  it('removes it with Delete from its start', () => {
    expect(unitDelete(text, spans, 0, 0, 'forward')).toEqual([0, 5])
    expect(unitDelete(text, spans, 1, 1, 'forward')).toEqual([0, 5])
  })

  it('leaves the space between a mention and the caret to be deleted first', () => {
    expect(unitDelete(text, spans, 5, 5, 'back')).toBeNull()
  })

  it('does nothing at the other edge, or in plain text, or with a selection', () => {
    expect(unitDelete(text, spans, 0, 0, 'back')).toBeNull()
    expect(unitDelete(text, spans, 4, 4, 'forward')).toBeNull()
    expect(unitDelete(text, spans, 8, 8, 'back')).toBeNull()
    expect(unitDelete(text, spans, 0, 4, 'back')).toBeNull()
  })

  it('keeps the space before a mention that follows other words', () => {
    const mid = 'ask @qa now'
    expect(unitDelete(mid, parseMentions(mid, has), 7, 7, 'back')).toEqual([4, 8])
  })
})

describe('typing and pasting', () => {
  it('reads a pasted line the same way as a typed one', () => {
    const pasted = 'Please @cto look at this\nand @qa test it'
    expect(mentionIds(parseMentions(pasted, has))).toEqual(['cto', 'qa'])
  })

  it('does not take a word typed through an input method (non-ASCII) for a mention', () => {
    expect(parseMentions('@ｃｔｏ 你好', has)).toEqual([])
  })
})

describe('keeping one agent for a task', () => {
  it('drops every other mention and lands the caret after the one kept', () => {
    const text = '@cto @qa plan it'
    expect(keepOnly(text, parseMentions(text, has), 'qa')).toEqual({ text: '@qa plan it', caret: 4 })
    expect(keepOnly('plan it', [], 'qa').text).toBe('plan it')
  })
})

describe('the smallest edit between two texts', () => {
  it('finds what to cut and what to write, so the browser can make it as one edit', () => {
    expect(diffEdit('fix @ct now', 'fix @cto now')).toEqual({ from: 7, to: 7, insert: 'o' })
    expect(diffEdit('@cto go', 'go')).toEqual({ from: 0, to: 5, insert: '' })
    expect(diffEdit('abc', 'abc')).toEqual({ from: 3, to: 3, insert: '' })
    expect(diffEdit('', '@cto ')).toEqual({ from: 0, to: 0, insert: '@cto ' })
  })

  it('round-trips: applying the edit to the old text gives the new one', () => {
    for (const [a, b] of [['hello world', 'hello brave new world'], ['@q review', '@qa review'], ['one', ''], ['', 'two'], ['same', 'same'], ['aXa', 'aXXa']] as const) {
      const d = diffEdit(a, b)
      expect(a.slice(0, d.from) + d.insert + a.slice(d.to)).toBe(b)
    }
  })
})
