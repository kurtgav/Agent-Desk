import { useState, type ReactNode } from 'react'
import { Circle, CircleCheck, X } from 'lucide-react'
import { CONVERSATION_ID } from '@shared/console'
import type { SessionDetail } from '@shared/detail'
import { useUi } from '@/store'
import { openChangedFile } from '@/lib/act'
import { ago, duration } from '@/lib/format'
import { projectName } from '@/lib/selectors'
import type { SessionEntry } from '@/lib/sessionList'
import { formatCost } from '../console/format'
import { modeLabel, modelLabel } from '../console/options'
import { useConsole } from '../console/store'
import { Button, Code, CountBadge, IconButton, Skeleton, cn } from '../ui'
import { Logs } from './Logs'
import { SURFACE } from './labels'
import { Timeline } from './Timeline'
import { useDetail, type Load } from './useDetail'

const ACTIVITY_SHOWN = 8

function Section({ id, title, count, children }: { id: string; title: string; count?: number; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-b border-rule px-4 py-3.5 last:border-b-0">
      <h3 id={id} className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-muted">
        {title}
        {count !== undefined && <CountBadge n={count} label="items" />}
      </h3>
      {children}
    </section>
  )
}

const Quiet = ({ children }: { children: ReactNode }) => <p className="text-[13px] leading-5 text-muted">{children}</p>

