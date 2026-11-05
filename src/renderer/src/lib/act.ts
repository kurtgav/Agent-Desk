import type { ActionResult, SessionAction } from '@shared/bridge'
import type { Session } from '@shared/snapshot'
import { useUi } from '@/store'
import { projectName } from './selectors'

const DONE: Record<SessionAction, (s: Session) => string> = {
  attach: (s) => `Opened ${s.name} in a new terminal window.`,
  stop: (s) => `Asked ${s.name} to stop.`,
  'open-folder': (s) => `Opened ${projectName(s.cwd)} in VS Code.`,
  'open-desktop': (s) => `Opened ${s.name} in Claude Desktop.`,
  'copy-resume': () => 'Copied the resume command.'
}

const FAILED: ActionResult = { ok: false, error: 'AgentDeck could not run this.' }

/** Demo data has no real session behind it (ADR-0011), so nothing is run (D-035). */
function demo(): boolean {
  return useUi.getState().snapshot.mode === 'demo' || !window.agentdeck
}

export async function sessionAction(action: SessionAction, s: Session): Promise<void> {
  const { notify } = useUi.getState()
  if (demo()) return notify('Demo data: nothing was run.')
  const r = await window.agentdeck!.act(action, s.id).catch(() => FAILED)
  notify(r.ok ? DONE[action](s) : r.error, r.ok ? 'ok' : 'error')
}

export async function openChangedFile(path: string): Promise<void> {
  const { notify } = useUi.getState()
  if (demo()) return notify('Demo data: nothing was opened.')
  const r = await window.agentdeck!.openFile(path).catch(() => FAILED)
  notify(r.ok ? `Opened ${projectName(path)} in VS Code.` : r.error, r.ok ? 'ok' : 'error')
}
