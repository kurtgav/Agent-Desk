import type { ButtonHTMLAttributes, ComponentProps, ComponentType, ReactNode } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Status } from '@shared/snapshot'

export function cn(...v: ClassValue[]): string {
  return twMerge(clsx(v))
}

type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

/* ── Buttons ─────────────────────────────────────────────────────────────── */

const VARIANTS = {
  primary: 'bg-accent-fill text-white enabled:hover:bg-accent-fill-hover',
  secondary: 'border border-control bg-surface text-ink enabled:hover:bg-hover',
  ghost: 'text-ink enabled:hover:bg-active',
  /** A section's one quiet action ("See all"): muted until it is pointed at. */
  quiet: 'text-muted enabled:hover:bg-active enabled:hover:text-ink'
} as const

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS
  size?: 'sm' | 'md'
}

export function Button({ variant = 'secondary', size = 'md', className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'press inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium disabled:opacity-50',
        size === 'sm' ? 'h-[30px] px-3.5 text-[13px]' : 'h-8 px-3.5 text-[13px]',
        VARIANTS[variant],
        className
      )}
      {...rest}
    />
  )
}

/** The action at the end of a card header: quiet, and inset so its label lines up with the rows' 16 px edge. */
export function CardAction({ className, ...rest }: Omit<ButtonProps, 'variant' | 'size'>) {
  return <Button variant="quiet" size="sm" className={cn('-mr-2.5 px-2.5', className)} {...rest} />
}

export function IconButton({ className, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn('press inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted enabled:hover:bg-active enabled:hover:text-ink disabled:opacity-50', className)}
      {...rest}
    />
  )
}

/* ── Overlays: one set of classes for every menu, popover, dialog and drawer ─ */

export const menuPanel = 'z-50 min-w-52 rounded-tile border border-line bg-overlay p-1 text-[13px] shadow-pop'
/** Concentric with `menuPanel`: 12 px corner minus 4 px padding. */
export const menuItem = 'flex cursor-default select-none items-center gap-2 rounded-lg px-2 py-1.5 outline-none data-[highlighted]:bg-hover data-[disabled]:opacity-50'
export const menuLabel = 'px-2 py-1.5 text-[12px] font-medium text-muted'
export const menuSeparator = 'my-1 h-px bg-rule'

export const modalOverlay = 'anim-fade fixed inset-0 z-40 bg-scrim'
export const modalPanel = 'anim-rise fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-overlay p-5 shadow-modal outline-none'
export const modalTitle = 't-heading text-balance'
export const modalLede = 'mt-1 text-pretty text-[13px] leading-5 text-muted'
export const modalFooter = 'mt-5 flex justify-end gap-2'

/** The drawer's and the Segmented filter's pill tabs: a well with the chosen one lifted onto the surface. */
export const segList = 'flex w-fit gap-0.5 rounded-full bg-well p-0.5'
export const segTab =
  'press h-7 rounded-full px-3 text-[13px] font-medium text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent data-[state=active]:bg-lift data-[state=active]:text-ink data-[state=active]:shadow-lift aria-pressed:bg-lift aria-pressed:text-ink aria-pressed:shadow-lift'

export function Hint({ label, children, side = 'bottom' }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'right' }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side={side} sideOffset={6} className="z-50 max-w-72 rounded-md bg-tip px-2 py-1 text-[12px] leading-4 text-on-tip shadow-pop">
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

/* ── Status ──────────────────────────────────────────────────────────────── */

export type Tone = 'working' | 'needs' | 'failed' | 'idle' | 'done'

/** A dot and a word on the tone's tint: never colour alone, and the label ink passes AA on its own fill. Takes span props (a tooltip trigger needs `tabIndex` and a ref). */
export function Pill({ tone, size = 'sm', className, style, children, ...rest }: ComponentProps<'span'> & { tone: Tone; size?: 'sm' | 'md' }) {
  return (
    <span
      className={cn('inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[12px] font-medium', size === 'sm' ? 'h-[22px]' : 'h-[26px] px-2.5', className)}
      style={{ background: `var(--${tone}-bg)`, color: `var(--${tone}-ink)`, ...style }}
      {...rest}
    >
      <span className="size-1.5 rounded-full" style={{ background: `var(--${tone})` }} aria-hidden />
      {children}
    </span>
  )
}

