import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { readJson } from './config'
import { defaultBounds, MIN_HEIGHT, MIN_WIDTH, resolveWindowState, type Rect } from './window-state'

const PRIMARY: Rect = { x: 0, y: 0, width: 1920, height: 1040 }
const SECOND: Rect = { x: 1920, y: 0, width: 2560, height: 1400 }
const DEFAULT = { bounds: { x: 240, y: 58, width: 1440, height: 924 }, maximized: false }

describe('defaultBounds', () => {
  test('centres 1440x924 on the primary work area', () => {
    expect(defaultBounds(PRIMARY)).toEqual(DEFAULT.bounds)
  })

  test('clamps to a small work area but never below the minimum size', () => {
    expect(defaultBounds({ x: 0, y: 0, width: 1300, height: 700 })).toEqual({ x: 0, y: 0, width: 1300, height: MIN_HEIGHT })
  })

  test('respects a work area that does not start at 0,0 (taskbar on the left/top)', () => {
    expect(defaultBounds({ x: 60, y: 40, width: 1920, height: 1040 })).toEqual({ x: 300, y: 98, width: 1440, height: 924 })
  })
})

describe('resolveWindowState', () => {
  test('restores a saved rect that is on a current display', () => {
    const saved = { bounds: { x: 2000, y: 100, width: 1500, height: 900 }, maximized: false }
    expect(resolveWindowState(saved, [PRIMARY, SECOND], PRIMARY)).toEqual(saved)
  })

  test('falls back to the default when the saved rect is off every display (monitor unplugged)', () => {
    const saved = { bounds: { x: 2000, y: 100, width: 1500, height: 900 }, maximized: false }
    expect(resolveWindowState(saved, [PRIMARY], PRIMARY)).toEqual(DEFAULT)
  })

  test('falls back when only a sliver of the title bar would be reachable', () => {
    const saved = { bounds: { x: 1880, y: 100, width: 1300, height: 800 }, maximized: false }
    expect(resolveWindowState(saved, [PRIMARY], PRIMARY).bounds).toEqual(DEFAULT.bounds)
  })

  test('falls back when the title bar is above the work area', () => {
    const saved = { bounds: { x: 100, y: -500, width: 1300, height: 800 }, maximized: false }
    expect(resolveWindowState(saved, [PRIMARY], PRIMARY).bounds).toEqual(DEFAULT.bounds)
  })

  test('grows a tiny saved rect to the minimum size', () => {
    const saved = { bounds: { x: 10, y: 10, width: 200, height: 100 }, maximized: false }
    expect(resolveWindowState(saved, [PRIMARY], PRIMARY).bounds).toEqual({ x: 10, y: 10, width: MIN_WIDTH, height: MIN_HEIGHT })
  })

  test('keeps the maximized flag', () => {
    const saved = { bounds: { x: 100, y: 100, width: 1300, height: 800 }, maximized: true }
    expect(resolveWindowState(saved, [PRIMARY], PRIMARY)).toEqual(saved)
  })

  test('keeps the maximized flag even when the bounds fall back', () => {
    const saved = { bounds: { x: 9000, y: 9000, width: 1300, height: 800 }, maximized: true }
    expect(resolveWindowState(saved, [PRIMARY], PRIMARY)).toEqual({ bounds: DEFAULT.bounds, maximized: true })
  })

  test.each([
    ['missing', undefined],
    ['null', null],
    ['array', []],
    ['no bounds', { maximized: true }],
    ['string coordinates', { bounds: { x: '1', y: 0, width: 1300, height: 800 } }],
    ['NaN', { bounds: { x: Number.NaN, y: 0, width: 1300, height: 800 } }],
    ['partial bounds', { bounds: { x: 0, y: 0, width: 1300 } }]
  ])('falls back to the default for %s data', (_label, saved) => {
    expect(resolveWindowState(saved, [PRIMARY], PRIMARY)).toEqual(DEFAULT)
  })
})

describe('window-state.json on disk', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  test('a missing or corrupt file resolves to the default', () => {
    dir = mkdtempSync(join(tmpdir(), 'agentdeck-ws-'))
    const file = join(dir, 'window-state.json')
    expect(resolveWindowState(readJson(file), [PRIMARY], PRIMARY)).toEqual(DEFAULT)
    writeFileSync(file, '{"bounds": {"x": 10,')
    expect(resolveWindowState(readJson(file), [PRIMARY], PRIMARY)).toEqual(DEFAULT)
  })
})
