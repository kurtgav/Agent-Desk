// Light / dark: what the choice resolves to. Shared by main (window colours), the page and tests; no electron or DOM import.
import { THEME_CHOICES, type ThemeChoice } from './work'

export type ResolvedTheme = 'light' | 'dark'

/** The choice, mirrored in localStorage so the page paints the right theme before main answers. public/theme-boot.js reads the same key. */
export const THEME_STORAGE_KEY = 'agentdeck.theme'

/** `system` follows the OS; the other two are what they say. */
export function resolveTheme(choice: ThemeChoice, systemDark: boolean): ResolvedTheme {
  if (choice === 'system') return systemDark ? 'dark' : 'light'
  return choice
}

/** A stored or typed value as a choice, or null when it is none of the three. */
export function parseThemeChoice(value: unknown): ThemeChoice | null {
  return THEME_CHOICES.find((c) => c === value) ?? null
}

/** AGENTDECK_THEME=light|dark: a choice for tests and screenshots that beats the stored one until the person changes the theme. */
export function envThemeSeed(env: Record<string, string | undefined>): ThemeChoice | null {
  const choice = parseThemeChoice(env.AGENTDECK_THEME)
  return choice === 'light' || choice === 'dark' ? choice : null
}
