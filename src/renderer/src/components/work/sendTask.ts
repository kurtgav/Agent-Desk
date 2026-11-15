import type { WorkTask } from '@shared/work'
import { useUi } from '@/store'
import { dispatchTask } from '@/lib/act'
import { projectName } from '@/lib/selectors'
import { announce, useTasks } from './tasksStore'

/** A folder that needs `claude` run in it once before a session can start there (S6). */
export interface Untrusted {
  taskId: string
  cwd: string
  error: string
}

/**
 * Sends a task to an agent as the composer would: `claude --bg` with the title as the prompt, in the task's project,
 * at the effort the composer holds. On success the task moves to In progress and remembers the session's name, so its
 * live status sits on its card. Resolves `'started'`, the trust problem when the folder needs one (so the page can offer
 * the fix), or `'stopped'` when nothing started and the notice has said why (demo included).
 */
export async function sendTask(task: WorkTask, cwd: string): Promise<'started' | 'stopped' | Untrusted> {
  const { effort, notify } = useUi.getState()
  const { update, setSending } = useTasks.getState()
  setSending(task.id, true)
  try {
    const r = await dispatchTask({ prompt: task.title, cwd, agent: null, effort })
    if (!r) return 'stopped' // demo: dispatchTask has said nothing was sent
    if (r.ok) {
      const linked = await update(task.id, { status: 'doing', project: cwd, sessionName: r.name })
      if (!linked) {
        notify(`Started ${r.name}, but AgentDeck could not link the task to it. Find it under In progress.`, 'error')
        return 'stopped'
      }
      notify(`Started ${r.name} in ${projectName(cwd)}.`)
      announce(`Sent to an agent, now in progress: ${task.title}`)
      return 'started'
    }
    if (r.untrusted) return { taskId: task.id, cwd, error: r.error }
    notify(r.error, 'error')
    return 'stopped'
  } finally {
    setSending(task.id, false)
  }
}
