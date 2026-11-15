import { useEffect, useState } from 'react'
import type { CodexHooks } from '@shared/bridge'
import { useUi } from '@/store'
import { CodexDialog, type CodexMode } from '../CodexDialog'
import { Button, Inline } from '../ui'
import { codexSummary, hooksSummary, remoteSummary } from './integration'
import { Row, Section, Verdict } from './Section'

const DESCRIPTION = 'How AgentDeck listens to Claude Code and Codex CLI.'

/** ADR-0014: the Claude Code row's reading, for Codex CLI's hooks.json. Without a Codex folder it says so and offers nothing. */
function CodexRows({ demo, codex, onManage }: { demo: boolean; codex: CodexHooks | null; onManage: (mode: CodexMode) => void }) {
  if (demo || !codex) {
    return <Row title="Codex CLI hooks" help={demo ? 'Demo data is on, so no hooks are used. Turn it off under Third Code to connect Codex CLI.' : 'Reading your Codex CLI hooks…'} />
  }
  const hooks = codexSummary(codex)
  if (codex.state === 'absent') {
    return (
      <Row title="Codex CLI hooks" help={<span className="break-words"><Inline text={hooks.detail} /></span>}>
        <span className="text-[13px] text-muted">{hooks.label}</span>
      </Row>
    )
  }
  const installed = codex.state === 'installed'
  const help = installed ? (
    <>
      {hooks.detail}
      <span className="mt-0.5 block">
        <Inline text="Codex runs new hooks only after you trust them: open Codex and type `/hooks`." />
      </span>
    </>
  ) : (
    hooks.detail
  )
  return (
    <>
      <Row title="Codex CLI hooks" help={help}>
        <Verdict ok={hooks.ok} okLabel={hooks.label} badLabel={hooks.label} />
      </Row>
      <Row title="Manage Codex CLI hooks" help="Install or remove AgentDeck's entries in your Codex CLI hooks.json. You see the exact change before anything is written.">
        <Button size="sm" onClick={() => onManage(installed ? 'uninstall' : 'install')}>
          {installed ? 'Remove hooks…' : 'Install hooks…'}
        </Button>
      </Row>
    </>
  )
}

/**
 * Settings › Integration: where Claude Code's and Codex CLI's hooks stand. Claude Code's install, update and remote-approvals
 * choice (with the exact change to settings.json beside it) stay in the install dialog (D-104), one button away; Codex's in
 * its own dialog, with the change to hooks.json.
 */
export function IntegrationSection() {
  const status = useUi((s) => s.status)
  const demo = useUi((s) => s.snapshot.mode === 'demo')
  const open = useUi((s) => s.setIntegration)
  const [codex, setCodex] = useState<CodexHooks | null>(null)
  const [codexDialog, setCodexDialog] = useState<CodexMode | null>(null)
  // Bumped after the dialog wrote, so the row reads the file again.
  const [codexWrites, setCodexWrites] = useState(0)

  // Read when shown and whenever the window comes back (hooks.json may have been edited); never in demo (ADR-0011).
  useEffect(() => {
    const bridge = window.agentdeck
    if (demo || !bridge) return
    let current = true
    const read = (): void =>
      void bridge.getCodexHooks().then(
        (c) => current && setCodex(c),
        // A failed read shows as the row's error, never as "Reading…" forever.
        () => current && setCodex({ state: 'error', error: null, home: '' })
      )
    read()
    window.addEventListener('focus', read)
    return () => {
      current = false
      window.removeEventListener('focus', read)
    }
  }, [demo, codexWrites])

  const codexRows = <CodexRows demo={demo} codex={codex} onManage={setCodexDialog} />
  const dialog = <CodexDialog mode={codexDialog} onClose={() => setCodexDialog(null)} onDone={() => setCodexWrites((n) => n + 1)} />

  if (!status) {
    return (
      <Section id="integration" title="Integration" description={DESCRIPTION}>
        <Row title="Claude Code hooks" help={demo ? 'Demo data is on, so no hooks are used. Turn it off under Third Code to connect Claude Code.' : 'Reading your Claude Code settings…'} />
        {codexRows}
        {dialog}
      </Section>
    )
  }
  const hooks = hooksSummary(status)
  return (
    <Section id="integration" title="Integration" description={DESCRIPTION}>
      <Row title="Claude Code hooks" help={hooks.detail}>
        <Verdict ok={hooks.ok} okLabel={hooks.label} badLabel={hooks.label} />
      </Row>
      <Row title="Answer permission prompts in AgentDeck" help={remoteSummary(status.remoteApprovals)}>
        <span className="text-[13px] font-medium tabular-nums">{status.remoteApprovals.enabled ? 'On' : 'Off'}</span>
      </Row>
      <Row title="Manage hooks" help="Install, update or remove AgentDeck's entries in your Claude Code settings. You see the exact change before anything is written.">
        <Button size="sm" onClick={() => open('install')}>Manage hooks…</Button>
      </Row>
      {codexRows}
      {dialog}
    </Section>
  )
}
