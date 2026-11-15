import { describe, expect, it } from 'vitest'
import type { Usage } from '@shared/snapshot'
import type { ClaudeLink } from '@shared/work'
import { blockText, cliProblem, figureAge, logsStatus, modelLabel, parseBudget, signInSummary, usageHelp, usageState } from './claudeLink'

const link = (over: Partial<ClaudeLink> = {}): ClaudeLink => ({
  cli: { found: true, path: 'C:\\bin\\claude.exe', version: '2.1.323' },
  signIn: 'subscription',
  plan: 'Max',
  usage: { enabled: false, receiving: false, readLogs: false },
  ...over
})
const USAGE: Usage = { todayTokens: 1, weekTokens: 2, todayCostUsd: 0.5, weekCostUsd: 1, weeklyBudgetUsd: 40 }

describe('cliProblem (the composer)', () => {
  it('says nothing while it does not know, or when all is well', () => {
    expect(cliProblem(null)).toBeNull()
    expect(cliProblem(link())).toBeNull()
    expect(cliProblem(link({ signIn: 'api-key' }))).toBeNull()
    expect(cliProblem(link({ signIn: 'unknown' }))).toBeNull() // an older CLI can't say; a send may still work
  })

  it('names the fix for a missing CLI and for a signed-out one', () => {
    expect(cliProblem(link({ cli: { found: false, path: null, version: null }, signIn: 'unknown' }))?.text).toMatch(/Install it/)
    expect(cliProblem(link({ signIn: 'signed-out' }))?.text).toContain('Run `claude` once in a terminal and sign in')
  })
})

describe('signInSummary (Settings)', () => {
  it('says what runs on what, in plain words', () => {
    expect(signInSummary(link())).toEqual({ tone: 'ok', text: 'Signed in with your Claude subscription (Max). Sessions you start from AgentDeck run on it.' })
    expect(signInSummary(link({ plan: null })).text).toBe('Signed in with your Claude subscription. Sessions you start from AgentDeck run on it.')
    expect(signInSummary(link({ signIn: 'api-key', plan: null })).text).toMatch(/billed to that key/)
  })

  it('points the way out of signed out, and does not claim what it cannot tell', () => {
    expect(signInSummary(link({ signIn: 'signed-out' }))).toMatchObject({ tone: 'bad', text: expect.stringContaining('Run `claude` once') })
    expect(signInSummary(link({ signIn: 'unknown' }))).toMatchObject({ tone: 'unknown' })
    expect(signInSummary(link({ cli: { found: false, path: null, version: null } })).tone).toBe('unknown')
  })

  it('never carries an email, an organisation or an id (the link has none to carry)', () => {
    expect(JSON.stringify(signInSummary(link()))).not.toMatch(/@|org|uuid/i)
  })
})

describe('usageState (the sidebar)', () => {
  it('shows figures whenever there are some, even with telemetry since turned off', () => {
    expect(usageState(USAGE, null)).toBe('figures')
    expect(usageState(USAGE, link())).toBe('figures')
  })

  it('reads the logs, and says so, instead of asking for a new session, whenever reading is on', () => {
    const on = link({ usage: { enabled: true, receiving: false, readLogs: true } })
    expect(usageState(null, on)).toBe('reading') // switched on, first snapshot not here yet
    expect(usageState({ ...USAGE, source: 'logs', logs: { files: 280, lastAt: null, scan: { done: 3, total: 280 } } }, on)).toBe('reading')
    expect(usageState({ ...USAGE, source: 'logs', logs: { files: 280, lastAt: 1, scan: null } }, on)).toBe('figures') // zero or more: a figure
    expect(usageState({ ...USAGE, todayTokens: 0, weekTokens: 0, source: 'logs', logs: { files: 0, lastAt: null, scan: null } }, on)).toBe('figures')
  })

  it('offers the switch when off, waits when on, and stays neutral until main has answered', () => {
    expect(usageState(null, link())).toBe('off')
    expect(usageState(null, link({ usage: { enabled: true, receiving: false, readLogs: false } }))).toBe('waiting')
    expect(usageState(null, null)).toBe('unknown')
  })
})

describe('parseBudget', () => {
  it('takes dollars the way people type them, to the cent', () => {
    expect(parseBudget('40')).toBe(40)
    expect(parseBudget(' $1,200.5 ')).toBe(1200.5)
    expect(parseBudget('12.345')).toBe(12.35)
  })

  it('refuses zero, negatives, words and anything past the limit', () => {
    for (const bad of ['', '0', '-5', 'lots', 'NaN', '0.001', '100000.01', '1e9']) expect(parseBudget(bad)).toBeNull()
    expect(parseBudget('100000')).toBe(100_000)
  })
})

describe('usageHelp', () => {
  it('tells off, waiting and receiving apart', () => {
    expect(usageHelp({ enabled: false, receiving: false, readLogs: false })).toMatch(/^Off/)
    expect(usageHelp({ enabled: true, receiving: false, readLogs: false })).toMatch(/sessions already open will not report/)
    expect(usageHelp({ enabled: true, receiving: true, readLogs: false })).toMatch(/^On\. Figures arrived in the last day/)
  })
})

describe('the live line and labels', () => {
  it('names a model the way people say it', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelLabel('claude-sonnet-5')).toBe('Sonnet 5')
    expect(modelLabel('claude-haiku-5-5-20260101')).toBe('Haiku 5.5')
    expect(modelLabel('something-else')).toBe('something-else')
  })

  it('counts a figure’s age in seconds first', () => {
    expect(figureAge(12_400)).toBe('12 s ago')
    expect(figureAge(0)).toBe('0 s ago')
    expect(figureAge(5 * 60_000)).toBe('5 min ago')
  })

  it('says how far the first pass is, then how many files and how fresh', () => {
    expect(logsStatus({ files: 3, lastAt: null, scan: { done: 120, total: 280 } }, 0)).toBe('Reading your logs: 120 of 280 files.')
    expect(logsStatus({ files: 214, lastAt: 88_000, scan: null }, 100_000)).toBe('Reading 214 log files, last figure 12 s ago.')
    expect(logsStatus({ files: 1, lastAt: null, scan: null }, 0)).toBe('Reading 1 log file. No figure yet.')
  })

  it('writes the block as one honest sentence', () => {
    const t = blockText({ startedAt: Date.UTC(2026, 10, 13, 9), endsAt: Date.UTC(2026, 10, 13, 14), tokens: 66_878_321 })
    expect(t).toMatch(/^67M tokens since \d\d?:\d\d.*; the window ends about \d\d?:\d\d.*\.$/)
  })
})
