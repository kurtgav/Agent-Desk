import { useMemo, useRef } from 'react'
import { ArrowDown, GitFork, Terminal } from 'lucide-react'
import type { Surface } from '@shared/snapshot'
import { useUi } from '@/store'
import { sessionAction } from '@/lib/act'
import type { SessionEntry } from '@/lib/sessionList'
import { useStickToBottom } from '../console/scroll'
import { forkSession } from '../session-menu/fork'
import { Button, EmptyState, Hint, Skeleton } from '../ui'
import { Timeline } from './Timeline'
import { useDetail } from './useDetail'

const STARTED: Record<Surface, string> = {
  cli: 'Started in a terminal.',
  vscode: 'Started in VS Code.',
  desktop: 'Started in Claude Desktop.',
  background: 'Running in the background.',
  sdk: 'Started by another program.'
}

/** The session's window, when there is one: a terminal or VS Code is brought forward, Desktop is opened, a background one is attached. */
function WindowButton({ entry }: { entry: SessionEntry }) {
  const { session } = entry
  if (session.status === 'done') return null
  const [action, label] = session.bgId ? (['attach', 'Attach'] as const) : session.surface === 'desktop' ? (['open-desktop', 'Open in Claude Desktop'] as const) : (['focus-terminal', 'Go to window'] as const)
  return (
    <Button variant={session.status === 'needs_you' ? 'primary' : 'secondary'} onClick={() => void sessionAction(action, session)}>
      <Terminal size={14} strokeWidth={1.75} aria-hidden />
      {label}
    </Button>
  )
}

/**
 * Where the composer would be, for a session AgentDeck only watches: it never types into someone else's terminal, so the dock says so
 * calmly and offers the two things that work, going to the window it runs in, or continuing it here as a copy (a fork).
 */
export function WatchedDock({ entry }: { entry: SessionEntry }) {
  const { session } = entry
  const waiting = session.status === 'needs_you'
  const ended = session.status === 'done'
  const canFork = session.cwd !== ''
  return (
    <div className="flex-none border-t border-line bg-surface px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-tile bg-well px-4 py-3">
        <p className="min-w-[24ch] flex-1 text-pretty text-[13px] leading-5">
          <span className="font-medium">{waiting ? 'It is waiting for you.' : STARTED[session.surface]}</span>{' '}
          <span className="text-muted">
            {ended ? 'It has finished. Continue here to pick it up as a copy.' : 'Reply there, or continue here to fork it into a new session.'}
          </span>
        </p>
        <div className="flex flex-none items-center gap-2">
          <WindowButton entry={entry} />
          <Hint label={canFork ? 'Starts a copy of this session here. The original stays as it is.' : "AgentDeck does not know this session's folder, so it can not continue it."}>
            <Button aria-disabled={!canFork} onClick={() => canFork && forkSession(session, entry.name)}>
              <GitFork size={14} strokeWidth={1.75} aria-hidden />
              Continue here
            </Button>
          </Hint>
        </div>
      </div>
    </div>
  )
}

/** What a watched session did, like a transcript: oldest first, the newest at the bottom, following it until you scroll up. */
export function WatchedBody({ entry }: { entry: SessionEntry }) {
  const load = useDetail(entry.session.id)
  const now = useUi((s) => s.now)
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const { stuck, jump } = useStickToBottom(scroller, content, entry.key)
  const entries = useMemo(() => (load.state === 'ready' ? [...load.detail.timeline].reverse() : []), [load])
  const plan = entry.session.plan
  const final = load.state === 'ready' ? load.detail.finalMessage : null

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} role="region" aria-label="What the session did" tabIndex={0} className="h-full overflow-y-auto focus-visible:outline-offset-[-2px]">
        <div ref={content} className="mx-auto max-w-[760px] px-8 pb-10 pt-6">
          {plan && (
            <p className="mb-3 text-[13px] text-muted">
              Step {Math.min(plan.done + 1, plan.total)} of {plan.total} of its plan. The plan, its files and its usage are in Details.
            </p>
          )}
          {load.state === 'loading' && (
            <div role="status" aria-label="Loading the timeline" className="flex flex-col gap-3">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5" />
              <Skeleton className="h-5 w-5/6" />
            </div>
          )}
          {load.state === 'missing' && (
            <EmptyState center>AgentDeck has no timeline for this session yet. It may have started before AgentDeck, or its collector is restarting.</EmptyState>
          )}
          {load.state === 'ready' && <Timeline entries={entries} now={now} />}
          {final && (
            <section aria-label="Its last message" className="mt-6">
              <h3 className="t-label mb-2 text-muted">Its last message</h3>
              <p className="whitespace-pre-wrap rounded-tile bg-well p-4 text-[14px] leading-6 [overflow-wrap:anywhere]">{final}</p>
            </section>
          )}
        </div>
      </div>
      {!stuck && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <Button variant="primary" size="sm" className="pointer-events-auto shadow-pop" onClick={jump}>
            <ArrowDown size={14} strokeWidth={2} aria-hidden /> Jump to latest
          </Button>
        </div>
      )}
    </div>
  )
}
