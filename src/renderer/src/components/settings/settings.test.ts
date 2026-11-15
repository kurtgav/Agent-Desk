import { describe, expect, it } from 'vitest'
import type { AppStatus } from '@shared/bridge'
import type { AppSettings, Diagnostics } from '@shared/work'
import { greeting, initialOf } from '@/lib/profile'
import { codexSummary, hooksSummary, remoteSummary } from './integration'
import { applyPatch, kindOnly } from './patch'
import { diagnosticsReport, formatBytes, homesIn, redact } from './report'
import { fromMinutes, toMinutes } from './time'

describe('greeting', () => {
  it('names the person when there is a name to use', () => {
    expect(greeting(9, 'Sam')).toBe('Good morning, Sam')
    expect(greeting(14, ' Ana María ')).toBe('Good afternoon, Ana María')
    expect(greeting(21, '山田')).toBe('Good evening, 山田')
  })

  it('reads on its own when the name is the stand-in or empty', () => {
    expect(greeting(9, 'You')).toBe('Good morning')
    expect(greeting(9, '   ')).toBe('Good morning')
  })
})

describe('initialOf', () => {
  it('is the first letter, whole code points included', () => {
    expect(initialOf('sam')).toBe('S')
    expect(initialOf('  élodie')).toBe('É')
    expect(initialOf('😀 party')).toBe('😀')
    expect(initialOf('')).toBe('?')
  })
})

describe('time', () => {
  it('converts HH:mm to minutes after midnight and back', () => {
    expect(toMinutes('00:00')).toBe(0)
    expect(toMinutes('22:30')).toBe(1350)
    expect(toMinutes('23:59')).toBe(1439)
    expect(fromMinutes(1350)).toBe('22:30')
    expect(fromMinutes(7 * 60)).toBe('07:00')
    expect(fromMinutes(toMinutes('06:05')!)).toBe('06:05')
  })

  it('refuses what a time field never holds', () => {
    expect(toMinutes('')).toBeNull()
    expect(toMinutes('24:00')).toBeNull()
    expect(toMinutes('7:00')).toBeNull()
  })
})

const DIAG: Diagnostics = {
  version: '0.1.0',
  electron: '45.2.2',
  node: '24.1.0',
  os: 'Windows 11 Pro (10.0.26100, x64)',
  userData: 'C:\\Users\\Kurt\\AppData\\Roaming\\AgentDeck',
  dbPath: 'C:\\Users\\Kurt\\AppData\\Roaming\\AgentDeck\\agentdeck.db',
  dbBytes: 1_572_864,
  collector: 'up',
  port: 47821,
  hooks: 'installed',
  claudePath: 'C:\\Users\\Kurt\\.local\\bin\\claude.exe',
  claudeVersion: '2.1.318',
  startedAt: Date.UTC(2026, 10, 13, 9, 30),
  checks: [
    { id: 'collector', label: 'Collector running', ok: true, detail: 'AgentDeck is receiving session events.' },
    { id: 'report-folder', label: 'Daily report folder writable', ok: false, detail: 'C:\\Users\\Kurt\\Documents\\Reports: Windows does not let AgentDeck write there.' }
  ]
}

describe('redact', () => {
  it('replaces the home folder with ~, with either slash and any case', () => {
    expect(redact('C:\\Users\\Kurt\\x and c:/users/kurt/y', ['C:\\Users\\Kurt'])).toBe('~\\x and ~/y')
  })

  it('does not choke on regex characters in a folder name', () => {
    expect(redact('D:\\Home (old)+\\a', ['D:\\Home (old)+'])).toBe('~\\a')
  })

  it('hides anything shaped like the 64-digit token', () => {
    const token = 'a1'.repeat(32)
    expect(redact(`x-agentdeck-token: ${token}.`, [])).toBe('x-agentdeck-token: [hidden].')
    expect(redact('abc123', [])).toBe('abc123')
  })
})

describe('homesIn', () => {
  it('finds C:\\Users\\<name> and the folder before AppData, longest first', () => {
    expect(homesIn([DIAG.userData, DIAG.claudePath])).toEqual(['C:\\Users\\Kurt'])
    expect(homesIn(['D:\\Profiles\\kurt\\AppData\\Roaming\\AgentDeck', null])).toEqual(['D:\\Profiles\\kurt'])
  })
})

