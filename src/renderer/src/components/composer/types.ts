/** Where the composer is used: it starts a conversation, answers in one, or adds a task. One component, three variants. */
export type Variant = 'new-session' | 'reply' | 'task'

/** A session takes a lead and at most four helpers (shared/console.ts `helpers`). A reply addresses up to the same many. A task has one agent. */
export const HELPERS_MAX = 4
export const MENTIONS_MAX: Record<Variant, number> = { 'new-session': 1 + HELPERS_MAX, reply: 1 + HELPERS_MAX, task: 1 }

/** What the composer needs to know about a role to name it, send it, or offer it to `claude --bg`. */
export interface RoleLookup {
  name(id: string): string
  /** The exact name for `claude --agent` when the role is installed in Claude Code, else null. */
  agent(id: string): string | null
}
