import { useId, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown, Cpu } from 'lucide-react'
import { MODEL_PATTERN } from '@shared/console'
import { Button, cn, menuPanel } from '../ui'
import { MODEL_OPTIONS, modelLabel } from './options'

const isAlias = (m: string | null): boolean => MODEL_OPTIONS.some((o) => o.value === m)

/**
 * The model for a new conversation or background task: Default, the aliases Claude Code offers, or any full model id (the same ids
 * `claude --model` takes, including the `[1m]` long-context suffix). The choice is remembered (modelChoice.ts) by whoever uses it.
 */
export function ModelPicker({ value, onChange, align = 'start', className }: { value: string | null; onChange(model: string | null): void; align?: 'start' | 'end'; className?: string }) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const field = useId()
  const hint = useId()
  const trimmed = custom.trim()
  const valid = MODEL_PATTERN.test(trimmed)
  const choose = (m: string | null): void => {
    onChange(m)
    setOpen(false)
  }
  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setCustom(isAlias(value) ? '' : (value ?? ''))
      }}
    >
      <Popover.Trigger asChild>
        <Button variant="ghost" size="sm" className={cn('px-2.5 text-muted', className)} aria-label={`Model: ${modelLabel(value)}. Change model`}>
          <Cpu size={14} strokeWidth={1.75} aria-hidden />
          <span className="max-w-40 truncate text-ink">{modelLabel(value)}</span>
          <ChevronDown size={13} strokeWidth={1.75} aria-hidden />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align={align} sideOffset={6} aria-label="Choose a model" className={cn(menuPanel, 'w-72 p-1')}>
          <div role="radiogroup" aria-label="Model">
            {MODEL_OPTIONS.map((o) => (
              <button
                key={o.value ?? 'default'}
                type="button"
                role="radio"
                aria-checked={value === o.value}
                onClick={() => choose(o.value)}
                className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-ground focus-visible:bg-ground"
              >
                <Check size={14} strokeWidth={1.75} className={cn('mt-0.5 flex-none', value !== o.value && 'invisible')} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block">{o.label}</span>
                  <span className="block text-[12px] leading-4 text-muted">{o.hint}</span>
                </span>
              </button>
            ))}
          </div>
          <form
            className="mt-1 border-t border-rule px-2 pb-1.5 pt-2.5"
            onSubmit={(e) => {
              e.preventDefault()
              if (valid) choose(trimmed)
            }}
          >
            <label htmlFor={field} className="block text-[12px] font-medium text-muted">
              Custom model
            </label>
            <div className="mt-1 flex gap-1.5">
              <input
                id={field}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="claude-sonnet-5-5"
                spellCheck={false}
                autoComplete="off"
                aria-invalid={trimmed !== '' && !valid}
                aria-describedby={hint}
                className="h-8 min-w-0 flex-1 rounded-lg bg-ground px-2 font-mono text-[12px] outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent"
              />
              <Button type="submit" size="sm" aria-disabled={!valid} className="aria-disabled:opacity-40">
                Use
              </Button>
            </div>
            <p id={hint} className={cn('mt-1 text-[12px] leading-4', trimmed !== '' && !valid ? 'text-[var(--failed-ink)]' : 'text-muted')}>
              {trimmed !== '' && !valid ? 'Use letters, digits and . _ - [ ] only, starting with a letter or digit.' : 'Any model id Claude Code accepts, such as claude-opus-4-5[1m] for the long context.'}
            </p>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
