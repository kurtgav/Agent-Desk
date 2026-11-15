import { useUi } from '@/store'
import { Button } from '../ui'
import { hooksSummary, remoteSummary } from './integration'
import { Row, Section, Verdict } from './Section'

/**
 * Settings › Integration: where Claude Code's hooks stand, read-only. Installing, updating and the remote-approvals choice
 * (with the exact change to settings.json beside it) stay in the install dialog (D-104), one button away.
 */
export function IntegrationSection() {
  const status = useUi((s) => s.status)
  const demo = useUi((s) => s.snapshot.mode === 'demo')
  const open = useUi((s) => s.setIntegration)

  if (!status) {
    return (
      <Section id="integration" title="Integration" description="How AgentDeck listens to Claude Code.">
        <Row title="Claude Code hooks" help={demo ? 'Demo data is on, so no hooks are used. Turn it off under Third Code to connect Claude Code.' : 'Reading your Claude Code settings…'} />
      </Section>
    )
  }
  const hooks = hooksSummary(status)
  return (
    <Section id="integration" title="Integration" description="How AgentDeck listens to Claude Code.">
      <Row title="Claude Code hooks" help={hooks.detail}>
        <Verdict ok={hooks.ok} okLabel={hooks.label} badLabel={hooks.label} />
      </Row>
      <Row title="Answer permission prompts in AgentDeck" help={remoteSummary(status.remoteApprovals)}>
        <span className="text-[13px] font-medium tabular-nums">{status.remoteApprovals.enabled ? 'On' : 'Off'}</span>
      </Row>
      <Row title="Manage hooks" help="Install, update or remove AgentDeck's entries in your Claude Code settings. You see the exact change before anything is written.">
        <Button size="sm" onClick={() => open('install')}>Manage hooks…</Button>
      </Row>
    </Section>
  )
}
