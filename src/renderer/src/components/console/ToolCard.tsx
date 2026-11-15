import { useId, useState, type ComponentType } from 'react'
import { Bot, Check, ChevronRight, CircleSlash, FileText, FolderSearch, Globe, ListChecks, LoaderCircle, Pencil, Plug, Search, ShieldAlert, Terminal, Wrench, X } from 'lucide-react'
import { useUi } from '@/store'
import { Button, cn } from '../ui'
import { allowTool, continueWithAllowance, useConsole } from './store'
import type { ThreadItem, ToolStatus } from './thread'

type ToolItem = Extract<ThreadItem, { kind: 'tool' }>
type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

const ICON: Record<string, Icon> = {
  Read: FileText, Edit: Pencil, MultiEdit: Pencil, Write: Pencil, NotebookEdit: Pencil, Bash: Terminal, PowerShell: Terminal,
  Glob: FolderSearch, Grep: Search, LS: FolderSearch, WebFetch: Globe, WebSearch: Globe, Task: Bot, Agent: Bot, TodoWrite: ListChecks
}

const STATUS: Record<ToolStatus, { text: string; show: boolean }> = {
  running: { text: 'Running', show: false },
  ok: { text: 'Done', show: false },
  failed: { text: 'Failed', show: true },
  denied: { text: 'Not allowed', show: true },
  stopped: { text: 'Stopped', show: true }
}

function StatusMark({ status }: { status: ToolStatus }) {
  const s = STATUS[status]
  return (
    <span className={cn('flex flex-none items-center gap-1 text-[12px] font-medium', status === 'failed' && 'text-[var(--failed-ink)]', status === 'denied' && 'text-[var(--needs-ink)]', (status === 'ok' || status === 'running' || status === 'stopped') && 'text-muted')}>
      {status === 'running' && <LoaderCircle size={14} strokeWidth={2} className="animate-spin motion-reduce:animate-none" aria-hidden />}
      {status === 'ok' && <Check size={14} strokeWidth={2} aria-hidden />}
      {status === 'failed' && <X size={14} strokeWidth={2} aria-hidden />}
      {status === 'denied' && <ShieldAlert size={14} strokeWidth={1.75} aria-hidden />}
      {status === 'stopped' && <CircleSlash size={14} strokeWidth={1.75} aria-hidden />}
      {s.show ? s.text : <span className="sr-only">{s.text}</span>}
    </span>
  )
}

/** The first word of the summary leads (`Edit`, `Run`), the rest is the detail. */
function Summary({ text }: { text: string }) {
  const m = /^([^\s:]+:?)\s+(.*)$/.exec(text)
  return m ? (
    <span className="min-w-0 flex-1 truncate text-[13px]">
      <span className="font-medium">{m[1]}</span> <span className="text-muted">{m[2]}</span>
    </span>
  ) : (
    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{text}</span>
  )
}

const FOLD_LINES = 14
const FOLD_CHARS = 1_400

/** Output as the terminal would print it: the first lines, the rest one click away. */
function Output({ label, text, note }: { label: string; text: string; note?: string }) {
  const [all, setAll] = useState(false)
  const lines = text.split('\n')
  const folded = !all && (lines.length > FOLD_LINES || text.length > FOLD_CHARS)
  const shown = folded ? lines.slice(0, FOLD_LINES).join('\n').slice(0, FOLD_CHARS) : text
  const hidden = folded ? Math.max(1, lines.length - shown.split('\n').length) : 0
  return (
    <div>
      <p className="t-meta mb-1 text-muted">{label}</p>
      <pre tabIndex={0} className="max-h-72 overflow-auto rounded-lg bg-well px-3 py-2 font-mono text-[12px] leading-[18px] text-ink">{shown || '(empty)'}</pre>
      {(folded || note) && (
        <p className="t-meta mt-1 flex items-center gap-3 text-muted">
          {folded && (
            <button type="button" onClick={() => setAll(true)} className="press rounded-md font-medium text-ink underline decoration-control underline-offset-2 hover:decoration-ink">
              Show more ({hidden} more {hidden === 1 ? 'line' : 'lines'})
            </button>
          )}
          {note && <span>{note}</span>}
        </p>
      )}
    </div>
  )
}

