import type { ReactNode } from 'react'
import { Inbox, TriangleAlert } from 'lucide-react'
import { EmptyState, Skeleton, Tag, cn } from '../ui'

/**
 * Page-level parts the list pages share, built on the shell's primitives (Tag, EmptyState, Skeleton): a labelled card,
 * its column heads, a tag that truncates, and one voice for empty, loading and failed.
 */

/** `code` marks in a stored sentence are for display only; a tooltip wants the plain words. */
export const plain = (text: string): string => text.replaceAll('`', '')

/** A small fact about a row (project, where it lives, model): the shell's Tag, cut short with the whole text on hover. */
export function Chip({ children, title, className }: { children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={cn('inline-flex min-w-0 max-w-full', className)}>
      <Tag className="min-w-0 max-w-full flex-initial">
        <span className="truncate">{children}</span>
      </Tag>
    </span>
  )
}

/** The card a list or table lives in. The label names the region for screen readers; the page title already names it for everyone else. */
export function ListCard({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <section aria-label={label} className={cn('rounded-card border border-line bg-surface', className)}>
      {children}
    </section>
  )
}

/**
 * The column heads of a list, on the same grid as its rows. Sticky while the canvas scrolls under it. Decorative for
 * screen readers: each row says everything it holds in words.
 */
export function ColumnHead({ grid, children }: { grid: string; children: ReactNode }) {
  return (
    <div aria-hidden className="sticky top-0 z-10 rounded-t-card bg-surface px-2 pt-1">
      <div className={cn('t-meta items-center gap-x-4 px-2 py-2 font-medium text-muted', grid)}>{children}</div>
    </div>
  )
}

type Tone = 'empty' | 'loading' | 'error'

/**
 * Empty, still reading, or failed: the shell's EmptyState with a lead line and a sentence that says what to do. Under a
 * card header it is a quiet row (`divided`); when it is all a card holds it is centred. Loading is two placeholder rows.
 */
export function StateNote({ tone = 'empty', title, divided = false, children }: { tone?: Tone; title?: string; divided?: boolean; children: ReactNode }) {
  if (tone === 'loading') {
    return (
      <div role="status" className={cn('px-4 py-5', divided && 'border-t border-rule')}>
        <p className="mb-3 text-[13px] leading-5 text-muted">{children}</p>
        <Skeleton className="h-9" />
        <Skeleton className="mt-2 h-9" />
      </div>
    )
  }
  return (
    <EmptyState icon={tone === 'error' ? TriangleAlert : Inbox} center={!divided} className={cn(!divided && 'py-10', tone === 'error' && '[&>svg]:text-[var(--needs-ink)]')}>
      {title && <span className="block text-[14px] font-medium leading-5 text-ink">{title}</span>}
      <span className="block max-w-[56ch] text-pretty">{children}</span>
    </EmptyState>
  )
}

/** "8 sessions" at the toolbar's right, announced politely as a filter changes it. */
export function ResultCount({ n, one, many }: { n: number; one: string; many: string }) {
  return (
    <p aria-live="polite" className="ml-auto text-[13px] tabular-nums text-muted">
      {n} {n === 1 ? one : many}
    </p>
  )
}
