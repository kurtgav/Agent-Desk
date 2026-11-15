import { describe, expect, it } from 'vitest'
import { composerKey, type KeyEvent, type KeyState } from './keys'

const ev = (key: string, over: Partial<KeyEvent> = {}): KeyEvent => ({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, composing: false, ...over })
const idle: KeyState = { menu: 'none', whole: false, singleLine: false, running: false }
const listed: KeyState = { ...idle, menu: 'listed' }

describe('sending', () => {
  it('sends on Enter, and Shift+Enter is a new line', () => {
    expect(composerKey(ev('Enter'), idle)).toBe('send')
    expect(composerKey(ev('Enter', { shiftKey: true }), idle)).toBeNull()
  })

  it('sends on Ctrl+Enter or Cmd+Enter even with a menu open', () => {
    expect(composerKey(ev('Enter', { ctrlKey: true }), idle)).toBe('send')
    expect(composerKey(ev('Enter', { ctrlKey: true }), listed)).toBe('send')
    expect(composerKey(ev('Enter', { metaKey: true }), listed)).toBe('send')
  })

  it('sends a one-line task on any Enter', () => {
    expect(composerKey(ev('Enter', { shiftKey: true }), { ...idle, singleLine: true })).toBe('send')
  })

  it('never takes a key that belongs to an input method', () => {
    for (const key of ['Enter', 'Escape', 'Backspace', 'ArrowDown', 'Tab']) expect(composerKey(ev(key, { composing: true }), listed), key).toBeNull()
  })
})

describe('the menu', () => {
  it('works the list with the arrows, and picks with Tab or Enter', () => {
    expect(composerKey(ev('ArrowDown'), listed)).toBe('menu-down')
    expect(composerKey(ev('ArrowUp'), listed)).toBe('menu-up')
    expect(composerKey(ev('PageDown'), listed)).toBe('menu-page-down')
    expect(composerKey(ev('PageUp'), listed)).toBe('menu-page-up')
    expect(composerKey(ev('Tab'), listed)).toBe('menu-pick')
    expect(composerKey(ev('Enter'), listed)).toBe('menu-pick')
  })

  it('lets Enter send when the whole name is typed already, and Shift keep its meaning', () => {
    expect(composerKey(ev('Enter'), { ...listed, whole: true })).toBe('send')
    expect(composerKey(ev('Enter', { shiftKey: true }), listed)).toBeNull()
    expect(composerKey(ev('Tab', { shiftKey: true }), listed)).toBeNull()
  })

  it('closes on Escape whether or not anything is listed', () => {
    expect(composerKey(ev('Escape'), listed)).toBe('menu-dismiss')
    expect(composerKey(ev('Escape'), { ...idle, menu: 'note' })).toBe('menu-dismiss')
  })

  it('leaves the arrows, Tab and Enter to the box when the menu only has a note', () => {
    const note: KeyState = { ...idle, menu: 'note' }
    expect(composerKey(ev('ArrowDown'), note)).toBeNull()
    expect(composerKey(ev('Tab'), note)).toBeNull()
    expect(composerKey(ev('Enter'), note)).toBe('send')
  })

  it('does not stop a turn with the Escape that closed a menu', () => {
    expect(composerKey(ev('Escape'), { ...listed, running: true })).toBe('menu-dismiss')
  })
})

describe('stopping a turn', () => {
  it('stops on Escape or Ctrl+. while a turn runs and no menu is open', () => {
    const running: KeyState = { ...idle, running: true }
    expect(composerKey(ev('Escape'), running)).toBe('stop')
    expect(composerKey(ev('.', { ctrlKey: true }), running)).toBe('stop')
    expect(composerKey(ev('.', { metaKey: true }), running)).toBe('stop')
  })

  it('leaves them alone when nothing runs', () => {
    expect(composerKey(ev('Escape'), idle)).toBeNull()
    expect(composerKey(ev('.', { ctrlKey: true }), idle)).toBeNull()
  })
})

describe('deleting', () => {
  it('asks to check for a mention on a bare Backspace or Delete only', () => {
    expect(composerKey(ev('Backspace'), idle)).toBe('delete-back')
    expect(composerKey(ev('Delete'), idle)).toBe('delete-forward')
    expect(composerKey(ev('Backspace', { ctrlKey: true }), idle)).toBeNull()
    expect(composerKey(ev('Backspace', { shiftKey: true }), idle)).toBeNull()
  })
})
