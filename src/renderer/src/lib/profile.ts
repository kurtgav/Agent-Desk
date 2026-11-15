import { DEFAULT_PROFILE_NAME } from '@shared/work'
import { timeOfDay } from './format'

/** Any name reads well: "Good morning, Sam"; with no real name to use (the default stand-in), just "Good morning". */
export function greeting(hour: number, name: string): string {
  const who = name.trim()
  return `Good ${timeOfDay(hour)}${who && who !== DEFAULT_PROFILE_NAME ? `, ${who}` : ''}`
}

/** The letter shown in the circle when there is no photo. */
export function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?'
}
