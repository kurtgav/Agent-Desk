import { create } from 'zustand'

/**
 * The menu's confirmations and name fields live apart from the menu and the row that opened them: a row can move (a pin
 * floats it up, a section regroups it) and a menu closes the moment an item is chosen, but the dialog must stay.
 * One host (Dialogs.tsx, mounted once in App) draws whichever is open.
 */
export type DialogState =
  | { kind: 'rename' | 'delete' | 'stop'; sessionId: string }
  /** `sessionId`: the session to file in the new section once it exists (from Move to section ▸ New section…). */
  | { kind: 'new-section'; sessionId: string | null }
  | { kind: 'rename-section' | 'delete-section'; section: string }

interface DialogsStore {
  dialog: (DialogState & { opener: HTMLElement | null }) | null
  /** `opener` gets focus back when the dialog closes. */
  show(dialog: DialogState, opener: HTMLElement | null): void
  close(): void
}

export const useDialogs = create<DialogsStore>((set) => ({
  dialog: null,
  show: (dialog, opener) => set({ dialog: { ...dialog, opener } }),
  close: () => set({ dialog: null })
}))
