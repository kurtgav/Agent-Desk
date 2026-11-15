import { useMemo, useState } from 'react'
import { useUi } from '@/store'
import { buildLanes, summarize } from '@/lib/work'
import { Button, Card, CardHeader } from '../ui'
import { Lanes } from '../work/Lanes'
import { QuickAdd } from '../work/QuickAdd'
import type { Untrusted } from '../work/sendTask'
import { TodaySummary } from '../work/TodaySummary'
import { TrustAlert } from '../work/TrustAlert'
import { useTasks, useTasksLive } from '../work/tasksStore'
import { PageFrame } from './Page'
import { StateNote } from './kit'

/**
 * UI_MAP § Sidebar › Tasks: your own tasks and the agents' live work in one place. A task you send to an agent keeps
 * the session's status on its card, follows it, and is done when the agent finishes without a question (undoable); sessions nobody sent from here still show up in In progress, Waiting on you and Done today.
 */
export function TasksPage() {
  const sessions = useUi((s) => s.snapshot.sessions)
  const attention = useUi((s) => s.snapshot.attention)
  const now = useUi((s) => s.now)
  const tasks = useTasks((s) => s.tasks)
  const load = useTasks((s) => s.load)
  const refresh = useTasks((s) => s.refresh)
  const [trust, setTrust] = useState<Untrusted | null>(null)

  useTasksLive()

  const lanes = useMemo(() => buildLanes(tasks, sessions, now, attention), [tasks, sessions, now, attention])

  return (
    // The quick-add row is the toolbar: adding a task is what this page is for.
    <PageFrame page="tasks" lede="What you want done today, and what your agents are doing about it." filters={<QuickAdd />}>
      {trust && <TrustAlert trust={trust} onDismiss={() => setTrust(null)} />}
      <TodaySummary summary={summarize(lanes)} />
      {load === 'failed' ? (
        <Card aria-labelledby="tasks-failed">
          <CardHeader
            id="tasks-failed"
            title="Tasks"
            action={
              <Button size="sm" onClick={() => void refresh()}>
                Retry
              </Button>
            }
          />
          <StateNote tone="error" title="Your tasks could not be read" divided>
            AgentDeck could not read your tasks. Your agents' sessions are not affected.
          </StateNote>
        </Card>
      ) : (
        <Lanes lanes={lanes} now={now} loading={load === 'loading'} onTrust={setTrust} />
      )}
    </PageFrame>
  )
}
