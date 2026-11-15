import { useEffect } from 'react'
import { create } from 'zustand'
import { TaskInput, type TaskPatch, type WorkTask } from '@shared/work'
import { useUi } from '@/store'
import { demoTasks } from '@/demo/work'
import { newlyDone } from '@/lib/work'
import { canFollowWork, useWorkPush } from './useWorkPush'

/**
 * The tasks on screen. Live they live in the collector and come through the bridge; in demo (or without a bridge)
 * they are seeded from demo/work.ts and kept in memory, so add, edit and delete work without touching anything.
 */

export type Load = 'loading' | 'ready' | 'failed'

const COULD_NOT = 'AgentDeck could not save the task.'

const isDemo = (): boolean => useUi.getState().snapshot.mode === 'demo' || !window.agentdeck
const fail = (text: string): null => {
  useUi.getState().notify(text, 'error')
  return null
}

let flip = false
/** A screen-reader line. The same words twice in a row would not be spoken again, so every other one ends in an invisible mark. */
export function announce(text: string): void {
  flip = !flip
  useUi.setState({ announcement: flip ? text : `${text}\u200b` })
}

let demoCount = 0
/** Counts live writes, so a read that started before one never replaces what it changed. */
let writes = 0

interface TaskStore {
  tasks: WorkTask[]
  load: Load
  /** A task whose check button takes focus when it next mounts: a task that changes lane remounts in the new one. */
  focus: string | null
  /** Tasks being sent to an agent right now, so a second click cannot start a second session. */
  sending: string[]
  /** The task deleted last, so Undo can bring it back. */
  removed: WorkTask | null
  refresh(): Promise<void>
  add(input: TaskInput): Promise<WorkTask | null>
  update(id: string, patch: TaskPatch): Promise<WorkTask | null>
  remove(id: string): Promise<boolean>
  undoRemove(): Promise<void>
  setFocus(id: string | null): void
  setSending(id: string, on: boolean): void
}

export const useTasks = create<TaskStore>((set, get) => {
  const replace = (task: WorkTask): void => set((s) => ({ tasks: s.tasks.map((t) => (t.id === task.id ? task : t)) }))
  return {
    tasks: [],
    load: 'loading',
    focus: null,
    sending: [],
    removed: null,
    setFocus: (focus) => set({ focus }),
    setSending: (id, on) => set((s) => ({ sending: on ? [...s.sending.filter((x) => x !== id), id] : s.sending.filter((x) => x !== id) })),

    async refresh() {
      if (isDemo()) {
        if (get().load !== 'ready') set({ tasks: demoTasks(useUi.getState().snapshot), load: 'ready' })
        return
      }
      if (get().load === 'failed') set({ load: 'loading' }) // Retry shows it is working
      const started = writes
      const list = await window.agentdeck!.listTasks().catch(() => null)
      if (list && writes !== started) return // a task changed while this was being read: that answer is the newer one
      // A failed read keeps what is on screen; only a first read that fails is an error state.
      if (!list) {
        if (get().load !== 'ready') set({ load: 'failed' })
        return
      }
      const before = get()
      set({ tasks: list, load: 'ready' })
      // A task that turned done with no write of ours behind it was finished by its agent.
      const agent = before.load === 'ready' ? newlyDone(before.tasks, list) : []
      if (agent.length) announce(`Done by its agent: ${agent.map((t) => t.title).join('; ')}`)
    },

    async add(input) {
      const parsed = TaskInput.safeParse(input)
      if (!parsed.success) return fail('Give the task a title of up to 200 characters.')
      if (isDemo()) {
        const task: WorkTask = { id: `demo-new-${++demoCount}`, ...parsed.data, status: 'todo', createdAt: Date.now(), doneAt: null, sessionName: null }
        set((s) => ({ tasks: [...s.tasks, task] }))
        return task
      }
      writes++
      const r = await window.agentdeck!.addTask(parsed.data).catch(() => ({ ok: false as const, error: COULD_NOT }))
      writes++
      if (!r.ok) return fail(r.error)
      set((s) => ({ tasks: [...s.tasks, r.task] }))
      return r.task
    },

    async update(id, patch) {
      const current = get().tasks.find((t) => t.id === id)
      if (!current) return null
      if (isDemo()) {
        const status = patch.status ?? current.status
        const task: WorkTask = { ...current, ...patch, doneAt: status === 'done' ? (current.status === 'done' ? current.doneAt : Date.now()) : null }
        replace(task)
        return task
      }
      writes++
      const r = await window.agentdeck!.updateTask(id, patch).catch(() => ({ ok: false as const, error: COULD_NOT }))
      writes++
      if (!r.ok) return fail(r.error)
      replace(r.task)
      return r.task
    },

    async remove(id) {
      const current = get().tasks.find((t) => t.id === id)
      if (!current) return false
      if (!isDemo()) {
        writes++
        const r = await window.agentdeck!.removeTask(id).catch(() => ({ ok: false as const, error: COULD_NOT }))
        writes++
        if (!r.ok) {
          fail(r.error)
          return false
        }
      }
      set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id), removed: current }))
      return true
    },

    async undoRemove() {
      const gone = get().removed
      if (!gone) return
      set({ removed: null })
      const back = await get().add({ title: gone.title, project: gone.project })
      if (!back) return set({ removed: gone }) // not restored: Undo stays on offer
      set({ focus: back.id })
      if (gone.status !== 'todo' || gone.sessionName) await get().update(back.id, { status: gone.status, sessionName: gone.sessionName })
    }
  }
})

/**
 * Keeps the Tasks page current: the tasks are read again whenever the collector reports a change (at most once a second),
 * and, where there is no such push, on the 30 s tick. Demo data is never read from anywhere.
 */
export function useTasksLive(): void {
  const refresh = useTasks((s) => s.refresh)
  const now = useUi((s) => s.now)
  const demo = useUi((s) => s.snapshot.mode === 'demo')
  const pushed = canFollowWork()
  const tick = pushed ? 0 : now // without the push, a new tick is a reason to read again
  useEffect(() => {
    void refresh()
  }, [refresh, tick])
  useWorkPush(refresh, pushed && !demo)
}
