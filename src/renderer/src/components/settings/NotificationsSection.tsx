import { useState, type KeyboardEvent } from 'react'
import { Check, TriangleAlert } from 'lucide-react'
import type { PauseChoice } from '@shared/bridge'
import type { AttentionKind } from '@shared/snapshot'
import type { NotificationSettings, SettingsPatch } from '@shared/work'
import { useUi } from '@/store'
import { Button, cn } from '../ui'
import { kindOnly } from './patch'
import { Row, Section, TIME_FIELD } from './Section'
import { SwitchRow } from './Switch'
import { heldBack, testLine, type TestLine } from './testNotification'
import { QUIET_DEFAULT, fromMinutes, toMinutes } from './time'
import { plainError, type SettingsApi } from './useSettings'

const clock = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** The existing pause control (D-067), here too: one hour, until 08:00 tomorrow, or resume. Live mode only. */
function PauseRow() {
  const status = useUi((s) => s.status)
  const now = useUi((s) => s.now)
  if (!status) return null
  const paused = status.pausedUntil !== null && now < status.pausedUntil
  const pause = (c: PauseChoice | null): void => void window.agentdeck?.pauseNotifications(c).catch(() => undefined)
  return (
    <Row
      title={paused ? 'Notifications are paused' : 'Pause notifications'}
      help={paused ? `Until ${clock(status.pausedUntil!)}. The badge count keeps going.` : 'Stops pop-ups for a while. The badge count keeps going.'}
    >
      <div className="flex gap-2">
        {paused && (
          <Button size="sm" variant="primary" onClick={() => pause(null)}>
            Resume now
          </Button>
        )}
        <Button size="sm" onClick={() => pause('hour')}>
          For 1 hour
        </Button>
        <Button size="sm" onClick={() => pause('tomorrow')}>
          Until tomorrow, 08:00
        </Button>
      </div>
    </Row>
  )
}

/** A real pop-up now, with the AgentDeck robot, so the person sees what they look like. Also in demo: it is a test of this PC. */
function TestRow({ quietHours }: { quietHours: NotificationSettings['quietHours'] }) {
  const pausedUntil = useUi((s) => s.status?.pausedUntil ?? null)
  const [busy, setBusy] = useState(false)
  const [line, setLine] = useState<TestLine | null>(null)

  async function send(): Promise<void> {
    const bridge = window.agentdeck
    if (!bridge) return setLine({ tone: 'error', text: 'Test notifications need the AgentDeck window.' })
    setBusy(true)
    setLine(null)
    try {
      setLine(testLine(await bridge.testNotification(), heldBack(new Date(), pausedUntil, quietHours)))
    } catch (e) {
      setLine({ tone: 'error', text: plainError(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Row title="Try a notification" help="Shows a real pop-up now, with the AgentDeck robot. Click it to open AgentDeck.">
        <Button size="sm" onClick={() => void send()} disabled={busy}>
          {busy ? 'Sending…' : 'Send a test notification'}
        </Button>
      </Row>
      <div aria-live="polite">
        {line && (
          <p className={cn('-mt-1.5 flex items-start gap-2 px-4 pb-3.5 text-[13px] leading-5', line.tone === 'ok' ? 'text-[var(--done-ink)]' : 'text-[var(--failed-ink)]')}>
            {line.tone === 'ok' ? <Check size={15} strokeWidth={2} aria-hidden className="mt-[3px] flex-none" /> : <TriangleAlert size={15} strokeWidth={2} aria-hidden className="mt-[3px] flex-none" />}
            <span className="min-w-0 text-pretty">{line.text}</span>
          </p>
        )}
      </div>
    </>
  )
}

/** Settings › Notifications (D-065, ADR-0013): which things pop up, when they may not, a pause, and a test. */
export function NotificationsSection({ api }: { api: SettingsApi }) {
  const n = api.settings.notifications
  const { quietHours } = n
  const [timeError, setTimeError] = useState<string | null>(null)
  const save = (patch: NonNullable<SettingsPatch['notifications']>): Promise<boolean> => api.save('notifications', { notifications: patch })
  const kind = (k: AttentionKind) => ({ checked: n.kinds[k], onChange: (on: boolean) => void save({ kinds: kindOnly(k, on) }) })

  function leave(which: 'from' | 'to', input: HTMLInputElement): void {
    const minutes = toMinutes(input.value)
    const current = quietHours?.[which]
    if (minutes === null || !quietHours || minutes === current) {
      if (quietHours) input.value = fromMinutes(quietHours[which])
      return
    }
    const next = { ...quietHours, [which]: minutes }
    if (next.from === next.to) {
      setTimeError('Pick two different times.')
      input.value = fromMinutes(quietHours[which])
      return
    }
    setTimeError(null)
    void save({ quietHours: next })
  }

  function keys(which: 'from' | 'to', e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') e.currentTarget.blur()
    if (e.key === 'Escape' && quietHours) {
      e.currentTarget.value = fromMinutes(quietHours[which])
      e.currentTarget.blur()
    }
  }

  return (
    <Section id="notifications" title="Notifications" description="Which things pop up, and when they may not." saved={api.savedSection === 'notifications'} error={api.errors.notifications ?? timeError}>
      <SwitchRow title="When a session needs your approval" help="A permission prompt is waiting for you." {...kind('approval')} />
      <SwitchRow title="When a session asks you a question" help="A session needs an answer before it can go on." {...kind('question')} />
      <SwitchRow title="When a session fails or hits a limit" help="It stopped on an error, or your usage limit was reached." {...kind('failed')} />
      <SwitchRow
        title="When a session finishes"
        help="It is ready for you to review. Sessions that may be stuck never pop up; they wait in Needs you."
        checked={n.completions && n.kinds.review}
        onChange={(on) => void save({ completions: on, kinds: kindOnly('review', on) })}
      />
      <SwitchRow
        title="Quiet hours"
        help="No pop-ups between the two times. Anything that needs you still waits in Needs you."
        checked={quietHours !== null}
        onChange={(on) => {
          setTimeError(null)
          void save({ quietHours: on ? { ...QUIET_DEFAULT } : null })
        }}
      />
      {quietHours && (
        <Row title="Quiet between" help="Across midnight is fine: 22:00 to 07:00 is overnight.">
          <div role="group" aria-label="Quiet hours" className="flex items-center gap-2">
            <label htmlFor="quiet-from" className="text-[13px] text-muted">
              From
            </label>
            <input
              id="quiet-from"
              key={quietHours.from}
              type="time"
              defaultValue={fromMinutes(quietHours.from)}
              onBlur={(e) => leave('from', e.currentTarget)}
              onKeyDown={(e) => keys('from', e)}
              className={TIME_FIELD}
            />
            <label htmlFor="quiet-to" className="text-[13px] text-muted">
              until
            </label>
            <input
              id="quiet-to"
              key={quietHours.to}
              type="time"
              defaultValue={fromMinutes(quietHours.to)}
              onBlur={(e) => leave('to', e.currentTarget)}
              onKeyDown={(e) => keys('to', e)}
              className={TIME_FIELD}
            />
          </div>
        </Row>
      )}
      <PauseRow />
      <TestRow quietHours={quietHours} />
    </Section>
  )
}
