import { create } from 'zustand'

/** Which optional programs "Open in" offers. Asked of main once, early, so the menu never grows an item after it opens. */
interface ToolsStore {
  cursor: boolean
  asked: boolean
  /** Demo has no real PC behind it: the whole menu shows, and nothing it does runs. */
  load(demo: boolean): void
}

export const useTools = create<ToolsStore>((set, get) => ({
  cursor: false,
  asked: false,
  load: (demo) => {
    if (get().asked) return
    set({ asked: true })
    if (demo || !window.agentdeck) return set({ cursor: true })
    void window.agentdeck
      .getOpenTargets()
      .then((t) => set({ cursor: t.cursor }))
      .catch(() => undefined)
  }
}))
