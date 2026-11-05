import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import * as Popover from '@radix-ui/react-popover'
import { ArrowUp, AtSign, Check, ChevronDown, FolderSearch, LoaderCircle, Plus, X, Zap } from 'lucide-react'
import { PROMPT_MAX, type AgentDef } from '@shared/bridge'
import { useUi } from '@/store'
import { dispatchTask, loadAgents, pickFolder, runClaudeThere } from '@/lib/act'
import { projectName, recentProjects } from '@/lib/selectors'
import { Button, Hint, IconButton, cn } from './ui'

const EFFORT_LABEL = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' } as const
const menuContent = 'z-50 min-w-52 rounded-tile border border-line bg-surface p-1 text-[13px] shadow-[0_8px_24px_rgb(0_0_0/0.10)]'
const menuItem = 'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-ground'
const row = 'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-ground focus-visible:bg-ground'

/** There are 346 definitions on this machine; the list shows this many matches and typing narrows the rest. */
const SHOWN_MAX = 50

/** Read each time the picker opens, so a new definition shows up without a restart. */
function useAgents(open: boolean, cwd: string | null): AgentDef[] | null {
  const [got, setGot] = useState<{ cwd: string | null; list: AgentDef[] } | null>(null)
  useEffect(() => {
    if (!open) return
    let current = true
    void loadAgents(cwd).then((list) => {
      if (current) setGot({ cwd, list })
    })
    return () => {
      current = false
    }
  }, [open, cwd])
  return got && got.cwd === cwd ? got.list : null
}

