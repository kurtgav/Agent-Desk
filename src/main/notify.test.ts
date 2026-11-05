import { describe, expect, it } from 'vitest'
import type { AttentionItem } from '@shared/snapshot'
import { badgeCount, badgeIcon, inQuietHours, newItems, notifyPrefs, shouldToast, toastText, tomorrowMorning, trayIcon, trayTooltip } from './notify'

const item = (o: Partial<AttentionItem> = {}): AttentionItem => ({
  id: 'i1', priority: 1, kind: 'approval', sessionId: 's1', title: 'Run `npm test`', toolName: 'Bash', hint: null,
  riskFlags: [], held: false, openedAt: 0, ...o
})
const NOON = new Date(2026, 10, 5, 12, 0)
const defaults = notifyPrefs({})

describe('notifyPrefs', () => {
  it('defaults to everything on, unpaused, no quiet hours', () => {
    expect(defaults).toEqual({
      pausedUntil: null, completions: true, quietHours: null,
      kinds: { approval: true, question: true, failed: true, stuck: true, review: true }
    })
  })

  it('reads valid values and ignores hand-edited junk', () => {
    const p = notifyPrefs({ notifications: { pausedUntil: 5, completions: false, kinds: { review: false }, quietHours: { from: 1320, to: 420 } } })
    expect(p).toMatchObject({ pausedUntil: 5, completions: false, quietHours: { from: 1320, to: 420 } })
    expect(p.kinds.review).toBe(false)
    expect(notifyPrefs({ notifications: { pausedUntil: 'x', quietHours: { from: 2000, to: 1 } } })).toEqual(defaults)
    expect(notifyPrefs({ notifications: 'nope' })).toEqual(defaults)
  })
})

describe('quiet hours', () => {
  it('handles a same-day window and one across midnight', () => {
    const at = (h: number, m = 0) => new Date(2026, 10, 5, h, m)
    expect(inQuietHours({ from: 12 * 60, to: 13 * 60 }, at(12, 30))).toBe(true)
    expect(inQuietHours({ from: 12 * 60, to: 13 * 60 }, at(13))).toBe(false)
    const night = { from: 22 * 60, to: 7 * 60 }
    expect([at(23), at(3), at(6, 59), at(7), at(21, 59)].map((d) => inQuietHours(night, d))).toEqual([true, true, true, false, false])
  })
})

describe('shouldToast (ADR-0013)', () => {
  it('toasts P1 and P2, completions only when on, never P3', () => {
    expect(shouldToast(item(), defaults, NOON, false)).toBe(true)
    expect(shouldToast(item({ priority: 2, kind: 'failed' }), defaults, NOON, false)).toBe(true)
    expect(shouldToast(item({ priority: 3, kind: 'stuck' }), defaults, NOON, false)).toBe(false)
    expect(shouldToast(item({ priority: 4, kind: 'review' }), defaults, NOON, false)).toBe(true)
    expect(shouldToast(item({ priority: 4, kind: 'review' }), { ...defaults, completions: false }, NOON, false)).toBe(false)
  })

  it('stays silent while viewing, paused, in quiet hours, or for a type turned off', () => {
    expect(shouldToast(item(), defaults, NOON, true)).toBe(false)
    expect(shouldToast(item(), { ...defaults, pausedUntil: NOON.getTime() + 1 }, NOON, false)).toBe(false)
    expect(shouldToast(item(), { ...defaults, pausedUntil: NOON.getTime() }, NOON, false)).toBe(true) // pause over
    expect(shouldToast(item(), { ...defaults, quietHours: { from: 0, to: 23 * 60 } }, NOON, false)).toBe(false)
    expect(shouldToast(item(), { ...defaults, kinds: { ...defaults.kinds, approval: false } }, NOON, false)).toBe(false)
  })
})

describe('newItems', () => {
  it('seeds on the first snapshot without toasting what was already open at launch', () => {
    expect(newItems(null, [item()])).toEqual([])
    expect(newItems(new Set(['i1']), [item(), item({ id: 'i2' })]).map((i) => i.id)).toEqual(['i2'])
  })
})

describe('badge and tray', () => {
  it('counts P1 + P2 and caps the badge at 9+', () => {
    const items = [item(), item({ priority: 2 }), item({ priority: 3 }), item({ priority: 4 })]
    expect(badgeCount(items)).toBe(2)
    expect([0, 1, 9, 10].map(badgeIcon)).toEqual([null, 'badge-1', 'badge-9', 'badge-9plus'])
  })

  it('shows hooks missing over paused over needs you (ARCHITECTURE § 7)', () => {
    expect(trayIcon('missing', true, 3)).toBe('tray-failed')
    expect(trayIcon('error', false, 0)).toBe('tray-failed')
    expect(trayIcon('installed', true, 3)).toBe('tray-paused')
    expect(trayIcon('installed', false, 3)).toBe('tray-attention')
    expect(trayIcon(null, false, 0)).toBe('tray') // not known yet (demo, or before the collector is up)
    expect(trayTooltip('tray-attention', 1, 'AgentDeck')).toBe('AgentDeck: 1 needs you')
    expect(trayTooltip('tray-attention', 2, 'AgentDeck')).toBe('AgentDeck: 2 need you')
  })
})

describe('toast text and pause', () => {
  it('names the kind and session, and drops Markdown backticks', () => {
    const s = { name: 'web-app' } as Parameters<typeof toastText>[1]
    expect(toastText(item(), s)).toEqual({ title: 'Needs approval · web-app', body: 'Run npm test' })
    expect(toastText(item({ kind: 'review', priority: 4, title: 'Done' }), undefined)).toEqual({ title: 'Ready for review', body: 'Done' })
  })

  it('toasts are one short plain line: no newlines, control or bidi characters, capped at 120', () => {
    const { body } = toastText(item({ title: 'Run `echo ok\n\n\trm -rf ~ ‮gnp.exe\u0007`' }), undefined)
    expect(body).toBe('Run echo ok rm -rf ~ gnp.exe')
    const long = toastText(item({ title: 'x'.repeat(500) }), undefined).body
    expect(long).toHaveLength(120)
    expect(long.endsWith('…')).toBe(true)
  })

  it('"until tomorrow" is 08:00 on the next day', () => {
    const t = new Date(tomorrowMorning(new Date(2026, 10, 5, 23, 30).getTime()))
    expect([t.getDate(), t.getHours(), t.getMinutes()]).toEqual([6, 8, 0])
  })
})
