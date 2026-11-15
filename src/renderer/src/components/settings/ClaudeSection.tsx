import { useState, type KeyboardEvent } from 'react'
import { WEEKLY_BUDGET_MAX_USD } from '@shared/work'
import { blockText, logsStatus, modelLabel, parseBudget, refreshClaudeLink, signInSummary, useClaudeLink, usageHelp } from '@/lib/claudeLink'
import { tokens } from '@/lib/format'
import { useUi } from '@/store'
import { UsageDialog, type UsageMode } from '../UsageDialog'
import { Button, Code, Inline, cn } from '../ui'
import { FIELD, Row, Section, Verdict } from './Section'
import { SwitchRow } from './Switch'
import type { SettingsApi } from './useSettings'

const NOT_A_BUDGET = `Enter a weekly budget in dollars: more than zero, and at most $${WEEKLY_BUDGET_MAX_USD.toLocaleString('en-US')}.`

/**
 * Settings › Claude Code (ADR-0007, ADR-0009): where the local CLI stands, whether AgentDeck's sessions run on a subscription,
 * the opt-in that points Claude Code's usage telemetry at AgentDeck, and the weekly budget. It reads no credentials and
 * cannot see the plan's own limits, and says so.
 */
export function ClaudeSection({ api }: { api: SettingsApi }) {
  const link = useClaudeLink()
  const [dialog, setDialog] = useState<UsageMode | null>(null)
  const [checking, setChecking] = useState(false)
  const { weeklyBudgetUsd: budget, readLogs } = api.settings.usage
  const usage = useUi((s) => s.snapshot.usage)
  const now = useUi((s) => s.now)
  const logs = usage?.source === 'logs' ? usage : null
  const sign = link ? signInSummary(link) : null

  async function checkAgain(): Promise<void> {
    if (checking) return
    setChecking(true)
    await refreshClaudeLink()
    setChecking(false)
  }

  async function saveBudget(input: HTMLInputElement): Promise<void> {
    api.setError('claude', null)
    const value = parseBudget(input.value)
    if (value === null) {
      api.setError('claude', NOT_A_BUDGET)
      input.value = String(budget)
      return
    }
    if (value === budget) {
      input.value = String(budget)
      return
    }
    // A refusal from main shows on the section; the field then shows what is stored.
    if (!(await api.save('claude', { usage: { weeklyBudgetUsd: value } }))) input.value = String(budget)
  }

  function keys(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') e.currentTarget.blur()
    if (e.key === 'Escape') {
      e.currentTarget.value = String(budget)
      e.currentTarget.blur()
    }
  }

  return (
    <>
      <Section
        id="claude"
        title="Claude Code"
        description="Sessions you start from AgentDeck run through your own Claude Code, so they use your own sign-in."
        saved={api.savedSection === 'claude'}
        error={api.errors.claude}
        action={
          <Button variant="ghost" aria-busy={checking} className="aria-busy:opacity-60" onClick={() => void checkAgain()}>
            {checking ? 'Checking…' : 'Check again'}
          </Button>
        }
      >
        <Row
          title="Installation"
          help={
            !link ? (
              'Checking…'
            ) : link.cli.found ? (
              <>
                {link.cli.version ? `Version ${link.cli.version}, at ` : 'At '}
                <Code className="break-all">{link.cli.path}</Code>
              </>
            ) : (
              <>
                AgentDeck could not find <Code>claude</Code>. Install Claude Code, then check again.
              </>
            )
          }
        >
          {link && <Verdict ok={link.cli.found} okLabel="Found" badLabel="Not found" />}
        </Row>
        <Row title="Sign-in" help={sign ? <Inline text={sign.text} /> : 'Checking…'}>
          {sign?.tone === 'unknown' && <span className="text-[13px] text-muted">Not known</span>}
          {sign && sign.tone !== 'unknown' && <Verdict ok={sign.tone === 'ok'} okLabel="Signed in" badLabel="Signed out" />}
        </Row>
        <SwitchRow
          title="Read token counts from Claude Code's logs"
          help="Shows usage at once, for sessions already open too, and as they work. Off until you switch it on."
          checked={readLogs}
          onChange={(on) => void api.save('claude', { usage: { readLogs: on } })}
        />
        <div className="flex flex-col gap-1.5 border-t border-rule px-4 py-3 text-[12px] leading-4 text-muted">
          <p>
            <span className="font-medium text-ink">What it reads:</span> for each message Claude Code logged, its time, the model, the four token counts (input, output, cache
            write, cache read), the message id and the request id. It reads these from the session logs in your Claude Code folder, as they are written.
          </p>
          <p>
            <span className="font-medium text-ink">What it does not read:</span> your prompts, Claude's replies, tool input or output, or file contents. Each log line is
            parsed in memory, those fields are kept and everything else is dropped at once. Nothing else is stored, logged or sent to the window, and nothing leaves this PC.
          </p>
          <p>
            This narrows AgentDeck's rule "never reads transcripts" to "never reads transcript content". The rule, with its Amendment, is in <Code>docs/adr/0009-supported-interfaces-only.md</Code>.
          </p>
        </div>
        {readLogs && (
          <Row title="Log reading" help={logs?.logs ? logsStatus(logs.logs, now) : 'Starting…'}>
            {logs?.logs && !logs.logs.scan && <Verdict ok okLabel="Reading" />}
          </Row>
        )}
        {readLogs && logs && (
          <Row
            title="Current 5-hour window (estimate)"
            help={
              logs.block
                ? `${blockText(logs.block)} Claude's real limit can't be read from this PC: this follows the rule ccusage uses.`
                : 'No window is open: nothing was logged in the last 5 hours.'
            }
          />
        )}
        {readLogs && logs && logs.topModels && logs.topModels.length > 0 && (
          <Row
            title="This week by model"
            help={`${logs.topModels.map((m) => `${modelLabel(m.model)} ${tokens(m.tokens)}`).join(' · ')}${logs.costPartial ? '. Cost is partly unknown: a model here has no price in the table.' : ''}`}
          />
        )}
        <SwitchRow
          title="Usage figures from Claude Code"
          help={link ? usageHelp(link.usage) : 'Checking…'}
          checked={link?.usage.enabled ?? false}
          disabled={!link}
          onChange={(on) => setDialog(on ? 'on' : 'off')}
        />
        <Row
          title="Weekly budget"
          controlId="claude-budget"
          help="In US dollars. The sidebar compares this week's estimated cost with it."
        >
          <div className="flex items-center gap-1.5">
            <span aria-hidden className="text-[13px] text-muted">
              $
            </span>
            <input
              id="claude-budget"
              key={budget}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              maxLength={10}
              defaultValue={String(budget)}
              aria-describedby="claude-budget-help"
              onBlur={(e) => void saveBudget(e.currentTarget)}
              onKeyDown={keys}
              className={cn(FIELD, 'w-28 text-right')}
            />
          </div>
        </Row>
        <p className="border-t border-rule px-4 py-3 text-[12px] leading-4 text-muted">
          <Inline text="AgentDeck cannot see your 5-hour or weekly plan limits. Claude Code's `/usage` shows them." /> Cost figures are an estimate: what the same tokens would cost at
          API prices, while a subscription is a flat fee.
        </p>
      </Section>
      <UsageDialog mode={dialog} onClose={() => setDialog(null)} onDone={() => void refreshClaudeLink()} />
    </>
  )
}
