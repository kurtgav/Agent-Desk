import { Gauge, PanelLeft } from 'lucide-react'
import { useUi } from '@/store'
import { clockTime, useClaudeLink, usageState } from '@/lib/claudeLink'
import { duration, tokens, usd } from '@/lib/format'
import { openSettings } from './settings/actions'
import { TOGGLE_ID } from './shell/CollapsedRail'
import { Button, Hint, IconButton } from './ui'
import { UserAvatar } from './UserAvatar'

const startOfToday = (): number => new Date().setHours(0, 0, 0, 0)

/**
 * The Usage line. No card: it is a status line, so it recedes. It never tells you to start a new session when the logs can be read:
 * with `usage.readLogs` on it reads them (a progress line the first time), with it off it shows what AgentDeck knows without
 * any setting and offers the switch (D-139 superseded, ADR-0009 amendment).
 */
function Usage() {
  const usage = useUi((s) => s.snapshot.usage)
  const week = useUi((s) => s.snapshot.week)
  const state = usageState(usage, useClaudeLink())
  const header = (
    <div className="flex items-center gap-1.5">
      <Gauge size={14} strokeWidth={1.75} className="text-muted" aria-hidden />
      <span className="t-label">Usage</span>
    </div>
  )

  if (state === 'reading') {
    const scan = usage?.logs?.scan
    return (
      <div role="group" aria-label="Usage, reading your logs" className="px-2">
        {header}
        <p role="status" className="t-meta mt-1.5 text-muted">
          Reading your logs…
        </p>
        {scan && scan.total > 0 && (
          <>
            <div
              role="progressbar"
              aria-label="Log files read"
              aria-valuemin={0}
              aria-valuemax={scan.total}
              aria-valuenow={scan.done}
              className="mt-1.5 h-1 overflow-hidden rounded-full bg-track"
            >
              <div className="h-full rounded-full bg-accent" style={{ width: `${(scan.done / scan.total) * 100}%` }} />
            </div>
            <p className="t-meta mt-1.5 tabular-nums text-muted">
              {scan.done} of {scan.total} files
            </p>
          </>
        )}
      </div>
    )
  }

  if (!usage) {
    const today = startOfToday()
    const turnsToday = week.finishedTurns.filter((t) => t >= today).length
    const turns = (n: number): string => `${n} ${n === 1 ? 'turn' : 'turns'}`
    return (
      <div className="px-2">
        {header}
        <p className="mt-1.5 flex items-baseline gap-1.5 tabular-nums">
          <span className="text-[15px] font-semibold leading-5">{duration(week.agentTimeMs)}</span>
          <span className="t-meta text-muted">agent time this week</span>
        </p>
        <p className="t-meta tabular-nums text-muted [@media(max-height:820px)]:hidden">
          {turns(turnsToday)} finished today · {week.finishedTurns.length} this week
        </p>
        {state !== 'unknown' && (
          <>
            <p className="t-meta mt-1.5 text-pretty text-muted">
              {state === 'waiting'
                ? 'Waiting for the first token figures. Sessions already open will not report until they restart.'
                : 'Token counts are off. One setting shows them now, with no new session.'}
            </p>
            <Button size="sm" className="mt-2" onClick={() => openSettings('claude')}>
              Show token usage
            </Button>
          </>
        )}
      </div>
    )
  }

  const share = Math.min(1, usage.weekCostUsd / usage.weeklyBudgetUsd)
  return (
    <div role="group" aria-label="Usage, API-equivalent estimate" className="px-2">
      {header}
      <p className="mt-1.5 flex items-baseline gap-1.5 tabular-nums">
        <span className="text-[15px] font-semibold leading-5">{usd(usage.weekCostUsd)}</span>
        <span className="t-meta text-muted">of {usd(usage.weeklyBudgetUsd)} this week</span>
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
      <p className="t-meta mt-1.5 tabular-nums text-muted [@media(max-height:820px)]:hidden">
        Today {usd(usage.todayCostUsd)} · {tokens(usage.todayTokens)} tokens
      </p>
      {usage.source === 'logs' && (
        <p className="t-meta mt-1.5 tabular-nums text-muted [@media(max-height:820px)]:hidden">
          {usage.block
            ? `5-hour window (estimate): ${tokens(usage.block.tokens)} tokens, from ${clockTime(usage.block.startedAt)} to about ${clockTime(usage.block.endsAt)}`
            : 'No 5-hour window open right now'}
        </p>
      )}
      <p className="t-meta text-muted [@media(max-height:820px)]:hidden">API-equivalent estimate{usage.costPartial ? ', cost partly unknown' : ''}</p>
    </div>
  )
}


/** Usage, then who you are (Settings opens from it) and the button that folds the sidebar to its 64 px rail, under one rule. */
export function SidebarFooter({ onCollapse }: { onCollapse(): void }) {
  const profile = useUi((s) => s.profile)
  const version = useUi((s) => s.version)
  return (
    <div className="flex-none border-t border-line px-2.5 pb-3 pt-3">
      <Usage />
      <div className="mt-2 flex items-center gap-1">
        <button
          type="button"
          aria-label={`${profile.name}, AgentDeck ${version}. Your profile`}
          onClick={() => openSettings()}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-active/60"
        >
          <UserAvatar size={28} />
          <span className="min-w-0 leading-4">
            <span className="block truncate text-[13px] font-medium">{profile.name}</span>
            <span className="block truncate text-[12px] text-muted">AgentDeck {version}</span>
          </span>
        </button>
        <Hint label="Collapse sidebar (Ctrl B)">
          <IconButton id={TOGGLE_ID} aria-label="Collapse sidebar" aria-expanded aria-controls="sidebar" aria-keyshortcuts="Control+B" onClick={onCollapse}>
            <PanelLeft size={16} strokeWidth={1.75} />
          </IconButton>
        </Hint>
      </div>
    </div>
  )
}
