import { describe, expect, it } from 'vitest'
import { heldBack, testLine } from './testNotification'

const at = (h: number, m = 0) => new Date(2026, 10, 5, h, m)
const NIGHT = { from: 22 * 60, to: 7 * 60 }

describe('heldBack', () => {
  it('names a running pause, and not one that is over', () => {
    expect(heldBack(at(12), at(12).getTime() + 1, null)).toBe('paused')
    expect(heldBack(at(12), at(12).getTime(), null)).toBeNull()
    expect(heldBack(at(12), null, null)).toBeNull()
  })

  it('names quiet hours, also across midnight', () => {
    expect([at(23), at(3), at(7), at(12)].map((d) => heldBack(d, null, NIGHT))).toEqual(['quiet', 'quiet', null, null])
  })

  it('puts the pause first when both apply', () => {
    expect(heldBack(at(23), at(23).getTime() + 1, NIGHT)).toBe('paused')
  })
})

describe('testLine', () => {
  it('says it was sent, and where to look if it did not appear', () => {
    const line = testLine({ ok: true }, null)
    expect(line.tone).toBe('ok')
    expect(line.text).toMatch(/^Sent\./)
    expect(line.text).toContain('Focus assist or Do not disturb')
  })

  it('adds that the test ignores a pause or quiet hours', () => {
    expect(testLine({ ok: true }, 'paused').text).toContain('This test ignores the pause.')
    expect(testLine({ ok: true }, 'quiet').text).toContain('This test ignores them.')
  })

  it('shows the reason main gave when it failed', () => {
    expect(testLine({ ok: false, error: 'Windows did not show it.' }, 'paused')).toEqual({ tone: 'error', text: 'Windows did not show it.' })
  })
})
