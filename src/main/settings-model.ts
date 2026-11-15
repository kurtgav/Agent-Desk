// Settings as config.json keeps them: validation, defaults and merging. No electron import: unit-testable.
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { AttentionKind } from '@shared/snapshot'
import {
  DEFAULT_PROFILE_NAME, DEFAULT_WEEKLY_BUDGET_USD, EOD_DEFAULTS, PROFILE_NAME_MAX, THEME_CHOICES, WEEKLY_BUDGET_MAX_USD, type AppSettings, type EodSettings, type ThemeChoice
} from '@shared/work'
import { LOCAL_PATH } from './actions'
import type { AppConfig } from './config'
import { notifyPrefs } from './notify'

/** Sample data speaks for the sample user (D-014); a real profile starts from the OS account instead. */
export const DEMO_NAME = 'Kurt'

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
/** More than the name may hold, so a pasted line is trimmed to fit instead of refused. */
const NAME_INPUT_MAX = 200
const FOLDER_MAX = 1024
/**
 * The report folder is local, as every other folder AgentDeck touches (LOCAL_PATH in actions.ts): on Windows a drive letter and
 * a path, since a network or device path (UNC `\\host\share`, or one starting `\\?\`) could stall the writer for the whole SMB timeout.
 */
export const isLocalFolder = (p: string): boolean => LOCAL_PATH.test(p) && isAbsolute(p)

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** One line, no control or direction characters, at most PROFILE_NAME_MAX characters (not UTF-16 units). */
export function cleanName(raw: string): string {
  const oneLine = raw.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim()
  return Array.from(oneLine).slice(0, PROFILE_NAME_MAX).join('').trim()
}

/** "kurt.gavin" → "Kurt": the first word of the OS account name, first letter up. DEFAULT_PROFILE_NAME when there is none. */
export function nameFromAccount(user: string | null | undefined): string {
  const word = (user ?? '').split(/[\s._-]+/).find((w) => /\p{L}/u.test(w)) ?? ''
  const name = cleanName(word.replace(/[^\p{L}\p{N}]/gu, ''))
  return name ? `${name[0]!.toUpperCase()}${name.slice(1)}` : DEFAULT_PROFILE_NAME
}

export const defaultName = (account: string | null | undefined, demo: boolean): string => (demo ? DEMO_NAME : nameFromAccount(account))

const storedName = (config: AppConfig): string => {
  const n = obj(config.profile).name
  return typeof n === 'string' ? cleanName(n) : ''
}
export const profileName = (config: AppConfig, fallback: string): string => storedName(config) || fallback

/** `config.eod`, each field checked and defaulted: the report scheduler reads the same key. */
export function eodSettings(config: AppConfig): EodSettings {
  const e = obj(config.eod)
  const folder = typeof e.folder === 'string' && e.folder.length <= FOLDER_MAX && isLocalFolder(e.folder) ? e.folder : null
  return {
    enabled: typeof e.enabled === 'boolean' ? e.enabled : EOD_DEFAULTS.enabled,
    time: typeof e.time === 'string' && HHMM.test(e.time) ? e.time : EOD_DEFAULTS.time,
    folder
  }
}

export const themeChoice = (config: AppConfig): ThemeChoice => (THEME_CHOICES.includes(config.theme as ThemeChoice) ? (config.theme as ThemeChoice) : 'system')

/** `config.usage.weeklyBudgetUsd`: a positive number of dollars, or the default. */
export function weeklyBudget(config: AppConfig): number {
  const v = obj(config.usage).weeklyBudgetUsd
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= WEEKLY_BUDGET_MAX_USD ? v : DEFAULT_WEEKLY_BUDGET_USD
}

/** `config.usage.readLogs`: only an explicit `true` turns the log reader on (ADR-0009 amendment). Off for everyone by default. */
export const readLogsOn = (config: AppConfig): boolean => obj(config.usage).readLogs === true

export interface ReadFacts {
  /** What the profile is called when the user never typed a name. */
  fallbackName: string
  hasAvatar: boolean
  /** Windows' own answer when packaged; null in dev, where no login item is ever registered. */
  openAtLogin: boolean | null
}

export function readSettings(config: AppConfig, f: ReadFacts): AppSettings {
  const { completions, kinds, quietHours } = notifyPrefs(config)
  return {
    profile: { name: profileName(config, f.fallbackName), hasAvatar: f.hasAvatar },
    eod: eodSettings(config),
    notifications: { completions, kinds, quietHours },
    startAtLogin: f.openAtLogin ?? config.startAtLogin === true,
    startMinimized: config.startMinimized === true,
    theme: themeChoice(config),
    usage: { weeklyBudgetUsd: weeklyBudget(config), readLogs: readLogsOn(config) }
  }
}

