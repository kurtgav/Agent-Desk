import { useEffect, useId, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown, ChevronRight, Cpu } from 'lucide-react'
import { MODEL_PATTERN, type ModelInfo } from '@shared/console'
import { Button, cn, menuPanel, menuSeparator } from '../ui'
import { loadModels, useModels } from './models-store'
import { MODEL_OPTIONS, modelLabel } from './options'

interface Row {
  value: string | null
  label: string
  hint: string
}

/** Default, then the models Claude Code puts first (its aliases), then the rest under More models; the aliases alone until it answers. */
export function rowsOf(list: ModelInfo[] | null): { main: Row[]; more: Row[] } {
  if (!list) return { main: MODEL_OPTIONS.map((o) => ({ value: o.value, label: o.label, hint: o.hint })), more: [] }
  const def = list.find((m) => m.value === 'default')
  const row = (m: ModelInfo): Row => ({ value: m.value, label: m.label, hint: m.description })
  const rest = list.filter((m) => m.value !== 'default')
  return {
    main: [{ value: null, label: 'Default', hint: def?.description || MODEL_OPTIONS[0]!.hint }, ...rest.filter((m) => !m.value.startsWith('claude-')).map(row)],
    more: rest.filter((m) => m.value.startsWith('claude-')).map(row)
  }
}

/**
 * The model for a new conversation or background task, as Claude Code's own picker offers it: Default, its main models, every other
 * model it lists under More models, or any full model id (the same ids `claude --model` takes, including the `[1m]` long-context
 * suffix). The choice is remembered (modelChoice.ts) by whoever uses it.
 */
export function ModelPicker({ value, onChange, align = 'start', className }: { value: string | null; onChange(model: string | null): void; align?: 'start' | 'end'; className?: string }) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const list = useModels((s) => s.list)
  const loading = useModels((s) => s.state === 'loading')
  const error = useModels((s) => s.error)
  const { main, more } = rowsOf(list)
  const listed = [...main, ...more]
  const inMore = more.some((r) => r.value === value)
  const [showMore, setShowMore] = useState(inMore)
  const label = listed.find((r) => r.value === value)?.label ?? modelLabel(value)
  const field = useId()
  const hint = useId()
  const moreId = useId()
  useEffect(() => {
    void loadModels()
  }, [])
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
        if (o) {
          void loadModels() // a no-op once it has answered; asks again if it could not
          setCustom(listed.some((r) => r.value === value) ? '' : (value ?? ''))
          setShowMore(inMore)
        }
      }}
    >
      <Popover.Trigger asChild>
        <Button variant="ghost" size="sm" className={cn('px-2.5 text-muted', className)} aria-label={`Model: ${label}. Change model`}>
          <Cpu size={14} strokeWidth={1.75} aria-hidden />
          <span className="max-w-40 truncate text-ink">{label}</span>
          <ChevronDown size={13} strokeWidth={1.75} aria-hidden />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align={align} sideOffset={6} collisionPadding={8} aria-label="Choose a model" className={cn(menuPanel, 'w-72 p-1')}>
          {/* Sized from the room Radix reports, less the custom-model form below it, so the form never leaves the window. */}
          <div className="max-h-[max(160px,calc(var(--radix-popover-content-available-height)-128px))] overflow-y-auto">
            <div role="radiogroup" aria-label="Model">
              {main.map((r) => (
                <ModelRow key={r.value ?? 'default'} row={r} checked={value === r.value} onPick={choose} />
              ))}
            </div>
            {more.length > 0 && (
              <>
                <div className={menuSeparator} />
                <button
                  type="button"
                  aria-expanded={showMore}
                  aria-controls={showMore ? moreId : undefined}
                  onClick={() => setShowMore((v) => !v)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] outline-none hover:bg-ground focus-visible:bg-ground"
                >
                  <ChevronRight size={14} strokeWidth={1.75} aria-hidden className={cn('flex-none transition-transform motion-reduce:transition-none', showMore && 'rotate-90')} />
                  <span className="flex-1">More models</span>
                  <span className="text-[12px] tabular-nums text-muted">{more.length}</span>
                </button>
                {showMore && (
                  <div id={moreId} role="radiogroup" aria-label="More models">
                    {more.map((r) => (
                      <ModelRow key={r.value ?? ''} row={r} checked={value === r.value} onPick={choose} />
                    ))}
                  </div>
                )}
              </>
            )}
            {loading && !list && (
              <p role="status" className="px-2 py-1.5 text-[12px] text-muted">
                Asking Claude Code for its models…
              </p>
            )}
            {error && !list && (
              <p role="alert" className="px-2 py-1.5 text-[12px] leading-4 text-[var(--failed-ink)]">
                {error} Showing the usual models; reopen this menu to try again.
              </p>
            )}
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

function ModelRow({ row, checked, onPick }: { row: Row; checked: boolean; onPick(m: string | null): void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={() => onPick(row.value)}
      className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-ground focus-visible:bg-ground"
    >
      <Check size={14} strokeWidth={1.75} className={cn('mt-0.5 flex-none', !checked && 'invisible')} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block">{row.label}</span>
        {row.hint && <span className="block text-[12px] leading-4 text-muted">{row.hint}</span>}
      </span>
    </button>
  )
}
