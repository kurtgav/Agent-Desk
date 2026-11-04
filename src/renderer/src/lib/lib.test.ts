import { describe, expect, it } from 'vitest'
import { Snapshot } from '@shared/snapshot'
import { demoSnapshot } from '../demo/snapshot'
import { avatarFor, HUES, SHAPES } from './avatar'
import { ago, ageWords, dateLabel, duration, timeOfDay, tokens, usd, weekDelta } from './format'
import {
  byPriority, filesChanged, needsOkCount, projectName, recentProjects, recentSessions, running,
  summaryLine, tasksFinished, waiting
} from './selectors'

const MIN = 60_000
const NOW = Date.UTC(2026, 10, 5, 14, 0)

describe('format', () => {
  it('names the time of day', () => {
    expect([4, 5, 11, 12, 17, 18, 23].map(timeOfDay)).toEqual([
      'evening', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening'
    ])
  })
  it('formats the date label', () => {
    expect(dateLabel(NOW, 'en-US', 'UTC')).toBe('Thursday, November 5')
  })
  it('formats durations compactly', () => {
    expect([30_000, 12 * MIN, 60 * MIN, 72 * MIN, 49 * 60 * MIN].map(duration)).toEqual(['<1m', '12m', '1h', '1h 12m', '2d 1h'])
  })
  it('formats recency and ages in words', () => {
    expect([10_000, 2 * MIN, 61 * MIN, 25 * 60 * MIN, 72 * 60 * MIN].map(ago)).toEqual([
      'just now', '2 min ago', '1 hour ago', 'Yesterday', '3 days ago'
    ])
    expect(ageWords(125 * MIN)).toBe('2 hours')
    expect(ageWords(MIN)).toBe('1 minute')
  })
  it('compares against last week in words', () => {
    expect(weekDelta(865 * MIN, 710 * MIN)).toBe('2h 35m more than last week')
    expect(weekDelta(600 * MIN, 640 * MIN)).toBe('40m less than last week')
    expect(weekDelta(10 * MIN, 10 * MIN)).toBe('Same as last week')
    expect(weekDelta(10 * MIN, 0)).toBe('Nothing to compare with last week')
  })
  it('formats money and tokens', () => {
    expect(usd(23.8)).toBe('$23.80')
    expect([940, 812_400, 1_840_000, 12_400_000].map(tokens)).toEqual(['940', '812k', '1.8M', '12M'])
  })
})

describe('avatar', () => {
  it('is deterministic and case-insensitive', () => {
    expect(avatarFor('Explore')).toEqual(avatarFor('explore'))
    expect(SHAPES).toContain(avatarFor('stripe-webhooks').shape)
    expect(HUES).toContain(avatarFor('stripe-webhooks').color as (typeof HUES)[number])
  })
  it('spreads seeds across shapes', () => {
    const shapes = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].map((s) => avatarFor(s).shape))
    expect(shapes.size).toBeGreaterThan(3)
  })
})

describe('demo snapshot', () => {
  const s = demoSnapshot(NOW)

  it('matches the snapshot schema', () => {
    expect(() => Snapshot.parse(s)).not.toThrow()
  })
  it('references only sessions that exist', () => {
    const ids = new Set(s.sessions.map((x) => x.id))
    for (const id of [...s.attention.map((a) => a.sessionId), ...s.files.map((f) => f.sessionId)]) expect(ids).toContain(id)
  })
  it('keeps its states consistent', () => {
    for (const x of s.sessions) expect(x.waitingSince !== null).toBe(x.status === 'needs_you')
    for (const a of s.attention) if (a.held) expect(a.kind).toBe('approval')
    const files = s.files.map((f) => f.changedAt)
    expect(files).toEqual([...files].sort((a, b) => b - a))
  })
})

describe('selectors on the demo', () => {
  const s = demoSnapshot(NOW)

  it('derives the greeting and KPIs from rows', () => {
    expect(needsOkCount(s)).toBe(3)
    expect(summaryLine(s)).toBe('3 things need your OK. Agents finished 6 tasks while you were away.')
    expect(waiting(s)).toEqual({ count: 4, oldestAt: NOW - 125 * MIN })
    expect(tasksFinished(s)).toEqual({ count: 31, whileAway: 6 })
    expect(filesChanged(s)).toEqual({ count: 23, projects: 5 })
  })
  it('orders needs-you by priority, then age', () => {
    expect(byPriority(s.attention).map((a) => a.id)).toEqual([
      'a-portal-question', 'a-booking-env', 'a-billing-push', 'a-invoice-limit', 'a-seo-review'
    ])
  })
  it('lists working sessions before the ones waiting on you', () => {
    expect(running(s).map((x) => x.name)).toEqual(['agentdeck-ui', 'auth-tests', 'portal-migration', 'booking-form', 'stripe-webhooks'])
  })
  it('lists recent sessions and projects', () => {
    expect(recentSessions(s, 3).map((x) => x.name)).toEqual(['agentdeck-ui', 'auth-tests', 'stripe-webhooks'])
    expect(recentProjects(s, 5).map((p) => p.name)).toEqual([
      'agentdeck', 'thirdcode-web', 'billing-api', 'harbor-dental-site', 'northwind-portal'
    ])
  })
})

describe('selectors on edge cases', () => {
  const empty: Snapshot = {
    ...demoSnapshot(NOW), sessions: [], attention: [], files: [], awaySince: null,
    week: { agentTimeMs: 0, agentTimeLastWeekMs: 0, finishedTurns: [] }
  }

  it('reads an empty account honestly', () => {
    expect(summaryLine(empty)).toBe('All quiet.')
    expect(waiting(empty)).toEqual({ count: 0, oldestAt: null })
    expect(filesChanged(empty)).toEqual({ count: 0, projects: 0 })
  })
  it('counts paths case-insensitively (D-013)', () => {
    const s = demoSnapshot(NOW)
    const dup = { ...s, files: [...s.files, { ...s.files[0]!, path: s.files[0]!.path.toUpperCase() }] }
    expect(filesChanged(dup).count).toBe(23)
  })
  it('takes the last path segment for either separator', () => {
    expect(projectName('D:\\personal\\agentdeck\\')).toBe('agentdeck')
    expect(projectName('/home/kurt/site')).toBe('site')
  })
  it('uses the singular when one thing waits', () => {
    const one = { ...empty, attention: demoSnapshot(NOW).attention.slice(0, 1) }
    expect(summaryLine(one)).toBe('1 thing needs your OK.')
  })
})
