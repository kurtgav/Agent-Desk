import { useRef } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { Ellipsis, LoaderCircle, Pencil, Play, Send, Trash2 } from 'lucide-react'
import type { WorkTask } from '@shared/work'
import { Hint, IconButton, cn, menuItem, menuPanel } from '../ui'
import { ProjectMenu } from './ProjectMenu'
import { sendTask, type Untrusted } from './sendTask'
import { announce, useTasks } from './tasksStore'

/**
 * What can be done to a task. Always at hand: Send to an agent (until the task has a session), which asks for a project
 * first when there is none, with the composer's own menu; and a menu with Start (To do only), Edit title and Delete.
 */
export function TaskActions({ task, onEdit, focusEditor, onTrust }: { task: WorkTask; onEdit(): void; focusEditor(): void; onTrust(t: Untrusted): void }) {
  const update = useTasks((s) => s.update)
  const remove = useTasks((s) => s.remove)
  const setFocus = useTasks((s) => s.setFocus)
  const sending = useTasks((s) => s.sending.includes(task.id))
  // Start, Edit and Delete put focus somewhere of their own; the menu must not hand it back to its button. A ref, not
  // state: the menu closes in the same render that would update state, and keeps the handler from the one before.
  const keepFocus = useRef(false)
  // The title field can take focus only once the menu has let go of it: while open, the menu pulls focus back inside.
  const afterClose = useRef<(() => void) | null>(null)

  const send = (cwd: string): void => {
    if (sending) return
    setFocus(task.id) // the task moves lane when it starts, and its check button takes focus there
    void sendTask(task, cwd).then((r) => {
      if (r === 'started') return
      setFocus(null)
      if (r !== 'stopped') onTrust(r)
    })
  }
  const canSend = task.status !== 'done' && !task.sessionName
  const sendButton = (
    <IconButton
      aria-label={`Send to an agent: ${task.title}`}
      aria-busy={sending}
      onClick={task.project ? () => send(task.project!) : undefined}
    >
      {sending ? <LoaderCircle size={15} strokeWidth={1.75} className="animate-spin motion-reduce:animate-none" /> : <Send size={15} strokeWidth={1.75} />}
    </IconButton>
  )

  return (
    <div className="flex flex-none items-center">
      {canSend &&
        (task.project ? (
          <Hint label="Send to an agent">{sendButton}</Hint>
        ) : (
          <ProjectMenu current={null} hint="Pick a project, then send to an agent" onPick={(cwd) => cwd && send(cwd)}>
            {sendButton}
          </ProjectMenu>
        ))}
      <Menu.Root>
        <Hint label="More">
          <Menu.Trigger asChild>
            <IconButton aria-label={`More: ${task.title}`}>
              <Ellipsis size={16} strokeWidth={1.75} />
            </IconButton>
          </Menu.Trigger>
        </Hint>
        <Menu.Portal>
          <Menu.Content
            align="end"
            sideOffset={6}
            className={cn(menuPanel, 'min-w-40')}
            onCloseAutoFocus={(e) => {
              if (!keepFocus.current) return
              keepFocus.current = false
              e.preventDefault()
              const next = afterClose.current
              afterClose.current = null
              next?.()
            }}
          >
            {task.status === 'todo' && (
              <Menu.Item
                className={menuItem}
                onSelect={() => {
                  keepFocus.current = true
                  setFocus(task.id)
                  void update(task.id, { status: 'doing' }).then((t) => {
                    if (t) return announce(`Started, now in progress: ${task.title}`)
                    setFocus(null)
                    keepFocus.current = false
                  })
                }}
              >
                <Play size={14} strokeWidth={1.75} />
                Start
              </Menu.Item>
            )}
            <Menu.Item
              className={menuItem}
              onSelect={() => {
                keepFocus.current = true
                afterClose.current = focusEditor
                onEdit()
              }}
            >
              <Pencil size={14} strokeWidth={1.75} />
              Edit title
            </Menu.Item>
            <Menu.Item
              className={menuItem}
              onSelect={() => {
                keepFocus.current = true
                void remove(task.id).then((gone) => {
                  if (gone) announce(`Deleted: ${task.title}. Undo is next to the summary.`)
                  else keepFocus.current = false
                })
              }}
            >
              <Trash2 size={14} strokeWidth={1.75} />
              Delete
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    </div>
  )
}
