import type { ReactNode } from 'react'
import { Check, TriangleAlert } from 'lucide-react'
import { Card, cn } from '../ui'

export type SectionId = 'profile' | 'appearance' | 'report' | 'notifications' | 'startup' | 'integration' | 'claude' | 'diagnostics'

/** The pill-shaped field the list pages use for their filters (SearchBox), here for a value that is saved. */
export const FIELD =
  'h-8 rounded-full bg-well px-3 text-[13px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50'
/** A time field: wide enough for "06:00 PM" and the clock beside it. */
export const TIME_FIELD = cn(FIELD, 'w-32')

interface SectionProps {
  id: SectionId
  title: string
  /** One line under the title: what the section is for. */
  description?: string
  /** This section was just saved: a quiet stamp beside its title. */
  saved?: boolean
  /** In plain words, shown above the rows until the next try works. */
  error?: string | null
  action?: ReactNode
  children: ReactNode
}

/** Card, title with its one line, "Saved" stamp and error line. The outer element is what the section list and `Diagnostics` links scroll to. */
export function Section({ id, title, description, saved, error, action, children }: SectionProps) {
  const titleId = `settings-${id}-title`
  return (
    <div id={`settings-${id}`} role="group" aria-labelledby={titleId} tabIndex={-1} className="scroll-mt-6 outline-none">
      <Card aria-labelledby={titleId}>
        <header className="flex items-start gap-3 px-4 pb-3.5 pt-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="t-title">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-pretty text-[13px] leading-5 text-muted">{description}</p>}
          </div>
          <div className="flex flex-none items-center gap-3">
            {saved && (
              <span aria-hidden className="inline-flex items-center gap-1 text-[12px] text-muted">
                <Check size={13} strokeWidth={1.75} />
                Saved
              </span>
            )}
            {action}
          </div>
        </header>
        {error && (
          <p role="alert" className="mx-4 mb-3 rounded-tile bg-[var(--failed-bg)] p-3 text-[13px] text-[var(--failed-ink)]">
            {error}
          </p>
        )}
        {children}
      </Card>
    </div>
  )
}

interface RowProps {
  title: string
  help?: ReactNode
  /** The control's id: the title becomes its label and the help its description (`<id>-help`). */
  controlId?: string
  /** The control goes under the text instead of beside it (a long path, a pair of fields). */
  stacked?: boolean
  children?: ReactNode
}

/** A setting: its label and one line of help on the left, its control on the right, every row on the same two columns. */
export function Row({ title, help, controlId, stacked, children }: RowProps) {
  const text = (
    <div className="min-w-0 flex-1">
      {controlId ? (
        <label htmlFor={controlId} className="block text-[14px] font-medium leading-5">
          {title}
        </label>
      ) : (
        <p className="text-[14px] font-medium leading-5">{title}</p>
      )}
      {help && (
        <p id={controlId ? `${controlId}-help` : undefined} className="mt-0.5 text-pretty text-[12px] leading-4 text-muted">
          {help}
        </p>
      )}
    </div>
  )
  return (
    <div className={cn('border-t border-rule px-4 py-3.5', stacked ? 'flex flex-col gap-3' : 'flex items-center gap-6')}>
      {text}
      {children && <div className={cn(!stacked && 'flex-none')}>{children}</div>}
    </div>
  )
}

/**
 * The pass / fail mark: a glyph and a word, so it never rests on colour (UI_MAP § Accessibility). A pass is a quiet green
 * word with a check; only what needs attention gets a filled pill, so a list of passes stays calm and the one problem shows.
 */
export function Verdict({ ok, okLabel = 'OK', badLabel = 'Needs attention' }: { ok: boolean; okLabel?: string; badLabel?: string }) {
  if (ok) {
    return (
      <span className="inline-flex h-[22px] flex-none items-center gap-1 whitespace-nowrap text-[12px] font-medium text-[var(--done-ink)]">
        <Check size={13} strokeWidth={2.25} aria-hidden />
        {okLabel}
      </span>
    )
  }
  return (
    <span
      className="inline-flex h-[22px] flex-none items-center gap-1 whitespace-nowrap rounded-full px-2 text-[12px] font-medium"
      style={{ background: 'var(--needs-bg)', color: 'var(--needs-ink)' }}
    >
      <TriangleAlert size={12} strokeWidth={2} aria-hidden />
      {badLabel}
    </span>
  )
}
