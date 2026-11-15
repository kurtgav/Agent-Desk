import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE_NAME, EOD_DEFAULTS, PROFILE_NAME_MAX } from '@shared/work'
import type { AppConfig } from './config'
import { cleanName, configPatch, defaultName, eodSettings, loginItem, nameFromAccount, parsePatch, profileName, readLogsOn, readSettings, wasWritten } from './settings-model'

const FACTS = { fallbackName: 'Alex', hasAvatar: false, openAtLogin: null }
const FOLDER = resolve('reports')

describe('names', () => {
  it('cleans one line, drops control and direction characters, and caps at PROFILE_NAME_MAX characters', () => {
    expect(cleanName('  Kurt \n\t Gavin  ')).toBe('Kurt Gavin')
    expect(cleanName('Ann‮e\u0000')).toBe('Ann e')
    expect(Array.from(cleanName('x'.repeat(100)))).toHaveLength(PROFILE_NAME_MAX)
    expect(Array.from(cleanName('😀'.repeat(60)))).toHaveLength(PROFILE_NAME_MAX)
  })

  it('takes the first word of the OS account, first letter up', () => {
    expect(nameFromAccount('kurt')).toBe('Kurt')
    expect(nameFromAccount('kurt.gavin')).toBe('Kurt')
    expect(nameFromAccount('MSI')).toBe('MSI')
    expect(nameFromAccount('  _ana-maria ')).toBe('Ana')
  })

  it('falls back to the default when the account gives nothing to call someone', () => {
    expect(nameFromAccount(null)).toBe(DEFAULT_PROFILE_NAME)
    expect(nameFromAccount('')).toBe(DEFAULT_PROFILE_NAME)
    expect(nameFromAccount('1234')).toBe(DEFAULT_PROFILE_NAME)
  })

  it('demo data is Kurt (D-014); a real profile starts from the account', () => {
    expect(defaultName('someone', true)).toBe('Kurt')
    expect(defaultName('someone', false)).toBe('Someone')
  })

  it('a saved name wins, a blank or damaged one does not', () => {
    expect(profileName({ profile: { name: ' Sam ' } }, 'Alex')).toBe('Sam')
    expect(profileName({ profile: { name: '   ' } }, 'Alex')).toBe('Alex')
    expect(profileName({ profile: 'Sam' }, 'Alex')).toBe('Alex')
    expect(profileName({}, 'Alex')).toBe('Alex')
  })
})

describe('eodSettings', () => {
  it('defaults each missing or invalid field on its own', () => {
    expect(eodSettings({})).toEqual(EOD_DEFAULTS)
    expect(eodSettings({ eod: { enabled: false, time: '25:00', folder: 'relative/path' } })).toEqual({ ...EOD_DEFAULTS, enabled: false })
    expect(eodSettings({ eod: { time: '07:05', folder: FOLDER } })).toEqual({ enabled: true, time: '07:05', folder: FOLDER })
    expect(eodSettings({ eod: 'nope' })).toEqual(EOD_DEFAULTS)
    expect(eodSettings({ eod: { folder: String.raw`\\nas\share` } }).folder).toBeNull() // local drives only
  })
})