// ---- What the renderer may send ----------------------------------------------------------------------------------

const Minutes = z.number().int().min(0).max(1439)
const Bool = z.boolean()

export const SettingsPatchSchema = z
  .object({
    profileName: z.string().max(NAME_INPUT_MAX, 'That name is too long.').transform(cleanName),
    eod: z
      .object({
        enabled: Bool,
        time: z.string().regex(HHMM, 'The time must look like 18:30.'),
        folder: z
          .string()
          .min(3)
          .max(FOLDER_MAX)
          .refine(isLocalFolder, process.platform === 'win32' ? 'Pick a folder on a local drive, such as C:\\Reports.' : 'Pick a folder on this computer, such as ~/Documents/Reports.')
          .nullable()
      })
      .partial()
      .strict(),
    notifications: z
      .object({
        completions: Bool,
        kinds: z.object(Object.fromEntries(AttentionKind.options.map((k) => [k, Bool]))).partial().strict(),
        quietHours: z
          .object({ from: Minutes, to: Minutes })
          .strict()
          .refine((q) => q.from !== q.to, 'Quiet hours need two different times.')
          .nullable()
      })
      .partial()
      .strict(),
    startAtLogin: Bool,
    startMinimized: Bool,
    theme: z.enum(THEME_CHOICES as [ThemeChoice, ...ThemeChoice[]]),
    usage: z
      .object({
        weeklyBudgetUsd: z.number().positive('The weekly budget must be more than zero.').max(WEEKLY_BUDGET_MAX_USD, 'That budget is too large.'),
        readLogs: Bool
      })
      .partial()
      .strict()
  })
  .partial()
  .strict()
export type ValidPatch = z.infer<typeof SettingsPatchSchema>

/** Throws an Error whose message is a sentence the window can show as it is. */
export function parsePatch(raw: unknown): ValidPatch {
  const r = SettingsPatchSchema.safeParse(raw)
  if (!r.success) throw new Error(r.error.issues[0]?.message ?? 'AgentDeck could not use that setting.')
  return r.data
}

const without = (o: Record<string, unknown>, key: string): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key))

/**
 * The config.json keys `patch` changes, as whole values to hand to `updateConfig`. Fields the patch leaves alone, and keys this
 * version does not know (`notifications.pausedUntil` among them), are carried over from `config`.
 */
export function configPatch(config: AppConfig, patch: ValidPatch): AppConfig {
  const out: AppConfig = {}
  if (patch.profileName !== undefined) {
    const p = obj(config.profile)
    out.profile = patch.profileName ? { ...p, name: patch.profileName } : without(p, 'name') // empty = back to the default
  }
  if (patch.eod) out.eod = { ...obj(config.eod), ...eodSettings(config), ...patch.eod }
  if (patch.notifications) {
    const prev = obj(config.notifications)
    const n = patch.notifications
    out.notifications = {
      ...prev,
      ...(n.completions !== undefined && { completions: n.completions }),
      ...(n.kinds && { kinds: { ...obj(prev.kinds), ...n.kinds } }),
      ...(n.quietHours !== undefined && { quietHours: n.quietHours })
    }
  }
  if (patch.startAtLogin !== undefined) out.startAtLogin = patch.startAtLogin
  if (patch.startMinimized !== undefined) out.startMinimized = patch.startMinimized
  if (patch.theme !== undefined) out.theme = patch.theme
  if (patch.usage) {
    out.usage = {
      ...obj(config.usage),
      weeklyBudgetUsd: patch.usage.weeklyBudgetUsd ?? weeklyBudget(config),
      readLogs: patch.usage.readLogs ?? readLogsOn(config)
    }
  }
  return out
}

/** `updateConfig` drops write failures; this tells whether what `changes` holds is what the file now says. */
export const wasWritten = (changes: AppConfig, stored: AppConfig): boolean =>
  Object.entries(changes).every(([key, value]) => JSON.stringify(stored[key]) === JSON.stringify(value))

/** What `app.setLoginItemSettings` gets (ADR-0012): "start minimized" is the `--hidden` argument. */
export const loginItem = (startAtLogin: boolean, startMinimized: boolean): { openAtLogin: boolean; args: string[] } => ({
  openAtLogin: startAtLogin,
  args: startMinimized ? ['--hidden'] : []
})
