import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AttentionItem } from '@shared/snapshot'
import {
  badgeCount, badgeIcon, dockBadge, inQuietHours, newItems, notifyPrefs, shouldToast, showAndWait, TEST_TOAST, TEST_TOAST_WAIT_MS, testToastResult, toastOptions, toastText,
  tomorrowMorning, trayIcon, trayImage, trayTooltip, type Showable
} from './notify'

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

describe('toast builder', () => {
  const icon = { bot: true } as unknown as Parameters<typeof toastOptions>[1]

  it('carries the bot image, the text, a sound, and nothing to click but the toast itself', () => {
    const o = toastOptions({ title: 'Needs approval · web-app', body: 'Run npm test' }, icon)
    expect(o).toEqual({ title: 'Needs approval · web-app', body: 'Run npm test', icon, silent: false })
    expect(o.icon).toBe(icon)
    expect(o).not.toHaveProperty('actions') // an approval needs a click in the window (ADR-0006)
    expect(o).not.toHaveProperty('toastXml')
  })

  it('shows redacted item text as one short plain line, title and body alike', () => {
    const s = { name: 'web-app' } as Parameters<typeof toastText>[1]
    const o = toastOptions(toastText(item({ title: 'Run `curl -H "Authorization: [redacted]"`\n‮' }), s), icon)
    expect(o.title).toBe('Needs approval · web-app')
    expect(o.body).toBe('Run curl -H "Authorization: [redacted]"')
    const long = toastOptions({ title: 'T'.repeat(300), body: 'x'.repeat(500) }, icon)
    expect([long.title, long.body].map((t) => t?.length)).toEqual([120, 120])
    expect(long.body?.endsWith('…')).toBe(true)
  })

  it('has fixed test text that names what to do', () => {
    expect(TEST_TOAST).toEqual({ title: 'AgentDeck can reach you here', body: 'This is what a notification looks like. Click it to open AgentDeck.' })
  })
})

describe('test notification result', () => {
  it('is ok only when Windows said it showed the toast', () => {
    expect(testToastResult({ kind: 'show' })).toEqual({ ok: true })
  })

  it('says why in plain words otherwise, and where to look', () => {
    const where = 'Windows Settings > System > Notifications'
    for (const e of [{ kind: 'unsupported' }, { kind: 'failed', error: '' }, { kind: 'timeout' }] as const) {
      const r = testToastResult(e, 'win32')
      expect(r.ok).toBe(false)
      expect(r.ok ? '' : r.error).toContain(where)
    }
    expect(testToastResult({ kind: 'timeout' }, 'win32')).toMatchObject({ error: expect.stringContaining('Focus assist or Do not disturb') })
    expect(testToastResult({ kind: 'failed', error: 'E_FAIL\n0x80070005' }, 'win32')).toMatchObject({ error: expect.stringContaining('(E_FAIL 0x80070005)') })
  })

  it("on macOS points at macOS's own settings and Focus, not Windows'", () => {
    const r = testToastResult({ kind: 'timeout' }, 'darwin')
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('System Settings > Notifications') })
    expect(r).toMatchObject({ error: expect.stringContaining('Focus') })
    expect(r.ok ? '' : r.error).not.toMatch(/Windows/)
    expect(testToastResult({ kind: 'show' }, 'darwin')).toEqual({ ok: true })
  })
})

describe('macOS Dock and menu bar', () => {
  it('the Dock badge is the same count the taskbar badge shows, capped at 9+, and empty at zero', () => {
    expect([0, -1, 1, 9, 10, 250].map(dockBadge)).toEqual(['', '', '1', '9', '9+', '9+'])
  })

  it('the plain menu bar icon is the template image macOS tints; status icons keep their colour', () => {
    expect(trayImage('tray', 'darwin')).toBe('trayTemplate')
    expect(trayImage('tray-attention', 'darwin')).toBe('tray-attention')
    expect(trayImage('tray', 'win32')).toBe('tray')
  })
})

describe('showAndWait', () => {
  afterEach(() => vi.useRealTimers())
  const toast = (onShow: (n: EventEmitter) => void): Showable => {
    const n = new EventEmitter()
    return Object.assign(n, { show: () => onShow(n) })
  }

  it('resolves on the show event', async () => {
    await expect(showAndWait(toast((n) => n.emit('show', {})), 50)).resolves.toEqual({ kind: 'show' })
  })

  it('resolves on the failed event with the reason Windows gave', async () => {
    await expect(showAndWait(toast((n) => n.emit('failed', {}, 'denied')), 50)).resolves.toEqual({ kind: 'failed', error: 'denied' })
  })

  it('resolves failed when show itself throws', async () => {
    const t = toast(() => {
      throw new Error('no toast')
    })
    await expect(showAndWait(t, 50)).resolves.toEqual({ kind: 'failed', error: 'no toast' })
  })

  it('gives up after the wait when Windows says nothing', async () => {
    vi.useFakeTimers()
    const result = showAndWait(toast(() => undefined), TEST_TOAST_WAIT_MS)
    await vi.advanceTimersByTimeAsync(TEST_TOAST_WAIT_MS - 1)
    let settled = false
    void result.then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toEqual({ kind: 'timeout' })
  })
})
