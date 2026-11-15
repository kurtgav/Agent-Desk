import { PanelLeft, Settings } from 'lucide-react'
import { useUi } from '@/store'
import { clockTime, useClaudeLink, usageState } from '@/lib/claudeLink'
import { duration, tokens, usd } from '@/lib/format'
import { openSettings } from './settings/actions'
import { TOGGLE_ID } from './shell/CollapsedRail'
import { Hint, IconButton } from './ui'
import { UserAvatar } from './UserAvatar'

/**
 * Usage, as one quiet line: a status line, so it recedes; the Overview and Settings > Claude Code have the rest. It never tells you to
 * start a new session when the logs can be read: with `usage.readLogs` on it reads them (a progress bar the first time), with it off it
 * shows the agent time AgentDeck knows without any setting and offers the switch (D-139 superseded, ADR-0009 amendment).
 */
function Usage() {
  const usage = useUi((s) => s.snapshot.usage)
  const week = useUi((s) => s.snapshot.week)
  const state = usageState(usage, useClaudeLink())

  if (state === 'reading') {
    const scan = usage?.logs?.scan
    return (
      <div role="group" aria-label="Usage, reading your logs" className="px-2">
        <p role="status" className="t-meta tabular-nums text-muted">
          Reading your logs…{scan && scan.total > 0 ? ` ${scan.done} of ${scan.total} files` : ''}
        </p>
        {scan && scan.total > 0 && (
          <div role="progressbar" aria-label="Log files read" aria-valuemin={0} aria-valuemax={scan.total} aria-valuenow={scan.done} className="mt-1.5 h-1 overflow-hidden rounded-full bg-track">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(scan.done / scan.total) * 100}%` }} />
          </div>
        )}
      </div>
    )
  }

  if (!usage) {
    return (
      <div className="flex items-baseline gap-1.5 px-2 tabular-nums">
        <span className="text-[13px] font-medium">{duration(week.agentTimeMs)}</span>
        <span className="t-meta min-w-0 flex-1 truncate text-muted">agent time this week</span>
        {state !== 'unknown' && (
          <Hint label={state === 'waiting' ? 'Waiting for the first token figures. Sessions already open report after they restart.' : 'Token counts are off. One setting shows them, with no new session.'}>
            <button type="button" onClick={() => openSettings('claude')} className="press flex-none rounded-md text-[12px] text-accent hover:underline">
              Show token usage
            </button>
          </Hint>
        )}
      </div>
    )
  }

  const share = Math.min(1, usage.weekCostUsd / usage.weeklyBudgetUsd)
  const block = usage.source === 'logs' && usage.block
  const detail = [
    ...(block ? [`5-hour window (estimate): ${tokens(block.tokens)} tokens, ${clockTime(block.startedAt)} to about ${clockTime(block.endsAt)}`] : []),
    `API-equivalent estimate${usage.costPartial ? ', cost partly unknown' : ''}`
  ]
  return (
    <div role="group" aria-label="Usage, API-equivalent estimate" title={detail.join('\n')} className="px-2">
      <p className="flex items-baseline gap-1.5 tabular-nums">
        <span className="text-[13px] font-medium">{usd(usage.weekCostUsd)}</span>
        <span className="t-meta truncate text-muted">of {usd(usage.weeklyBudgetUsd)} this week</span>
      </p>
      <div
        role="meter"
        aria-label="Weekly budget used"
        aria-valuemin={0}
        aria-valuemax={usage.weeklyBudgetUsd}
        aria-valuenow={Math.min(usage.weekCostUsd, usage.weeklyBudgetUsd)}
        aria-valuetext={`${usd(usage.weekCostUsd)} of ${usd(usage.weeklyBudgetUsd)}`}
        className="mt-1.5 h-1 overflow-hidden rounded-full bg-track"
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${share * 100}%` }} />
      </div>
      <p className="t-meta mt-1 truncate tabular-nums text-muted [@media(max-height:820px)]:sr-only">
        Today {usd(usage.todayCostUsd)} · {tokens(usage.todayTokens)} tokens
      </p>
    </div>
  )
}

/** Usage, then who you are, Settings, and the button that folds the sidebar to its 64 px rail, under one rule. */
export function SidebarFooter({ onCollapse }: { onCollapse(): void }) {
  const profile = useUi((s) => s.profile)
  const version = useUi((s) => s.version)
  const page = useUi((s) => s.nav.page)
  return (
    <div className="flex-none border-t border-line px-2.5 pb-2.5 pt-2.5">
      <Usage />
      <div className="mt-2 flex items-center gap-0.5">
        <button
          type="button"
          aria-label={`${profile.name}, AgentDeck ${version}. Your profile`}
          onClick={() => openSettings()}
          className="press flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1.5 text-left outline-none transition-colors hover:bg-active/60 focus-visible:ring-2 focus-visible:ring-accent"
        >
          <UserAvatar size={24} />
          <span className="min-w-0 leading-4">
            <span className="block truncate text-[13px] font-medium">{profile.name}</span>
            <span className="block truncate text-[12px] text-muted">AgentDeck {version}</span>
          </span>
        </button>
        <Hint label="Settings">
          <IconButton aria-label="Settings" aria-current={page === 'settings' ? 'page' : undefined} onClick={() => openSettings()} className={page === 'settings' ? 'bg-active text-ink' : undefined}>
            <Settings size={16} strokeWidth={1.75} />
          </IconButton>
        </Hint>
        <Hint label="Collapse sidebar (Ctrl B)">
          <IconButton id={TOGGLE_ID} aria-label="Collapse sidebar" aria-expanded aria-controls="sidebar" aria-keyshortcuts="Control+B" onClick={onCollapse}>
            <PanelLeft size={16} strokeWidth={1.75} />
          </IconButton>
        </Hint>
      </div>
    </div>
  )
}
