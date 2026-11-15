import { useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { runClaudeThere } from '@/lib/act'
import { refreshClaudeLink, type CliProblem } from '@/lib/claudeLink'
import { Button, IconButton, Inline } from '../ui'

/** What went wrong with a send, and what to do about it (Claude Code missing or signed out, a folder it does not trust yet, a refusal). */
export interface SendProblem {
  message: string
  /** The folder needs `claude` run in it once. */
  untrustedIn?: string
}

const row = 'mb-1 mt-2 flex items-center gap-3 rounded-tile py-2 pl-3 pr-1.5 text-[13px]'
const text = 'min-w-0 flex-1 text-pretty [overflow-wrap:anywhere]'

/** Claude Code is missing or signed out: said before sending, with the way out and a button to look again. */
export function CliNotice({ problem }: { problem: CliProblem }) {
  const [checking, setChecking] = useState(false)
  return (
    <div role="status" className={`${row} bg-[var(--needs-bg)] text-[var(--needs-ink)]`}>
      <p className={text}>
        <Inline text={problem.text} />
      </p>
      <Button
        size="sm"
        aria-busy={checking}
        className="aria-busy:opacity-60"
        onClick={() => {
          if (checking) return
          setChecking(true)
          void refreshClaudeLink().finally(() => setChecking(false))
        }}
      >
        Check again
      </Button>
    </div>
  )
}

/** The send failed. The text is still in the box; this says why, and for a folder Claude Code does not trust yet, offers the fix. */
export function FailNotice({ problem, onDismiss }: { problem: SendProblem; onDismiss(): void }) {
  const [opening, setOpening] = useState(false)
  const folder = problem.untrustedIn
  return (
    <div role="alert" className={`${row} bg-[var(--failed-bg)] text-[var(--failed-ink)]`}>
      <p className={text}>{problem.message}</p>
      {folder && (
        <Button
          size="sm"
          aria-busy={opening}
          className="aria-busy:opacity-60"
          onClick={() => {
            if (opening) return
            setOpening(true)
            void runClaudeThere(folder).finally(() => setOpening(false))
          }}
        >
          Run claude there
        </Button>
      )}
      <IconButton aria-label="Dismiss" className="text-[var(--failed-ink)]" onClick={onDismiss}>
        <X size={15} strokeWidth={1.75} />
      </IconButton>
    </div>
  )
}

/** A quiet line for what the box would not do and why (the limit of agents, a send with nothing to send): never silence. */
export function Flash({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="mt-2 text-pretty text-[13px] text-muted">
      {children}
    </p>
  )
}
