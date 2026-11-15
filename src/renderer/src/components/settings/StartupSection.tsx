import { Section } from './Section'
import { SwitchRow } from './Switch'
import type { SettingsApi } from './useSettings'

/** Settings › Startup (ADR-0012): the login item, and whether it opens the window or only the tray. */
export function StartupSection({ api }: { api: SettingsApi }) {
  const { startAtLogin, startMinimized } = api.settings
  return (
    <Section id="startup" title="Startup" description="Whether AgentDeck is already watching when you sit down." saved={api.savedSection === 'startup'} error={api.errors.startup}>
      <SwitchRow
        title="Start AgentDeck when I sign in"
        help="It keeps watching your agents from the tray, so approvals never wait for you to open it."
        checked={startAtLogin}
        onChange={(on) => void api.save('startup', { startAtLogin: on })}
      />
      <SwitchRow
        title="Start minimized to the tray"
        help={startAtLogin ? 'At sign-in the window stays closed until you open it from the tray.' : 'Needs “Start AgentDeck when I sign in”.'}
        checked={startMinimized}
        disabled={!startAtLogin}
        onChange={(on) => void api.save('startup', { startMinimized: on })}
      />
    </Section>
  )
}