describe('readSettings', () => {
  it('everything on and nothing set by default, with the notifications parser as the single source', () => {
    const s = readSettings({}, FACTS)
    expect(s).toEqual({
      profile: { name: 'Alex', hasAvatar: false },
      eod: EOD_DEFAULTS,
      notifications: { completions: true, kinds: { approval: true, question: true, failed: true, stuck: true, review: true }, quietHours: null },
      startAtLogin: false,
      startMinimized: false,
      theme: 'system',
      usage: { weeklyBudgetUsd: 40, readLogs: false }
    })
  })

  it('reads the theme and the weekly budget, and ignores values that are not valid', () => {
    expect(readSettings({ theme: 'dark', usage: { weeklyBudgetUsd: 75 } }, FACTS)).toMatchObject({ theme: 'dark', usage: { weeklyBudgetUsd: 75 } })
    expect(readSettings({ theme: 'purple', usage: { weeklyBudgetUsd: -3 } }, FACTS)).toMatchObject({ theme: 'system', usage: { weeklyBudgetUsd: 40 } })
    expect(readSettings({ usage: { weeklyBudgetUsd: 1e9 } }, FACTS).usage.weeklyBudgetUsd).toBe(40)
  })

  it('validates a theme or budget patch and keeps the other usage keys', () => {
    expect(() => parsePatch({ theme: 'purple' })).toThrow()
    expect(() => parsePatch({ usage: { weeklyBudgetUsd: 0 } })).toThrow('more than zero')
    expect(configPatch({ usage: { weeklyBudgetUsd: 40, note: 'x' } }, parsePatch({ usage: { weeklyBudgetUsd: 60 }, theme: 'light' }))).toEqual({
      theme: 'light',
      usage: { weeklyBudgetUsd: 60, note: 'x', readLogs: false }
    })
  })

  it('reads token counts only when the switch was turned on explicitly (ADR-0009 amendment)', () => {
    for (const usage of [undefined, {}, { readLogs: false }, { readLogs: 'yes' }, { readLogs: 1 }, { readLogs: null }]) {
      expect(readSettings({ usage }, FACTS).usage.readLogs).toBe(false)
    }
    expect(readSettings({ usage: { readLogs: true } }, FACTS).usage.readLogs).toBe(true)
    expect(readLogsOn({ usage: { readLogs: true } })).toBe(true)
    expect(readLogsOn({})).toBe(false)
  })

  it('saves the switch without touching the budget or other keys, and refuses anything but a boolean', () => {
    expect(parsePatch({ usage: { readLogs: true } })).toEqual({ usage: { readLogs: true } })
    expect(() => parsePatch({ usage: { readLogs: 'yes' } })).toThrow()
    expect(() => parsePatch({ usage: { readLogs: true, extra: 1 } })).toThrow()
    expect(configPatch({ usage: { weeklyBudgetUsd: 75, note: 'x' } }, parsePatch({ usage: { readLogs: true } }))).toEqual({ usage: { weeklyBudgetUsd: 75, note: 'x', readLogs: true } })
    expect(configPatch({ usage: { weeklyBudgetUsd: 75, readLogs: true } }, parsePatch({ usage: { weeklyBudgetUsd: 80 } }))).toEqual({ usage: { weeklyBudgetUsd: 80, readLogs: true } })
  })

  it('reads stored values; the real login item wins over config when packaged', () => {
    const config: AppConfig = {
      profile: { name: 'Sam' },
      notifications: { completions: false, kinds: { stuck: false }, quietHours: { from: 1320, to: 420 }, pausedUntil: 5 },
      startAtLogin: false,
      startMinimized: true
    }
    const s = readSettings(config, { ...FACTS, hasAvatar: true, openAtLogin: true })
    expect(s.profile).toEqual({ name: 'Sam', hasAvatar: true })
    expect(s.notifications).toMatchObject({ completions: false, quietHours: { from: 1320, to: 420 } })
    expect(s.notifications.kinds.stuck).toBe(false)
    expect(s).toMatchObject({ startAtLogin: true, startMinimized: true })
  })
})

describe('parsePatch', () => {
  it('accepts a partial patch and cleans the name', () => {
    expect(parsePatch({ profileName: '  Sam  ' })).toEqual({ profileName: 'Sam' })
    expect(parsePatch({ eod: { time: '09:30' }, startAtLogin: true })).toEqual({ eod: { time: '09:30' }, startAtLogin: true })
    expect(parsePatch({})).toEqual({})
  })

  it.each([
    ['a time that is not HH:mm', { eod: { time: '9:5' } }],
    ['an hour past 23', { eod: { time: '24:00' } }],
    ['a relative folder', { eod: { folder: 'reports' } }],
    ['a network folder', { eod: { folder: String.raw`\\nas\share\reports` } }],
    ['a device path', { eod: { folder: String.raw`\\?\C:\reports` } }],
    ['a non-boolean toggle', { startAtLogin: 'yes' }],
    ['an unknown key', { token: 'x' }],
    ['an unknown notification kind', { notifications: { kinds: { everything: true } } }],
    ['quiet hours that start and end together', { notifications: { quietHours: { from: 60, to: 60 } } }],
    ['quiet hours outside the day', { notifications: { quietHours: { from: 0, to: 1440 } } }],
    ['a name that is not text', { profileName: 7 }]
  ])('refuses %s', (_what, patch) => {
    expect(() => parsePatch(patch)).toThrow()
  })

  it('says what is wrong in a sentence the window can show', () => {
    expect(() => parsePatch({ eod: { time: 'soon' } })).toThrow('The time must look like 18:30.')
  })

  it('takes a folder that is a full path, or null for the default', () => {
    expect(parsePatch({ eod: { folder: FOLDER } })).toEqual({ eod: { folder: FOLDER } })
    expect(parsePatch({ eod: { folder: null } })).toEqual({ eod: { folder: null } })
  })

  it('allows quiet hours to be switched off with null', () => {
    expect(parsePatch({ notifications: { quietHours: null } })).toEqual({ notifications: { quietHours: null } })
  })
})