/** Search box plus list, shared by "Agent ▾" (`--agent`) and "@" (a mention in the prompt). */
function AgentPicker(props: {
  label: string
  cwd: string | null
  current?: string | null
  withDefault?: boolean
  align: 'start' | 'end'
  onPick(name: string | null): void
  onCloseAutoFocus?(e: Event): void
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const agents = useAgents(open, props.cwd)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const needle = q.trim().toLowerCase()
  const matches = (agents ?? []).filter((a) => !needle || a.name.toLowerCase().includes(needle) || a.description.toLowerCase().includes(needle))
  const shown = matches.slice(0, SHOWN_MAX)

  const pick = (name: string | null): void => {
    props.onPick(name)
    setOpen(false)
    setQ('')
  }
  // Arrow keys walk the list; up from the first row goes back to the search box.
  const walk = (e: KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const rows = [...(list.current?.querySelectorAll('button') ?? [])]
    const i = rows.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === 'ArrowDown' ? i + 1 : i - 1
    if (next < 0) search.current?.focus()
    else rows[Math.min(next, rows.length - 1)]?.focus()
  }
  const check = (name: string | null) => <Check size={14} className={cn('mt-0.5 flex-none', props.current !== name && 'invisible')} />

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setQ('')
      }}
    >
      <Popover.Trigger asChild>{props.children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={props.align}
          sideOffset={6}
          aria-label={props.label}
          onKeyDown={walk}
          onCloseAutoFocus={props.onCloseAutoFocus}
          className={cn(menuContent, 'w-80 p-0')}
        >
          <div className="border-b border-line p-1.5">
            <input
              ref={search}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                // Enter takes the first match of what was typed; with nothing typed it picks nothing.
                if (needle && shown[0]) pick(shown[0].name)
              }}
              placeholder="Search subagents"
              aria-label="Search subagents"
              className="h-8 w-full rounded-md bg-ground px-2 text-[13px] outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
          <ul ref={list} className="max-h-72 overflow-y-auto p-1">
            {props.withDefault && !needle && (
              <li>
                <button type="button" className={row} aria-current={props.current === null || undefined} onClick={() => pick(null)}>
                  {check(null)}
                  <span>Default (no --agent)</span>
                </button>
              </li>
            )}
            {agents === null ? (
              <li className="px-2 py-1.5 text-muted">Reading subagents…</li>
            ) : shown.length === 0 ? (
              <li className="px-2 py-1.5 text-muted">{needle ? 'No subagent matches.' : 'No subagent definitions found.'}</li>
            ) : (
              shown.map((a) => (
                <li key={a.name}>
                  <button type="button" className={row} aria-current={props.current === a.name || undefined} onClick={() => pick(a.name)}>
                    {check(a.name)}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{a.name}</span>
                        {a.scope === 'project' && <span className="flex-none rounded-[4px] bg-well px-1 text-[11px] text-muted">project</span>}
                      </span>
                      {a.description && <span className="block truncate text-[12px] text-muted">{a.description}</span>}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
          {matches.length > shown.length && (
            <p className="border-t border-line px-3 py-1.5 text-[12px] text-muted">{matches.length - shown.length} more. Type to narrow the list.</p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/**
 * Dispatches a background session (brief § Composer): `claude --bg --name <auto> [--agent a] --effort e "<prompt>"`
 * in the chosen project. Main checks the folder and the subagent again before running anything.
 */
export function Composer() {
  const snapshot = useUi((s) => s.snapshot)
  const { effort, composerCwd, composerAgent, cycleEffort, setComposerCwd, setComposerAgent, notify } = useUi()
  // In the store, so a draft survives a visit to another page.
  const text = useUi((s) => s.composerText)
  const setText = useUi((s) => s.setComposerText)
  const [busy, setBusy] = useState(false)
  /** "Run claude there" is starting a terminal; a second click would open a second one. */
  const [opening, setOpening] = useState(false)
  const [untrusted, setUntrusted] = useState<{ cwd: string; error: string } | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const caret = useRef<number | null>(null)

  const projects = recentProjects(snapshot, 8)
  const project = projects.find((p) => p.cwd === composerCwd) ?? (composerCwd ? { cwd: composerCwd, name: projectName(composerCwd) } : projects[0])
  const choices = project && !projects.some((p) => p.cwd === project.cwd) ? [project, ...projects] : projects
  const blocked = busy ? 'Starting the task…' : !project ? 'Pick a project first' : !text.trim() ? 'Type a task first' : null
  const trust = untrusted && untrusted.cwd === project?.cwd ? untrusted : null

  const submit = async (): Promise<void> => {
    if (blocked || !project) return
    const sent = text
    setBusy(true)
    const r = await dispatchTask({ prompt: sent, cwd: project.cwd, agent: composerAgent, effort })
    setBusy(false)
    if (!r) return
    if (r.ok) {
      // Keep anything typed while the task was starting.
      if (useUi.getState().composerText === sent) setText('')
      setUntrusted(null)
      notify(`Started ${r.name} in ${project.name}.`)
    } else if (r.untrusted) setUntrusted({ cwd: project.cwd, error: r.error })
    else notify(r.error, 'error')
  }

  /** `@agent-<name>` at the caret (sub-agents § @-mention), with a space on each side. */
  const mention = (name: string | null): void => {
    if (!name) return
    const el = input.current
    const start = el?.selectionStart ?? text.length
    const before = text.slice(0, start)
    const token = `${before && !/\s$/.test(before) ? ' ' : ''}@agent-${name} `
    caret.current = start + token.length
    setText(before + token + text.slice(el?.selectionEnd ?? start))
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      className="rounded-card border border-line bg-surface px-4 pb-2 pt-3 transition-[border-color] duration-150 focus-within:border-accent"
    >
      <label htmlFor="composer-input" className="sr-only">
        Task for a new background session
      </label>
      <textarea
        id="composer-input"
        ref={input}
        rows={1}
        value={text}
        maxLength={PROMPT_MAX}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter is a new line; an IME composition keeps its own Enter.
          if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
          e.preventDefault()
          void submit()
        }}
        placeholder="Tell an agent what to build, fix or research…"
        className="block max-h-36 min-h-6 w-full resize-none bg-transparent text-[14px] leading-6 outline-none field-sizing-content placeholder:text-muted"
      />
      <div className="mt-1.5 flex items-center gap-1">
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button variant="ghost" size="sm" className="-ml-2 px-2 text-muted" aria-label={`Project: ${project?.name ?? 'none'}. Change project`}>
              <Plus size={16} strokeWidth={1.75} />
              {project ? <span className="text-ink">{project.name}</span> : <span>Choose a project</span>}
            </Button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content align="start" sideOffset={6} className={menuContent}>
              <Menu.Label className="px-2 py-1.5 text-[12px] text-muted">Run in project</Menu.Label>
              {choices.map((p) => (
                <Menu.Item key={p.cwd} className={menuItem} onSelect={() => setComposerCwd(p.cwd)}>
                  <Check size={14} className={p.cwd === project?.cwd ? '' : 'invisible'} />
                  <span>{p.name}</span>
                  <span className="ml-auto max-w-40 truncate text-[12px] text-muted">{p.cwd}</span>
                </Menu.Item>
              ))}
              {choices.length > 0 && <Menu.Separator className="my-1 h-px bg-line" />}
              <Menu.Item className={menuItem} onSelect={() => void pickFolder().then((dir) => dir && setComposerCwd(dir))}>
                <FolderSearch size={14} strokeWidth={1.75} />
                Browse…
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
        <AgentPicker
          label="Mention a subagent"
          cwd={project?.cwd ?? null}
          align="start"
          onPick={mention}
          onCloseAutoFocus={(e) => {
            if (caret.current === null) return
            e.preventDefault()
            const at = caret.current
            caret.current = null
            input.current?.focus()
            input.current?.setSelectionRange(at, at)
          }}
        >
          <IconButton aria-label="Mention a subagent">
            <AtSign size={16} strokeWidth={1.75} />
          </IconButton>
        </AgentPicker>

        <div className="ml-auto flex items-center gap-2">
          <AgentPicker label="Run as subagent" cwd={project?.cwd ?? null} current={composerAgent} withDefault align="end" onPick={setComposerAgent}>
            <Button variant="ghost" size="sm" className="px-2.5" aria-label={`Subagent: ${composerAgent ?? 'default'}. Change subagent`}>
              <span className="max-w-40 truncate">{composerAgent ?? 'Agent'}</span>
              <ChevronDown size={14} className="text-muted" />
            </Button>
          </AgentPicker>
          <Hint label="Effort for the new session (--effort). Click to change.">
            <Button size="sm" className="h-7 px-2.5 text-[12px]" onClick={cycleEffort} aria-label={`Effort: ${EFFORT_LABEL[effort]}. Change effort`}>
              <Zap size={13} strokeWidth={1.75} />
              {EFFORT_LABEL[effort]}
            </Button>
          </Hint>
          <Hint label={blocked ?? 'Start a background session (claude --bg)'}>
            <button
              type="submit"
              aria-label="Dispatch task"
              aria-disabled={blocked !== null}
              aria-busy={busy}
              className="grid size-8 place-items-center rounded-full bg-accent-fill text-white transition-[background-color,transform,opacity] duration-150 hover:bg-accent-fill-hover active:scale-[0.96] aria-disabled:opacity-40 aria-disabled:hover:bg-accent-fill aria-disabled:active:scale-100"
            >
              {busy ? <LoaderCircle size={16} strokeWidth={2} className="animate-spin motion-reduce:animate-none" /> : <ArrowUp size={16} strokeWidth={2} />}
            </button>
          </Hint>
        </div>
      </div>
      {trust && (
        <div role="alert" className="mb-1 mt-2 flex items-center gap-3 rounded-tile bg-[var(--failed-bg)] py-2 pl-3 pr-1.5 text-[13px] text-[var(--failed-ink)]">
          <p className="min-w-0 flex-1 text-pretty [overflow-wrap:anywhere]">{trust.error}</p>
          <Button
            size="sm"
            aria-busy={opening}
            className="aria-busy:opacity-60"
            onClick={() => {
              if (opening) return
              setOpening(true)
              void runClaudeThere(trust.cwd).finally(() => setOpening(false))
            }}
          >
            Run claude there
          </Button>
          <IconButton aria-label="Dismiss" className="text-[var(--failed-ink)]" onClick={() => setUntrusted(null)}>
            <X size={15} strokeWidth={1.75} />
          </IconButton>
        </div>
      )}
    </form>
  )
}
