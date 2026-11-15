import type { ThemeChoice } from '@shared/work'
import { useUi } from '@/store'
import { Segmented } from '../pages/Page'
import { Row, Section } from './Section'
import type { SettingsApi } from './useSettings'

const OPTIONS: [ThemeChoice, string][] = [
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['system', 'System']
]

/** Settings › Appearance: light, dark, or whichever Windows is set to. The choice applies at once; the top bar's theme button changes the same value. */
export function AppearanceSection({ api }: { api: SettingsApi }) {
  const theme = useUi((s) => s.theme)
  const setTheme = useUi((s) => s.setTheme)

  async function choose(choice: ThemeChoice): Promise<void> {
    const error = await setTheme(choice)
    api.setError('appearance', error)
    if (!error) api.markSaved('appearance')
  }

  return (
    <Section id="appearance" title="Appearance" description="How AgentDeck looks on this PC." saved={api.savedSection === 'appearance'} error={api.errors.appearance}>
      <Row title="Theme" help="System follows your computer's setting and changes when it does.">
        <Segmented<ThemeChoice> label="Theme" value={theme} options={OPTIONS} onChange={(v) => void choose(v)} />
      </Row>
    </Section>
  )
}