describe('configPatch', () => {
  const config: AppConfig = {
    token: 'secret',
    profile: { name: 'Sam', mood: 'keep me' },
    eod: { enabled: true, time: '18:00', folder: null, extra: 1 },
    notifications: { completions: true, pausedUntil: 99, kinds: { stuck: false }, quietHours: { from: 60, to: 120 }, other: 'x' }
  }

  it('changes only the keys the patch names and returns whole values for them', () => {
    const out = configPatch(config, parsePatch({ eod: { time: '17:30' } }))
    expect(Object.keys(out)).toEqual(['eod'])
    expect(out.eod).toEqual({ enabled: true, time: '17:30', folder: null, extra: 1 })
  })

  it('keeps pausedUntil, unknown keys and untouched kinds when notifications change', () => {
    const out = configPatch(config, parsePatch({ notifications: { kinds: { review: false }, quietHours: null } }))
    expect(out.notifications).toEqual({
      completions: true, pausedUntil: 99, kinds: { stuck: false, review: false }, quietHours: null, other: 'x'
    })
  })

  it('does not mutate the config it was given', () => {
    const before = JSON.stringify(config)
    configPatch(config, parsePatch({ profileName: 'Al', notifications: { completions: false }, startMinimized: true }))
    expect(JSON.stringify(config)).toBe(before)
  })

  it('an empty name removes the stored one and leaves the rest of the profile', () => {
    expect(configPatch(config, parsePatch({ profileName: '   ' })).profile).toEqual({ mood: 'keep me' })
    expect(configPatch(config, parsePatch({ profileName: 'Al' })).profile).toEqual({ name: 'Al', mood: 'keep me' })
  })

  it('what it writes reads back as what was asked', () => {
    const patch = parsePatch({ profileName: 'Al', eod: { enabled: false, folder: FOLDER }, notifications: { completions: false, quietHours: { from: 1320, to: 420 } }, startAtLogin: true })
    const s = readSettings({ ...config, ...configPatch(config, patch) }, FACTS)
    expect(s).toMatchObject({
      profile: { name: 'Al' },
      eod: { enabled: false, time: '18:00', folder: FOLDER },
      notifications: { completions: false, quietHours: { from: 1320, to: 420 } },
      startAtLogin: true
    })
  })
})

describe('loginItem', () => {
  it('start minimized is the --hidden argument (ADR-0012)', () => {
    expect(loginItem(true, true)).toEqual({ openAtLogin: true, args: ['--hidden'] })
    expect(loginItem(true, false)).toEqual({ openAtLogin: true, args: [] })
    expect(loginItem(false, true)).toEqual({ openAtLogin: false, args: ['--hidden'] })
  })
})

describe('wasWritten', () => {
  it('tells a write that landed from one that was dropped', () => {
    const changes = { eod: { enabled: false, time: '18:00', folder: null } }
    expect(wasWritten(changes, { eod: { enabled: false, time: '18:00', folder: null }, other: 1 })).toBe(true)
    expect(wasWritten(changes, { eod: { enabled: true, time: '18:00', folder: null } })).toBe(false)
    expect(wasWritten(changes, {})).toBe(false)
    expect(wasWritten({}, {})).toBe(true)
  })
})
