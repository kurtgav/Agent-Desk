import { describe, expect, it } from 'vitest'
import { envThemeSeed, parseThemeChoice, resolveTheme } from './theme'

describe('resolveTheme', () => {
  it('an explicit choice ignores the OS', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('system follows the OS', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})

describe('parseThemeChoice', () => {
  it('accepts the three choices and nothing else', () => {
    expect(['system', 'light', 'dark'].map(parseThemeChoice)).toEqual(['system', 'light', 'dark'])
    for (const bad of ['Dark', '', 'auto', null, undefined, 1, {}]) expect(parseThemeChoice(bad)).toBeNull()
  })
})

describe('AGENTDECK_THEME', () => {
  it('seeds light or dark only', () => {
    expect(envThemeSeed({ AGENTDECK_THEME: 'dark' })).toBe('dark')
    expect(envThemeSeed({ AGENTDECK_THEME: 'light' })).toBe('light')
    expect(envThemeSeed({ AGENTDECK_THEME: 'system' })).toBeNull()
    expect(envThemeSeed({ AGENTDECK_THEME: 'blue' })).toBeNull()
    expect(envThemeSeed({})).toBeNull()
  })
})
