import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WINDOW_CHROME } from '../../main/window-options'

/** Reads the real stylesheet, so the numbers below are the ones that ship (UI_MAP § Layout tokens, D-142). */
const css = readFileSync(resolve('src/renderer/src/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

function block(opening: RegExp): Record<string, string> {
  const start = css.search(opening)
  if (start < 0) throw new Error(`no block for ${opening}`)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start))
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name!, value!.trim()]))
}

const LIGHT = block(/^:root\s*\{/m)
const DARK = block(/^:root\[data-theme='dark'\]\s*\{/m)
const THEMES = { light: LIGHT, dark: { ...LIGHT, ...DARK } }

// ---- WCAG 2.x relative luminance and contrast ratio ---------------------------------------------------------------

const channel = (c: number): number => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}
const luminance = (hex: string): number => {
  const [r, g, b] = rgb(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}
const over = (fg: string, alpha: number, bg: string): string => {
  const mixed = rgb(fg).map((c, i) => Math.round(c * alpha + rgb(bg)[i]! * (1 - alpha)))
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

const SURFACES = ['ground', 'surface', 'overlay', 'tile', 'well', 'hover', 'active', 'lift']
const TONES = ['working', 'needs', 'failed', 'idle', 'done']

/** [foreground token, background token, minimum ratio]. 4.5 for text, 3 for the marks a control is made of. */
function pairs(): [string, string, number][] {
  const list: [string, string, number][] = []
  for (const bg of SURFACES) list.push(['ink', bg, 4.5], ['muted', bg, 4.5])
  for (const t of TONES) list.push([`${t}-ink`, `${t}-bg`, 4.5], [`${t}-ink`, 'surface', 4.5], [`${t}-ink`, 'ground', 4.5])
  list.push(['tip', 'surface', 1.5], ['on-tip', 'tip', 4.5], ['on-tip', 'failed-solid', 4.5], ['#ffffff', 'accent-fill', 4.5], ['#ffffff', 'accent-fill-hover', 4.5])
  for (const bg of ['ground', 'surface', 'overlay', 'well']) list.push(['focus', bg, 3])
  for (const bg of ['ground', 'surface', 'overlay']) list.push(['accent', bg, 3])
  // The switch: off is the muted grey, on is the ink, the thumb is the surface; each must read against the card and the thumb against both.
  list.push(['muted', 'surface', 3], ['ink', 'surface', 3], ['surface', 'muted', 3], ['surface', 'ink', 3])
  return list
}

const value = (theme: Record<string, string>, token: string): string => (token.startsWith('#') ? token : (theme[token] ?? ''))

describe.each(Object.entries(THEMES))('%s theme contrast (WCAG 2.x AA)', (_name, theme) => {
  it.each(pairs())('%s on %s is at least %d:1', (fg, bg, min) => {
    const [f, b] = [value(theme, fg), value(theme, bg)]
    expect(f, `--${fg}`).toMatch(/^#[0-9a-f]{6}$/i)
    expect(b, `--${bg}`).toMatch(/^#[0-9a-f]{6}$/i)
    expect(contrast(f, b)).toBeGreaterThanOrEqual(min)
  })

  it('selected text keeps 4.5:1 against the selection wash on the ground and on a card', () => {
    const [, hex, percent] = /(#[0-9a-f]{6})\s+(\d+)%/i.exec(theme.selection ?? '') ?? []
    for (const bg of ['ground', 'surface']) {
      expect(contrast(theme.ink!, over(hex!, Number(percent) / 100, theme[bg]!))).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('dark theme', () => {
  const dark = THEMES.dark

  it('defines every token the light theme does, and nothing the light theme lacks', () => {
    expect(Object.keys(DARK).sort()).toEqual(Object.keys(LIGHT).sort())
  })

  it('has no pure black or pure white slab', () => {
    for (const t of [...SURFACES, 'ink', 'muted', 'border', 'rule', 'control', 'track']) expect(dark[t]).not.toMatch(/^#(0{6}|f{6})$/i)
  })

  it('climbs from the ground: each step is lighter than the one below', () => {
    const order = ['ground', 'surface', 'overlay', 'hover', 'active', 'lift']
    const lum = order.map((t) => luminance(dark[t]!))
    expect(lum).toEqual([...lum].sort((a, b) => a - b))
  })

  it('status dots stay visible on their wash and on the card', () => {
    for (const t of TONES) {
      expect(contrast(dark[t]!, dark[`${t}-bg`]!), t).toBeGreaterThanOrEqual(3)
      expect(contrast(dark[t]!, dark.surface!), t).toBeGreaterThanOrEqual(3)
    }
  })

  it('the brand blue is the same family in both themes', () => {
    expect(dark['accent-fill']).toBe(LIGHT['accent-fill'])
  })
})

describe('the window outside the page', () => {
  it.each(['light', 'dark'] as const)('%s: ground, caption strip and symbols are the page tokens', (name) => {
    const theme = THEMES[name]
    const chrome = WINDOW_CHROME[name]
    expect(chrome.background.toLowerCase()).toBe(theme.ground)
    expect(chrome.overlay.color.toLowerCase()).toBe(theme.surface)
    expect(chrome.overlay.symbolColor.toLowerCase()).toBe(theme.ink)
    expect(contrast(chrome.overlay.symbolColor, chrome.overlay.color)).toBeGreaterThanOrEqual(4.5)
  })
})
