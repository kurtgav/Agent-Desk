import { useState } from 'react'
import { useUi } from '@/store'
import { recentProjects } from '@/lib/selectors'
import { Composer } from '../composer/Composer'
import { announce, useTasks } from './tasksStore'

/**
 * One row to add a task: a title, the agent it is for (type @ or pick one), the project it belongs to, Add. It is the shared composer
 * in its `task` variant. Enter adds and keeps focus here, so a list of tasks can be typed in one go. The project starts as the most
 * recent one and stays what was last chosen; the agent is stored on the task and used when it is sent to an agent.
 */
export function QuickAdd() {
  const snapshot = useUi((s) => s.snapshot)
  const add = useTasks((s) => s.add)
  const [picked, setPicked] = useState<string | null | undefined>(undefined) // undefined: not chosen yet, so the most recent project
  const project = picked === undefined ? (recentProjects(snapshot, 1)[0]?.cwd ?? null) : picked

  return (
    <Composer
      variant="task"
      className="w-full"
      project={project}
      onProjectChange={setPicked}
      onAdd={async ({ title, project: cwd, role }) => {
        const task = await add({ title, project: cwd, ...(role ? { role } : {}) })
        if (!task) return false // the notice says why; the text stays so nothing typed is lost
        announce(`Added to To do: ${task.title}`)
        return true
      }}
    />
  )
}