function Facts({ entry, now }: { entry: SessionEntry; now: number }) {
  const { session } = entry
  const rows: [string, ReactNode][] = [
    ['Runs in', SURFACE[session.surface]],
    ['Folder', session.cwd ? <Code className="block truncate px-1.5 text-[12px]" title={session.cwd}>{session.cwd}</Code> : 'Unknown'],
    ['Started', ago(now - session.startedAt)],
    ...(session.subagents.length ? ([['Subagents', String(session.subagents.length)]] as [string, ReactNode][]) : [])
  ]
  return (
    <dl className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px] leading-5">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 truncate">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Plan({ detail, entry }: { detail: SessionDetail | null; entry: SessionEntry }) {
  const tasks = detail?.tasks ?? []
  if (!tasks.length) return <Quiet>{entry.session.plan ? `Step ${Math.min(entry.session.plan.done + 1, entry.session.plan.total)} of ${entry.session.plan.total}.` : 'No plan. The session did not create tasks.'}</Quiet>
  return (
    <ol className="flex flex-col gap-1.5">
      {tasks.map((t) => (
        <li key={t.id} className="flex items-start gap-2 text-[13px] leading-5">
          {t.done ? <CircleCheck size={16} strokeWidth={1.75} className="mt-0.5 flex-none text-[var(--done)]" aria-label="Done" /> : <Circle size={16} strokeWidth={1.75} className="mt-0.5 flex-none text-muted" aria-label="Open" />}
          <span className={cn(t.done && 'text-muted')}>{t.subject}</span>
        </li>
      ))}
    </ol>
  )
}

function Files({ detail, now }: { detail: SessionDetail | null; now: number }) {
  if (!detail?.files.length) return <Quiet>No files changed by this session.</Quiet>
  return (
    <ul className="flex flex-col">
      {detail.files.map((f) => (
        <li key={f.path} className="border-t border-rule first:border-t-0">
          <button type="button" onClick={() => void openChangedFile(f.path)} title={`Open ${f.path} in VS Code`} className="flex w-full items-center gap-2 rounded-lg py-1.5 text-left transition-colors hover:bg-hover">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] leading-5">{projectName(f.path)}</span>
              <span className="block truncate text-[12px] leading-4 text-muted">{f.path}</span>
            </span>
            <span className="flex-none text-[12px] text-muted">{ago(now - f.changedAt)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function Activity({ detail, now }: { detail: SessionDetail | null; now: number }) {
  const [all, setAll] = useState(false)
  const rows = detail?.timeline ?? []
  return (
    <>
      <Timeline entries={all ? rows : rows.slice(0, ACTIVITY_SHOWN)} now={now} />
      {rows.length > ACTIVITY_SHOWN && (
        <Button size="sm" variant="quiet" className="mt-1 -ml-2" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </Button>
      )}
    </>
  )
}

/** Cost and turns for a session started here; for one started elsewhere, honest about what AgentDeck is not told. */
function Usage({ entry }: { entry: SessionEntry }) {
  const view = useConsole((s) => (entry.conv ? s.convs[entry.conv] : undefined))
  const { session } = entry
  if (!view) {
    return (
      <Quiet>
        Claude Code does not tell AgentDeck the tokens or cost of a session started elsewhere. It has run for {duration(Math.max(0, session.lastEventAt - session.startedAt))}; the week's usage is in the sidebar.
      </Quiet>
    )
  }
  const { thread, info } = view
  const model = thread.capabilities?.model ?? modelLabel(info.model)
  return (
    <dl className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px] leading-5">
      <dt className="text-muted">Cost</dt>
      <dd className="tabular-nums">{thread.totalCostUsd > 0 ? `≈ ${formatCost(thread.totalCostUsd)}` : 'Not reported yet'}</dd>
      <dt className="text-muted">Turns</dt>
      <dd className="tabular-nums">{thread.turns}</dd>
      <dt className="text-muted">Model</dt>
      <dd className="truncate">{model}</dd>
      <dt className="text-muted">Permissions</dt>
      <dd>{modeLabel(info.permissionMode)}</dd>
    </dl>
  )
}

function Body({ entry, load, now }: { entry: SessionEntry; load: Load; now: number }) {
  const detail = load.state === 'ready' ? load.detail : null
  if (load.state === 'loading') {
    return (
      <div role="status" aria-label="Loading details" className="flex flex-col gap-3 p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-5" />
        <Skeleton className="h-5 w-5/6" />
      </div>
    )
  }
  return (
    <>
      <Section id="d-facts" title="About">
        <Facts entry={entry} now={now} />
      </Section>
      {load.state === 'missing' && (
        <div className="border-b border-rule px-4 py-3.5">
          <Quiet>The collector has no record of this session yet, so its plan, files and activity are empty. They appear as it reports in.</Quiet>
        </div>
      )}
      <Section id="d-plan" title="Plan" count={detail?.tasks.length || undefined}>
        <Plan detail={detail} entry={entry} />
      </Section>
      <Section id="d-files" title="Files changed" count={detail?.files.length || undefined}>
        <Files detail={detail} now={now} />
      </Section>
      <Section id="d-activity" title="Activity">
        {entry.origin === 'watching' ? <Quiet>Its timeline is the main pane.</Quiet> : detail ? <Activity detail={detail} now={now} /> : <Quiet>No collector events for it yet.</Quiet>}
      </Section>
      <Section id="d-usage" title="Usage of this session">
        <Usage entry={entry} />
      </Section>
      {entry.session.bgId && (
        <Section id="d-logs" title="Logs">
          <Logs session={entry.session} />
        </Section>
      )}
    </>
  )
}

/**
 * The old session drawer, promoted (IA § 4): beside the session instead of over it, toggled from its header, remembering whether you
 * left it open. Plan, files, activity and usage of the open session; nothing here is the conversation.
 */
export function DetailsPanel({ entry }: { entry: SessionEntry }) {
  const now = useUi((s) => s.now)
  // A conversation Claude Code has not named yet has nothing in the collector to read.
  const load = useDetail(CONVERSATION_ID.test(entry.session.id) ? null : entry.session.id)
  return (
    <aside aria-label="Details" className="flex w-80 flex-none flex-col border-l border-line bg-surface">
      <header className="flex h-[60px] flex-none items-center justify-between border-b border-line pl-4 pr-2.5">
        <h2 className="t-title">Details</h2>
        <IconButton aria-label="Close details" onClick={() => useUi.getState().setDetails(false)}>
          <X size={16} strokeWidth={1.75} />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Body entry={entry} load={load} now={now} />
      </div>
    </aside>
  )
}
