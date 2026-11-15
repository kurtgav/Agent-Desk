import type { Surface } from '@shared/snapshot'

/** Where a session runs, in words. `sdk` is a session AgentDeck started itself. */
export const SURFACE: Record<Surface, string> = { cli: 'Terminal', desktop: 'Claude Desktop', vscode: 'VS Code', background: 'Background', sdk: 'AgentDeck' }

/** The dot beside a timeline event: the colour is the event's weight, the words beside it say the rest. */
export const DOT: Record<string, string> = {
  'tool.failed': 'var(--failed)',
  'turn.failed': 'var(--failed)',
  'permission.requested': 'var(--needs)',
  'permission.denied': 'var(--needs)',
  'turn.stopped': 'var(--done)',
  'session.ended': 'var(--done)'
}
