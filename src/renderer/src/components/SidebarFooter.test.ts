import { createElement } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Snapshot, type PlanLimits } from '@shared/snapshot'
import { demoSnapshot } from '@/demo/snapshot'
import { resetTime } from '@/lib/claudeLink'
import { useUi } from '@/store'
import { SidebarFooter } from './SidebarFooter'

const NOW = Date.UTC(2026, 10, 15, 12, 30)
const MIN = 60_000

beforeEach(() => vi.stubGlobal('window', {}))
afterEach(() => vi.unstubAllGlobals())

/** The footer as the window would show it, React's text separators taken out. */
function render(planLimits: PlanLimits | null | undefined): string {
  const snapshot = { ...demoSnapshot(NOW), planLimits }
  useUi.setState({ snapshot, now: NOW, link: 'up' })
  Object.assign(useUi.getInitialState(), useUi.getState())
  return renderToString(createElement(Tooltip.Provider, null, createElement(SidebarFooter, { onCollapse: () => undefined }))).replaceAll('<!-- -->', '')
}

const session = { usedPct: 16, resetsAt: NOW + 100 * MIN }
const week = { usedPct: 23.4, resetsAt: NOW + 4 * 1440 * MIN }

describe('the sidebar usage block (D-172)', () => {
  it("shows the plan's session and week with meters and reset times, the dollar estimate only in the tooltip", () => {
    const html = render({ session, week, at: NOW - MIN })
    expect(html).toContain('Session 16%')
    expect(html).toContain(`resets ${resetTime(session.resetsAt)}`)
    expect(html).toContain('Week 23%')
    expect(html).toContain(`resets ${resetTime(week.resetsAt, true)}`)
    expect(html.match(/role="meter"/g)).toHaveLength(2)
    expect(html).toContain('aria-label="Session limit used"')
    expect(html).toContain('aria-valuenow="23"')
    expect(html).toMatch(/title="[^"]*\$23\.80 of \$40\.00 this week \(API-equivalent estimate\)"/)
    expect(html).not.toContain('Weekly budget used')
    expect(html).not.toContain('as of')
  })

  it('says when the figures are from, once they are over ten minutes old', () => {
    const at = NOW - 11 * MIN
    expect(render({ session, week, at })).toContain(`as of ${resetTime(at)}`)
  })

  it('shows a window alone when Claude Code passed only that one', () => {
    const html = render({ session: null, week, at: NOW })
    expect(html).not.toContain('Session')
    expect(html.match(/role="meter"/g)).toHaveLength(1)
  })

  it('falls back to the estimate as before without plan limits', () => {
    for (const none of [null, undefined, { session: null, week: null, at: NOW }]) {
      const html = render(none)
      expect(html).toContain('of $40.00 this week')
      expect(html).toContain('aria-label="Weekly budget used"')
      expect(html).not.toContain('Session')
    }
  })
})

describe('Snapshot schema with plan limits', () => {
  it('still parses a snapshot from before plan limits, and one with them', () => {
    const { planLimits, ...old } = demoSnapshot(NOW)
    expect(Snapshot.safeParse(old).success).toBe(true)
    expect(Snapshot.safeParse({ ...old, planLimits: null }).success).toBe(true)
    expect(Snapshot.parse({ ...old, planLimits }).planLimits?.session?.usedPct).toBe(16)
    expect(Snapshot.safeParse({ ...old, planLimits: { session: { usedPct: 120, resetsAt: NOW }, week: null, at: NOW } }).success).toBe(false)
  })

  it('the demo resets its week on a Friday at 1 PM, after now', () => {
    const w = demoSnapshot(NOW).planLimits?.week
    const d = new Date(w!.resetsAt)
    expect([d.getDay(), d.getHours(), d.getMinutes()]).toEqual([5, 13, 0])
    expect(w!.resetsAt - NOW).toBeGreaterThan(0)
    expect(w!.resetsAt - NOW).toBeLessThanOrEqual(7 * 1440 * MIN)
  })
})
