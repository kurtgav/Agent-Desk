import type { Status } from '@shared/snapshot'
import { cn } from '../ui'

const WORD: Record<Status, string> = { working: 'Working', needs_you: 'Needs you', failed: 'Failed', idle: 'Idle', done: 'Done' }

/**
 * A session's status in a row, small: a turning ring while it works, an amber dot when it waits for you, red when it failed, grey
 * otherwise. The word is there for a screen reader (the colour alone would not be enough); the ring stands still for anyone who asked
 * for less motion.
 */
export function StatusMark({ status, className }: { status: Status; className?: string }) {
  return (
    <span className={cn('inline-flex size-3 flex-none items-center justify-center', className)} title={WORD[status]}>
      {status === 'working' ? (
        <span aria-hidden className="size-2.5 animate-spin rounded-full border-[1.5px] border-[var(--working)] border-t-transparent motion-reduce:animate-none" />
      ) : (
        <span aria-hidden className="size-2 rounded-full" style={{ background: status === 'needs_you' ? 'var(--needs)' : status === 'failed' ? 'var(--failed)' : 'var(--idle)' }} />
      )}
      <span className="sr-only">{WORD[status]}</span>
    </span>
  )
}
