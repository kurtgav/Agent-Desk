import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import * as Tooltip from '@radix-ui/react-tooltip'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Status } from '@shared/snapshot'

export function cn(...v: ClassValue[]): string {
  return twMerge(clsx(v))
}

const press = 'transition-[transform,background-color,border-color,color] duration-150 ease-out active:scale-[0.96]'

const VARIANTS = {
  primary: 'bg-accent-fill text-white hover:bg-accent-fill-hover',
  secondary: 'border border-control bg-surface text-ink hover:bg-ground',
  ghost: 'text-ink hover:bg-active'
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
        'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium',
        size === 'sm' ? 'h-[30px] px-3.5 text-[13px]' : 'h-8 px-3.5 text-[13px]',
        VARIANTS[variant],
        press,
        className
      )}
      {...rest}
    />
  )
}

export function IconButton({ className, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn('inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-active hover:text-ink', press, className)}
      {...rest}
    />
  )
}

export function Hint({ label, children, side = 'bottom' }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'right' }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side={side} sideOffset={6} className="z-50 rounded-md bg-ink px-2 py-1 text-[12px] leading-4 text-white shadow-[0_4px_12px_rgb(0_0_0/0.12)]">
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export type Milestone = 'M4' | 'M5'

/**
 * A control whose backing arrives in a later milestone (D-033). It keeps its look, explains
 * itself in a tooltip, and does nothing. `data-pending` lets the M5 gate assert none are left.
 */
export function pending(m: Milestone) {
  return {
    'aria-disabled': true as const,
    'data-pending': m,
    onClick: (e: MouseEvent) => e.preventDefault()
  }
}

export const PENDING_LABEL: Record<Milestone, string> = {
  M4: 'Arrives with lists and actions (M4)', // D-055
  M5: 'Arrives with settings and diagnostics (M5)'
}

const STATUS: Record<Status, { label: string; dot: string; bg: string; ink: string }> = {
  working: { label: 'Working', dot: 'var(--working)', bg: 'var(--working-bg)', ink: 'var(--working-ink)' },
  needs_you: { label: 'Needs you', dot: 'var(--needs)', bg: 'var(--needs-bg)', ink: 'var(--needs-ink)' },
  failed: { label: 'Failed', dot: 'var(--failed)', bg: 'var(--failed-bg)', ink: 'var(--failed-ink)' },
  idle: { label: 'Idle', dot: 'var(--idle)', bg: 'var(--idle-bg)', ink: 'var(--idle-ink)' },
  done: { label: 'Done', dot: 'var(--done)', bg: 'var(--done-bg)', ink: 'var(--done-ink)' }
}

export function StatusPill({ status }: { status: Status }) {
  const s = STATUS[status]
  return (
    <span
      className="inline-flex h-[22px] flex-none items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[12px] font-medium"
      style={{ background: s.bg, color: s.ink }}
    >
      <span className="size-1.5 rounded-full" style={{ background: s.dot }} aria-hidden />
      {s.label}
    </span>
  )
}

export function CountBadge({ n, label }: { n: number; label: string }) {
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-well px-1.5 text-[12px] font-medium tabular-nums text-muted">
      {n}
      <span className="sr-only"> {label}</span>
    </span>
  )
}

/** A menu row whose backing arrives later (D-033): focusable, explains itself, does nothing. */
export function PendingMenuItem({ label, m, icon }: { label: string; m: Milestone; icon?: ReactNode }) {
  return (
    <Menu.Item
      onSelect={(e) => e.preventDefault()}
      aria-disabled
      data-pending={m}
      className="flex cursor-default items-start gap-2 rounded-md px-2 py-1.5 text-muted outline-none data-[highlighted]:bg-ground"
    >
      {icon}
      <span className="flex flex-col">
        <span className="text-ink">{label}</span>
        <span className="text-[12px]">{PENDING_LABEL[m]}</span>
      </span>
    </Menu.Item>
  )
}

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode; 'aria-labelledby'?: string }) {
  return (
    <section className={cn('rounded-card border border-line bg-surface', className)} {...rest}>
      {children}
    </section>
  )
}

export function CardHeader({ id, title, count, countLabel, action }: { id: string; title: string; count?: number; countLabel?: string; action?: ReactNode }) {
  return (
    <header className="flex h-[52px] items-center gap-2 px-4">
      <h2 id={id} className="text-[15px] font-semibold">
        {title}
      </h2>
      {count !== undefined && <CountBadge n={count} label={countLabel ?? 'items'} />}
      <div className="ml-auto">{action}</div>
    </header>
  )
}

/** Renders `code` spans from backticks; everything else stays text (no HTML, ADR-0010). */
export function Inline({ text }: { text: string }) {
  const parts = text.split('`')
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <code key={i} className="rounded-[4px] bg-well px-1 py-px">
            {p}
          </code>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  )
}
