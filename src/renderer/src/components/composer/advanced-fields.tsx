import { useId, useState, type ReactNode } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { FolderSearch, Plus, X } from 'lucide-react'
import { ADD_DIRS_MAX, TOOL_RULE, TOOL_RULES_MAX } from '@shared/console'
import { useUi } from '@/store'
import { pickFolder } from '@/lib/act'
import { projectName, recentProjects } from '@/lib/selectors'
import { setOptions } from '../console/store'
import { Button, cn, menuItem, menuLabel, menuPanel } from '../ui'

export const field = 'h-8 w-full rounded-lg bg-ground px-2.5 text-[13px] outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent'

export function Row({ label, help, htmlFor, children }: { label: string; help: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="t-label block">
        {label}
      </label>
      <p className="mb-1.5 text-pretty text-[12px] leading-4 text-muted">{help}</p>
      {children}
    </div>
  )
}

function Chips({ items, remove }: { items: string[]; remove(i: number): void }) {
  if (items.length === 0) return null
  return (
    <ul className="mb-1.5 flex flex-wrap gap-1.5">
      {items.map((t, i) => (
        <li key={t} className="inline-flex max-w-full items-center gap-1 rounded-md bg-well py-0.5 pl-2 pr-0.5 font-mono text-[12px]">
          <span className="truncate">{t}</span>
          <button type="button" aria-label={`Remove ${t}`} onClick={() => remove(i)} className="press grid size-5 flex-none place-items-center rounded text-muted hover:bg-active hover:text-ink">
            <X size={12} strokeWidth={1.75} />
          </button>
        </li>
      ))}
    </ul>
  )
}

/** A list of permission rules typed one by one: each is checked against the pattern main enforces (shared/console.ts TOOL_RULE). */
export function RuleField({ id, label, help, rules, suggestions, onChange }: { id: string; label: string; help: string; rules: string[]; suggestions: string[]; onChange(next: string[]): void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const listId = useId()
  const add = (): void => {
    const rule = text.trim()
    if (!rule) return
    if (!TOOL_RULE.test(rule)) return setError('That is not a tool rule. Examples: mcp__server__tool, Read, Bash(git status:*)')
    if (rules.length >= TOOL_RULES_MAX) return setError(`At most ${TOOL_RULES_MAX} rules.`)
    if (!rules.includes(rule)) onChange([...rules, rule])
    setText('')
    setError(null)
  }
  return (
    <Row label={label} help={help} htmlFor={id}>
      <Chips items={rules} remove={(i) => onChange(rules.filter((_, j) => j !== i))} />
      <div className="flex gap-1.5">
        <input
          id={id}
          list={listId}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            e.stopPropagation()
            add()
          }}
          placeholder="mcp__server__tool  or  Bash(git status:*)"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error !== null}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn(field, 'font-mono text-[12px]')}
        />
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <Button size="sm" onClick={add} aria-label={`Add to ${label.toLowerCase()}`}>
          <Plus size={13} strokeWidth={2} aria-hidden /> Add
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-[12px] leading-4 text-[var(--failed-ink)]">
          {error}
        </p>
      )}
    </Row>
  )
}

export function Folders({ dirs, cwd }: { dirs: string[]; cwd: string | null }) {
  const snapshot = useUi((s) => s.snapshot)
  const choices = recentProjects(snapshot, 12).filter((p) => p.cwd !== cwd && !dirs.includes(p.cwd))
  const add = (dir: string): void => dirs.includes(dir) || dirs.length >= ADD_DIRS_MAX ? undefined : setOptions({ addDirs: [...dirs, dir] })
  return (
    <Row label="More folders" help={`Folders Claude may also read and edit, besides the project (up to ${ADD_DIRS_MAX}). Only projects AgentDeck knows, or ones you browse to.`}>
      <Chips items={dirs.map(projectName)} remove={(i) => setOptions({ addDirs: dirs.filter((_, j) => j !== i) })} />
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button size="sm" aria-disabled={dirs.length >= ADD_DIRS_MAX} className="aria-disabled:opacity-50">
            <Plus size={13} strokeWidth={2} aria-hidden /> Add a folder
          </Button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="start" sideOffset={6} className={cn(menuPanel, 'w-72')}>
            <Menu.Label className={menuLabel}>Also allow</Menu.Label>
            {choices.map((p) => (
              <Menu.Item key={p.cwd} className={cn(menuItem, 'items-start')} onSelect={() => add(p.cwd)}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{p.name}</span>
                  <span className="block truncate text-[12px] text-muted">{p.cwd}</span>
                </span>
              </Menu.Item>
            ))}
            <Menu.Item className={menuItem} onSelect={() => void pickFolder().then((dir) => dir && add(dir))}>
              <FolderSearch size={14} strokeWidth={1.75} />
              Browse…
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    </Row>
  )
}