const STATUS: Record<Status, { label: string; tone: Tone }> = {
  working: { label: 'Working', tone: 'working' },
  needs_you: { label: 'Needs you', tone: 'needs' },
  failed: { label: 'Failed', tone: 'failed' },
  idle: { label: 'Idle', tone: 'idle' },
  done: { label: 'Done', tone: 'done' }
}

/** A session's status. `label` swaps the word ("Closed" for idle) without changing the colours. */
export function StatusPill({ status, label }: { status: Status; label?: string }) {
  const s = STATUS[status]
  return <Pill tone={s.tone}>{label ?? s.label}</Pill>
}

/** A small tag on a row: a risk flag, a scope, an estimate. */
export function Tag({ tone = 'neutral', className, children }: { tone?: 'neutral' | 'failed'; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex flex-none items-center rounded-md px-1.5 text-[12px] font-medium leading-5',
        tone === 'failed' ? 'bg-[var(--failed-bg)] text-[var(--failed-ink)]' : 'bg-well text-muted',
        className
      )}
    >
      {children}
    </span>
  )
}

export function CountBadge({ n, label, tone = 'neutral' }: { n: number; label: string; tone?: 'neutral' | 'needs' }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[12px] font-medium tabular-nums',
        tone === 'needs' ? 'bg-[var(--needs-bg)] text-[var(--needs-ink)]' : 'bg-well text-muted'
      )}
    >
      {n}
      <span className="sr-only"> {label}</span>
    </span>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 items-center rounded-md bg-surface px-1.5 font-sans text-[11px] font-medium text-muted ring-1 ring-inset ring-line">{children}</kbd>
}

/* ── Surfaces ────────────────────────────────────────────────────────────── */

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode; 'aria-labelledby'?: string }) {
  return (
    <section className={cn('rounded-card border border-line bg-surface', className)} {...rest}>
      {children}
    </section>
  )
}

/** Title, a count, and at most one quiet action. */
export function CardHeader({
  id,
  title,
  count,
  countLabel,
  countTone,
  action
}: {
  id: string
  title: string
  count?: number
  countLabel?: string
  countTone?: 'neutral' | 'needs'
  action?: ReactNode
}) {
  return (
    <header className="flex h-[52px] items-center gap-2 px-4">
      <h2 id={id} className="t-title">
        {title}
      </h2>
      {count !== undefined && <CountBadge n={count} label={countLabel ?? 'items'} tone={countTone} />}
      <div className="ml-auto">{action}</div>
    </header>
  )
}

/** Nothing here, said calmly: a quiet row under the card's rule, or centred when it is all a panel has. */
export function EmptyState({ icon: I, art, center, className, children }: { icon?: Icon; art?: string; center?: boolean; className?: string; children: ReactNode }) {
  return (
    <p className={cn('flex items-center text-[13px] leading-5 text-muted', art ? 'gap-4' : 'gap-2.5', center ? 'justify-center py-6 text-center' : cn('border-t border-rule px-4', art ? 'py-6' : 'py-5'), className)}>
      {/* Decorative: the sentence beside it says what the picture would. */}
      {art && <img src={art} alt="" width={56} height={56} draggable={false} className="size-14 flex-none rounded-2xl" />}
      {I && !art && <I size={16} strokeWidth={1.75} className="flex-none" aria-hidden />}
      <span className="min-w-0">{children}</span>
    </p>
  )
}

/** A placeholder block while something loads. Still for anyone who asked for less motion. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-lg bg-well motion-reduce:animate-none', className)} />
}

/** Inline code: a tag-radius chip in the mono face. */
export function Code({ className, ...rest }: ComponentProps<'code'>) {
  return <code className={cn('rounded-md bg-well px-1 py-px', className)} {...rest} />
}

/** Renders `code` spans from backticks; everything else stays text (no HTML, ADR-0010). */
export function Inline({ text }: { text: string }) {
  const parts = text.split('`')
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <Code key={i}>{p}</Code> : <span key={i}>{p}</span>))}
    </>
  )
}