describe('diagnosticsReport', () => {
  const text = diagnosticsReport(DIAG)

  it('is plain text with the facts and every check, ok or not', () => {
    expect(text).toContain('Version: 0.1.0 (Electron 45.2.2, Node 24.1.0)')
    expect(text).toContain('Collector: running, port 47821')
    expect(text).toContain('Claude Code: 2.1.318 at ~\\.local\\bin\\claude.exe')
    expect(text).toContain('Database: ~\\AppData\\Roaming\\AgentDeck\\agentdeck.db (1.5 MB)')
    expect(text).toContain('[ok] Collector running: AgentDeck is receiving session events.')
    expect(text).toContain('[needs attention] Daily report folder writable: ~\\Documents\\Reports:')
    expect(text).toContain('Started: 2026-11-13 09:30 UTC')
  })

  it('never carries the home folder or the user name', () => {
    expect(text).not.toMatch(/Kurt/i)
    expect(text).not.toContain('C:\\Users')
  })
})

describe('formatBytes', () => {
  it('reads in B, KB and MB, and says so when there is no file', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(null)).toBe('not created yet')
  })
})

describe('Integration summary', () => {
  const base: AppStatus = { hooks: 'installed', hooksError: null, conflicts: [], pausedUntil: null, remoteApprovals: { enabled: false, waitSec: 60 } }

  it('says connected only when the entries are there and nothing blocks them', () => {
    expect(hooksSummary(base)).toMatchObject({ ok: true, label: 'Live' })
    expect(hooksSummary({ ...base, hooks: 'missing' })).toMatchObject({ ok: false, label: 'Hooks missing' })
    // D-068: a conflict is Hooks missing, as on the Live chip.
    expect(hooksSummary({ ...base, conflicts: ['disableAllHooks is true.'] })).toEqual({ ok: false, label: 'Hooks missing', detail: 'disableAllHooks is true.' })
    expect(hooksSummary({ ...base, hooks: 'error', hooksError: 'Could not read x.' })).toMatchObject({ ok: false, detail: 'Could not read x.' })
  })

  it('reads Codex CLI hooks in the same words, and names the missing folder plainly', () => {
    const home = 'C:\\Users\\dev\\.codex'
    expect(codexSummary({ state: 'installed', error: null, home })).toMatchObject({ ok: true, label: 'Installed' })
    expect(codexSummary({ state: 'missing', error: null, home })).toMatchObject({ ok: false, label: 'Hooks missing' })
    expect(codexSummary({ state: 'error', error: 'hooks.json is not valid JSON (line 1, column 3)', home })).toMatchObject({ ok: false, detail: expect.stringContaining('not valid JSON') })
    expect(codexSummary({ state: 'absent', error: null, home })).toEqual({ ok: false, label: 'Not found', detail: `AgentDeck found no Codex CLI folder at \`${home}\`.` })
    // A read that failed in the bridge reads as the error row, in the same words.
    expect(codexSummary({ state: 'error', error: null, home: '' }).detail).toBe("AgentDeck can't read your Codex CLI hooks.json.")
  })

  it('states the remote-approvals wait, or that the terminal asks as usual', () => {
    expect(remoteSummary({ enabled: true, waitSec: 90 })).toContain('90 s')
    expect(remoteSummary({ enabled: false, waitSec: 60 })).toMatch(/^Off\./)
  })
})

describe('applyPatch', () => {
  const s: AppSettings = {
    profile: { name: 'Sam', hasAvatar: false },
    eod: { enabled: true, time: '18:00', folder: null },
    notifications: { completions: true, kinds: { approval: true, question: true, failed: true, stuck: false, review: true }, quietHours: null },
    startAtLogin: false,
    startMinimized: false,
    theme: 'system',
    usage: { weeklyBudgetUsd: 40, readLogs: false }
  }

  it('moves only what the patch names, without touching the settings it was given', () => {
    const before = JSON.stringify(s)
    const next = applyPatch(s, { eod: { time: '17:30' }, startAtLogin: true })
    expect(next).toMatchObject({ eod: { enabled: true, time: '17:30', folder: null }, startAtLogin: true, startMinimized: false })
    expect(next.notifications).toEqual(s.notifications)
    expect(JSON.stringify(s)).toBe(before)
  })

  it('one kind at a time: two quick toggles of different kinds both stick', () => {
    const both = applyPatch(applyPatch(s, { notifications: { kinds: kindOnly('approval', false) } }), { notifications: { kinds: kindOnly('failed', false) } })
    expect(both.notifications.kinds).toEqual({ approval: false, question: true, failed: false, stuck: false, review: true })
  })

  it('quiet hours switch on with a window and off with null; the name waits for main', () => {
    const on = applyPatch(s, { notifications: { quietHours: { from: 1320, to: 420 } } })
    expect(on.notifications.quietHours).toEqual({ from: 1320, to: 420 })
    expect(applyPatch(on, { notifications: { quietHours: null } }).notifications.quietHours).toBeNull()
    expect(applyPatch(s, { profileName: 'Al' }).profile.name).toBe('Sam')
  })
})
