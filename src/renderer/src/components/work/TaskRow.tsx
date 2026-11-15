import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { TASK_TITLE_MAX } from '@shared/work'
import { useUi } from '@/store'
import { ago } from '@/lib/format'
import { doneByAgent, type TaskItem } from '@/lib/work'
import { projectName } from '@/lib/selectors'
import { cn } from '../ui'
import { Chip } from '../pages/kit'
import { useDisplayName } from '../session-menu/hooks'
import { LiveLine } from './LiveLine'
import type { Untrusted } from './sendTask'
import { TaskActions } from './TaskActions'
import { announce, useTasks } from './tasksStore'

function Meta({ item, now, onUndo }: { item: TaskItem; now: number; onUndo(): void }) {
  const open = useUi((s) => s.openSession)
  const { task, session } = item
  const where = task.project ? projectName(task.project) : 'No project'
  const byAgent = doneByAgent(task, session)
  const name = useDisplayName(session)
  return (
    <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 text-[12px] leading-5 tabular-nums text-muted">
      <Chip title={task.project ?? undefined} className="max-w-[11rem]">
        {where}
      </Chip>
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {task.status === 'done' ? (
          <>
            {byAgent ? 'Done by its agent' : 'Done'} {ago(now - (task.doneAt ?? task.createdAt)).toLowerCase()}
            {byAgent && (
              <>
                {' · '}
                <button
                  type="button"
                  onClick={onUndo}
                  aria-label={`Undo: move back to In progress: ${task.title}`}
                  className="rounded-md font-medium text-ink outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Undo
                </button>
              </>
            )}
          </>
        ) : session ? (
          <button type="button" onClick={() => open(session.id)} className="rounded-md font-medium text-ink outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent">
            {name}
          </button>
        ) : task.sessionName ? (
          <>{task.sessionName} (no longer listed)</>
        ) : (
          <>Added {ago(now - task.createdAt).toLowerCase()}</>
        )}
      </span>
    </p>
  )
}

/**
 * One of your tasks. The checkbox marks it done (or brings it back); a task sent to an agent shows that session's live
 * status; Start, Send and the menu are on the right. Double-click the title, or Edit title, to rename it in place.
 */
export function TaskRow({ item, now, onTrust }: { item: TaskItem; now: number; onTrust(t: Untrusted): void }) {
  const { task, session } = item
  const done = task.status === 'done'
  const update = useTasks((s) => s.update)
  const setFocus = useTasks((s) => s.setFocus)
  const check = useRef<HTMLButtonElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.title)
  // Ending an edit moves focus, which blurs the field while this render's `editing` is still true: one guard, one save.
  const settled = useRef(true)
  // Whether the field takes focus as it appears: not from the menu, which hands focus over itself once it has closed.
  const autofocus = useRef(true)

  // A task that changed lane is a new row; the one just used gets focus back so the keyboard keeps its place.
  useEffect(() => {
    if (useTasks.getState().focus !== task.id) return
    check.current?.focus()
    setFocus(null)
  }, [task.id, setFocus])

  const focusField = (): void => {
    field.current?.focus()
    field.current?.select()
  }
  useEffect(() => {
    if (editing && autofocus.current) focusField()
  }, [editing])

  const toggle = (): void => {
    setFocus(task.id)
    void update(task.id, { status: done ? (task.sessionName ? 'doing' : 'todo') : 'done' }).then((t) => {
      if (!t) return setFocus(null)
      announce(done ? `Moved back to ${task.sessionName ? 'In progress' : 'To do'}: ${task.title}` : `Marked done: ${task.title}`)
    })
  }

  const beginEdit = (fromMenu: boolean): void => {
    autofocus.current = !fromMenu
    settled.current = false
    setDraft(task.title)
    setEditing(true)
  }

  const finish = (save: boolean, refocus: boolean): void => {
    if (settled.current) return
    settled.current = true
    const title = draft.trim()
    setEditing(false)
    if (save && title && title !== task.title) void update(task.id, { title })
    else setDraft(task.title)
    if (refocus) check.current?.focus()
  }

  return (
    <li data-task={task.id} className="border-t border-rule px-4 py-2.5">
      <div className="group relative -mx-2 flex items-start gap-3 rounded-tile px-2 transition-[background-color] duration-150 hover:bg-hover">
        {/* A 28 px slot like an agent's avatar, so every row's text starts on one edge; the circle inside is 20 px. */}
        <button
          ref={check}
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={task.title}
          onClick={toggle}
          className="press -mt-1 grid size-7 flex-none place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span
            className={cn(
              'grid size-5 place-items-center rounded-full border text-surface transition-[background-color,border-color,color] duration-150',
              done ? 'border-transparent bg-[var(--done-ink)]' : 'border-muted/70 bg-surface text-transparent group-hover:border-ink'
            )}
          >
            <Check size={12} strokeWidth={2.5} aria-hidden />
          </span>
        </button>
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              ref={field}
              value={draft}
              maxLength={TASK_TITLE_MAX}
              aria-label="Task title"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => finish(true, false)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || (e.key !== 'Enter' && e.key !== 'Escape')) return
                // finish() moves focus to the checkbox; without this the same Enter would then press it (it would mark the task done).
                e.preventDefault()
                finish(e.key === 'Enter', true)
              }}
              className="-my-0.5 h-7 w-full rounded-md bg-well px-2 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          ) : (
            <p
              title={task.title}
              onDoubleClick={() => beginEdit(false)}
              className={cn('line-clamp-2 text-[14px] font-medium leading-5 [overflow-wrap:anywhere]', done && 'text-muted line-through decoration-control')}
            >
              {task.title}
            </p>
          )}
          <Meta item={item} now={now} onUndo={toggle} />
          {session && !done && <LiveLine session={session} reason={item.reason} />}
        </div>
        {/* Out of sight until the row is hovered or holds focus (or a menu from it is open), at no cost to the layout. */}
        <div className="-mt-1.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 has-[[aria-busy=true]]:opacity-100 has-[[aria-expanded=true]]:opacity-100 [@media(hover:none)]:opacity-100">
          <TaskActions
            task={task}
            onEdit={() => beginEdit(true)}
            focusEditor={focusField}
            onTrust={onTrust}
          />
        </div>
      </div>
    </li>
  )
}
