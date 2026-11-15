import { useEffect, useId, useRef, useState } from 'react'
import { ArrowDown, ChevronRight, CircleAlert } from 'lucide-react'
import { runClaudeThere } from '@/lib/act'
import { projectName } from '@/lib/selectors'
import { Button, Tag, cn } from '../ui'
import { Markdown } from './MarkdownView'
import { ToolCard } from './ToolCard'
import { elapsed, turnSummary } from './format'
import { useStickToBottom } from './scroll'
import { isStreaming, isWorking, type Thread, type ThreadItem } from './thread'

/** Space above an item, by what comes before it: a message is a new paragraph, tool cards sit close together. */
function gap(prev: ThreadItem | undefined, item: ThreadItem): string {
  if (!prev) return ''
  if (item.kind === 'user') return 'mt-9'
  if (prev.kind === 'user') return 'mt-4'
  if (item.kind === 'tool') return prev.kind === 'tool' ? 'mt-1.5' : 'mt-3'
  if (item.kind === 'turn' || item.kind === 'notice') return 'mt-3'
  return prev.kind === 'tool' ? 'mt-4' : 'mt-3'
}

function Thinking({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false)
  const panel = useId()
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panel : undefined}
        onClick={() => setOpen((o) => !o)}
        className="press -ml-1 flex items-center gap-1 rounded-md px-1 py-0.5 text-[13px] text-muted hover:text-ink"
      >
        <ChevronRight size={14} strokeWidth={1.75} aria-hidden className={cn('transition-transform motion-reduce:transition-none', open && 'rotate-90')} />
        {streaming ? 'Thinking…' : 'Thinking'}
      </button>
      {open && (
        <p id={panel} className="mt-1.5 whitespace-pre-wrap border-l-2 border-line pl-3 text-[13px] leading-5 text-muted [overflow-wrap:anywhere]">
          {text}
        </p>
      )}
    </div>
  )
}

function Item({ item, prev }: { item: ThreadItem; prev: ThreadItem | undefined }) {
  const lead = prev?.kind === 'user' ? <p className="t-label mb-2 text-muted">Claude</p> : null
  switch (item.kind) {
    case 'user':
      return (
        <div className="rounded-tile bg-well px-4 py-3">
          <p className="t-meta mb-1 text-muted">You</p>
          <p className="whitespace-pre-wrap text-[15px] font-medium leading-6 [overflow-wrap:anywhere]">{item.text}</p>
        </div>
      )
    case 'text':
      return (
        <div>
          {lead}
          <Markdown text={item.text} streaming={!item.final} />
        </div>
      )
    case 'thinking':
      return (
        <div>
          {lead}
          <Thinking text={item.text} streaming={!item.final} />
        </div>
      )
    case 'tool':
      return (
        <div>
          {lead}
          <ToolCard item={item} />
        </div>
      )
    case 'turn':
      return (
        <div className="space-y-2">
          <p className="t-meta flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums text-muted">
            {item.interrupted && <Tag>Stopped</Tag>}
            <span>{turnSummary(item) || 'Done'}</span>
          </p>
          {item.error && (
            <p className="flex items-start gap-2 rounded-tile bg-[var(--failed-bg)] px-3 py-2 text-[13px] leading-5 text-[var(--failed-ink)]">
              <CircleAlert size={15} strokeWidth={1.75} className="mt-0.5 flex-none" aria-hidden />
              <span className="min-w-0 text-pretty [overflow-wrap:anywhere]">{item.error}</span>
            </p>
          )}
        </div>
      )
    case 'notice':
      return <p className={cn('t-meta text-pretty', item.level === 'warn' ? 'text-[var(--needs-ink)]' : 'text-muted')}>{item.text}</p>
  }
}

/** A running turn that has not started writing: that it is working, and for how long (Stop is in the header and the composer). */
function Working({ since }: { since: number | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="mt-4 flex items-center gap-3 text-[13px] text-muted">
      <span aria-hidden className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 animate-pulse rounded-full bg-muted motion-reduce:animate-none" style={{ animationDelay: `${i * 160}ms` }} />
        ))}
      </span>
      <span>Claude is working</span>
      <span aria-hidden className="tabular-nums">{elapsed(since, now)}</span>
    </div>
  )
}

/** Why a conversation is over, when there is a reason to give (the composer below offers Resume and New conversation). */
function Over({ thread, cwd }: { thread: Thread; cwd: string }) {
  const failed = thread.state === 'failed'
  const [opening, setOpening] = useState(false)
  if (!thread.error) return null
  return (
    <div className={cn('mt-6 flex items-start gap-3 rounded-tile px-4 py-3 text-[13px] leading-5', failed ? 'bg-[var(--failed-bg)] text-[var(--failed-ink)]' : 'bg-well text-muted')}>
      <p className="min-w-0 flex-1 text-pretty [overflow-wrap:anywhere]">{thread.error}</p>
      {thread.problem === 'untrusted' && cwd && (
        <Button
          size="sm"
          aria-busy={opening}
          className="flex-none"
          onClick={() => {
            if (opening) return
            setOpening(true)
            void runClaudeThere(cwd).finally(() => setOpening(false))
          }}
        >
          Run claude in {projectName(cwd)}
        </Button>
      )}
    </div>
  )
}

/**
 * The transcript: a live log (polite, busy while Claude writes so a screen reader reads the finished text, not every word),
 * following new content until you scroll up, with a way back to the latest.
 */
export function ThreadView({ id, thread, cwd }: { id: string; thread: Thread; cwd: string }) {
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const { stuck, jump } = useStickToBottom(scroller, content, id)
  const working = isWorking(thread)
  const over = thread.state === 'ended' || thread.state === 'failed'
  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} data-testid="console-thread" role="region" aria-label="Transcript" tabIndex={0} className="h-full overflow-y-auto focus-visible:outline-offset-[-2px]">
        <div
          ref={content}
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-busy={working}
          aria-label="Conversation with Claude Code"
          className="mx-auto max-w-[760px] px-8 pb-10 pt-8"
        >
          {thread.items.map((item, i) => (
            <div key={item.key} className={gap(thread.items[i - 1], item)}>
              <Item item={item} prev={thread.items[i - 1]} />
            </div>
          ))}
          {working && !isStreaming(thread) && <Working since={thread.turnStartedAt} />}
          {over && <Over thread={thread} cwd={cwd} />}
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
