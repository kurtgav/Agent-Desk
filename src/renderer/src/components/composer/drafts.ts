import { create } from 'zustand'

/**
 * Drafts nobody has sent yet. A new session's and each conversation's draft live in the Console's store (texts[NEW], texts[id]); a
 * task's lives here. All stay in memory only: what you typed is not written to disk (D-154), and it survives a trip to another page.
 */
interface Drafts {
  task: string
  setTask(text: string): void
}

export const useDrafts = create<Drafts>((set) => ({
  task: '',
  setTask: (task) => set({ task })
}))