/** Why a tool did not run, and the two things that fix it (the approval path already exists: Needs you, Approvals). */
function Denied({ item }: { item: ToolItem }) {
  const remote = useUi((s) => s.status?.remoteApprovals.enabled === true)
  const setIntegration = useUi((s) => s.setIntegration)
  const id = useConsole((s) => s.selected)
  const allowed = useConsole((s) => (s.selected ? s.convs[s.selected]?.thread.allowed : undefined)) ?? []
  const [step, setStep] = useState<{ kind: 'idle' } | { kind: 'working' } | { kind: 'sent' } | { kind: 'restart'; error: string } | { kind: 'failed'; error: string }>({ kind: 'idle' })
  const rule = item.rule
  // An MCP tool is named as the server and the tool; anything else by its rule.
  const label = item.name.startsWith('mcp__') ? item.summary : (rule ?? item.name)
  const done = rule !== null && allowed.includes(rule)

  const allow = async (): Promise<void> => {
    if (!id || !rule) return
    setStep({ kind: 'working' })
    const r = await allowTool(id, rule, label, true)
    setStep(r.ok ? { kind: 'sent' } : r.restart ? { kind: 'restart', error: r.error } : { kind: 'failed', error: r.error })
  }
  const restart = async (): Promise<void> => {
    if (!id || !rule) return
    setStep({ kind: 'working' })
    const r = await continueWithAllowance(id, rule, label)
    setStep(r.ok ? { kind: 'sent' } : { kind: 'failed', error: r.error })
  }

  return (
    <div className="space-y-2 border-t border-rule bg-[var(--needs-bg)] px-3 py-2.5 text-[13px] leading-5 text-[var(--needs-ink)]">
      <p className="text-pretty" aria-live="polite">
        {done
          ? step.kind === 'sent'
            ? `${label} is allowed for this conversation. Claude is asked to try again.`
            : `${label} is allowed for this conversation now.`
          : remote
            ? 'Claude Code needed approval and none came in time, so it skipped this step. Approvals you answer appear in Needs you.'
            : 'Claude Code needs approval for this step and nobody could give it here, so it skipped it.'}
        {!done && ' You can allow it for this conversation, answer such requests in AgentDeck with Remote approvals, or start a new conversation with Accept edits.'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {rule && !done && step.kind !== 'sent' && (
          <Button size="sm" aria-busy={step.kind === 'working'} className="aria-busy:opacity-60" onClick={() => void allow()}>
            Allow {label} for this conversation
          </Button>
        )}
        {step.kind === 'restart' && (
          <Button size="sm" onClick={() => void restart()}>
            Continue with it allowed
          </Button>
        )}
        {!remote && !done && (
          <Button size="sm" variant="ghost" onClick={() => setIntegration('install')}>
            Remote approvals…
          </Button>
        )}
      </div>
      {step.kind === 'restart' && <p role="alert">{step.error} It can be continued in a new process that starts with the rule: the same session, nothing lost.</p>}
      {step.kind === 'failed' && <p role="alert">{step.error}</p>}
      {rule === null && !done && <p className="text-[12px] leading-4">No safe one-click rule exists for this exact call, so start a new conversation with Accept edits, or allow a narrower tool under Advanced.</p>}
    </div>
  )
}

/** One tool call: a line that says what, a status, and the input and result one click away. */
export function ToolCard({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false)
  const panel = useId()
  const Icon = ICON[item.name] ?? (item.name.startsWith('mcp__') ? Plug : Wrench)
  const detail = item.input || item.result
  return (
    <div className={cn('overflow-hidden rounded-tile border bg-surface', item.status === 'denied' ? 'border-[var(--needs)]/50' : item.status === 'failed' ? 'border-[var(--failed)]/40' : 'border-line')}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panel : undefined}
        disabled={!detail}
        onClick={() => setOpen((o) => !o)}
        className="press flex w-full items-center gap-2.5 px-3 py-2 text-left enabled:hover:bg-ground disabled:cursor-default"
      >
        <Icon size={15} strokeWidth={1.75} className="flex-none text-muted" aria-hidden />
        <Summary text={item.summary} />
        <StatusMark status={item.status} />
        <ChevronRight size={14} strokeWidth={1.75} aria-hidden className={cn('flex-none text-muted transition-transform motion-reduce:transition-none', open && 'rotate-90', !detail && 'invisible')} />
      </button>
      {item.status === 'denied' && <Denied item={item} />}
      {open && detail && (
        <div id={panel} className="space-y-3 border-t border-rule px-3 py-3">
          {item.input && <Output label="Input" text={item.input} />}
          {item.result !== null && <Output label={item.status === 'failed' || item.status === 'denied' ? 'Error' : 'Result'} text={item.result} note={item.truncated ? 'Only the first 4 KB are shown.' : undefined} />}
        </div>
      )}
    </div>
  )
}
