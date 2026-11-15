import type { Variant } from './types'

/** What a task is created with: its title (the agent's mention taken out), the project, and the agent. */
export interface NewTask {
  title: string
  project: string | null
  role: string | null
}

interface Common {
  className?: string
}

/** Starts a conversation (the Console's `consoleStart`) and, from here, a background session (`claude --bg`). */
export interface NewSessionProps extends Common {
  variant?: 'new-session'
  /** The conversation was started. The window has already opened it; this is for anything the screen does besides. */
  onStarted?(id: string): void
}

/** A message in an open conversation (`consoleSend`); an ended one shows Resume instead of a box. */
export interface ReplyProps extends Common {
  variant: 'reply'
  conversationId: string
  onResume?(): void
}

/** The Tasks quick-add: one line, a project and one agent. The caller creates the task and says whether it did. */
export interface TaskProps extends Common {
  variant: 'task'
  project: string | null
  onProjectChange(cwd: string | null): void
  onAdd(task: NewTask): Promise<boolean>
}

export type ComposerProps = NewSessionProps | ReplyProps | TaskProps

export const variantOf = (p: ComposerProps): Variant => p.variant ?? 'new-session'
