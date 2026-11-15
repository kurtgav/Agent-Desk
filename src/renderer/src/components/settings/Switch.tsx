import { useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../ui'

/**
 * A real checkbox with `role="switch"`: focus, Space and the label click come from the platform. Off is the muted grey (5.3:1
 * on the card, so the control is visible as such), on is the ink, and the thumb travels 16 px; under reduced motion the
 * global rule drops the transition.
 */
export function Switch({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'>) {
  return (
    <input
      type="checkbox"
      role="switch"
      className={cn(
        'relative h-5 w-9 flex-none cursor-pointer appearance-none rounded-full bg-muted transition-colors duration-150 ease-out',
        'after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-surface after:shadow-[0_1px_2px_rgb(0_0_0/0.2)] after:transition-transform after:duration-150 after:ease-out',
        'checked:bg-ink checked:after:translate-x-4 disabled:cursor-default disabled:opacity-50',
        className
      )}
      {...rest}
    />
  )
}

interface SwitchRowProps {
  title: string
  help: ReactNode
  checked: boolean
  disabled?: boolean
  onChange(on: boolean): void
}

/** One setting that is on or off: the whole row is the click target, the title names the switch and the help describes it. */
export function SwitchRow({ title, help, checked, disabled, onChange }: SwitchRowProps) {
  const id = useId()
  return (
    <label className={cn('flex items-center gap-6 border-t border-rule px-4 py-3', disabled ? 'cursor-default' : 'cursor-pointer')}>
      <span className="min-w-0 flex-1">
        <span id={`${id}-title`} className="block text-[14px] font-medium leading-5">
          {title}
        </span>
        <span id={`${id}-help`} className="mt-0.5 block text-pretty text-[12px] leading-4 text-muted">
          {help}
        </span>
      </span>
      <Switch checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`} />
    </label>
  )
}
