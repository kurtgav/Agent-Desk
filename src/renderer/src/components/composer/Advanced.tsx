import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { APPEND_PROMPT_MAX, BUDGET_USD_MAX, isFallbackModels, type ConsoleOptions } from '@shared/console'
import { useCaps } from '../console/caps-store'
import { setOptions, useConsole } from '../console/store'
import { Button, Inline, cn } from '../ui'
import { Folders, Row, RuleField, field } from './advanced-fields'

const NO_TOOLS: string[] = []

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** What is set, in a few words, so a closed section still says so. */
export function advancedSummary(o: ConsoleOptions): string {
  return [
    o.allowedTools.length ? count(o.allowedTools.length, 'allowed tool') : '',
    o.disallowedTools.length ? count(o.disallowedTools.length, 'blocked tool') : '',
    o.addDirs.length ? count(o.addDirs.length, 'extra folder') : '',
    o.appendSystemPrompt ? 'extra instructions' : '',
    o.fallbackModel ? 'fallback model' : '',
    o.maxBudgetUsd !== null ? `limit $${o.maxBudgetUsd}` : ''
  ]
    .filter(Boolean)
    .join(', ')
}

/** The chip that opens the section: closed by default, and it says what is set in it when something is. */
export function AdvancedToggle({ open, controls, onToggle }: { open: boolean; controls: string; onToggle(): void }) {
  const summary = advancedSummary(useConsole((s) => s.draft.options))
  return (
    <Button variant="ghost" size="sm" className={cn('px-2.5 text-muted', open && 'bg-active')} aria-expanded={open} aria-controls={open ? controls : undefined} onClick={onToggle}>
      <SlidersHorizontal size={14} strokeWidth={1.75} aria-hidden />
      <span className="text-ink">Advanced</span>
      {summary && <span className="max-w-40 truncate text-[12px]">{summary}</span>}
    </Button>
  )
}

/**
 * Off by default and closed: the things `claude --help` offers beyond the basics, each checked before it reaches the command line.
 * They are the Console's draft options (extra folders, standing instructions, allowed tools, a spend limit), unchanged.
 */
export function AdvancedPanel({ id }: { id: string }) {
  const o = useConsole((s) => s.draft.options)
  const cwd = useConsole((s) => s.draft.cwd)
  const tools = useCaps((s) => s.last)?.tools ?? NO_TOOLS
  const [budget, setBudget] = useState(o.maxBudgetUsd === null ? '' : String(o.maxBudgetUsd))
  const [fallback, setFallback] = useState(o.fallbackModel ?? '')
  const append = 'adv-append'
  const fallbackBad = fallback.trim() !== '' && !isFallbackModels(fallback.trim())
  return (
    <div id={id} className="max-h-[min(52vh,440px)] space-y-4 overflow-y-auto border-t border-rule px-4 py-4">
      <RuleField
        id="adv-allowed" label="Allowed tools" suggestions={tools.slice(0, 400)} rules={o.allowedTools} onChange={(allowedTools) => setOptions({ allowedTools })}
        help="Tools that run without asking. Keep it narrow: a whole server (mcp__server), one tool (mcp__server__tool) or one command (Bash(git status:*))."
      />
      <RuleField
        id="adv-blocked" label="Blocked tools" suggestions={tools.slice(0, 400)} rules={o.disallowedTools} onChange={(disallowedTools) => setOptions({ disallowedTools })}
        help="Tools Claude may not use at all, even if something else would allow them."
      />
      <Folders dirs={o.addDirs} cwd={cwd} />
      <Row label="Extra instructions" help="Added to Claude's standing instructions for this conversation. They are shown in its header, so they are never hidden." htmlFor={append}>
        <textarea
          id={append}
          rows={3}
          value={o.appendSystemPrompt ?? ''}
          maxLength={APPEND_PROMPT_MAX}
          onChange={(e) => setOptions({ appendSystemPrompt: e.target.value.trim() ? e.target.value : null })}
          placeholder="For example: answer in French, and keep replies short."
          className="block w-full resize-y rounded-lg bg-ground px-2.5 py-2 text-[13px] leading-5 outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent"
        />
        <p className="t-meta mt-1 text-right tabular-nums text-muted">{(o.appendSystemPrompt ?? '').length} / {APPEND_PROMPT_MAX}</p>
      </Row>
      <div className="grid gap-4 sm:grid-cols-2">
        <Row label="Fallback models" help="Models to switch to when the main one is overloaded, separated by commas (up to three)." htmlFor="adv-fallback">
          <input
            id="adv-fallback"
            value={fallback}
            onChange={(e) => {
              setFallback(e.target.value)
              const v = e.target.value.trim()
              setOptions({ fallbackModel: v && isFallbackModels(v) ? v : null })
            }}
            placeholder="sonnet,haiku"
            spellCheck={false}
            aria-invalid={fallbackBad}
            className={field}
          />
          {fallbackBad && <p role="alert" className="mt-1 text-[12px] leading-4 text-[var(--failed-ink)]">Model ids separated by commas, three at most.</p>}
        </Row>
        <Row label="Spend limit (USD)" help={`Stops the conversation when Claude Code estimates it spent this much (up to ${BUDGET_USD_MAX}).`} htmlFor="adv-budget">
          <input
            id="adv-budget"
            type="number"
            inputMode="decimal"
            min={0.01}
            max={BUDGET_USD_MAX}
            step={0.5}
            value={budget}
            onChange={(e) => {
              setBudget(e.target.value)
              const n = Number(e.target.value)
              setOptions({ maxBudgetUsd: e.target.value.trim() !== '' && Number.isFinite(n) && n >= 0.01 && n <= BUDGET_USD_MAX ? n : null })
            }}
            placeholder="No limit"
            className={cn(field, 'tabular-nums')}
          />
        </Row>
      </div>
      <p className="t-meta text-pretty text-muted">
        These are Claude Code's own options (<Inline text="`claude --help`" />). Nothing here can switch permission checks off.
      </p>
    </div>
  )
}
