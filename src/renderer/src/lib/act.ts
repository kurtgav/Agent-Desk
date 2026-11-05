import type { ActionResult, AgentDef, DispatchRequest, DispatchResult, SessionAction } from '@shared/bridge'
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

/** The composer's task (brief § Composer). Null in demo, where nothing is dispatched. */
export async function dispatchTask(req: DispatchRequest): Promise<DispatchResult | null> {
  if (demo()) {
    useUi.getState().notify('Demo data: nothing was dispatched.')
    return null
  }
  return window.agentdeck!.dispatch(req).catch((): DispatchResult => ({ ok: false, error: 'AgentDeck could not start the task.', untrusted: false }))
}

/** Browse…: a folder outside the recent projects. Null when cancelled, and in demo. */
export async function pickFolder(): Promise<string | null> {
  if (demo()) {
    useUi.getState().notify('Demo data: nothing was opened.')
    return null
  }
  return window.agentdeck!.chooseFolder().catch(() => null)
}

/** The fix the CLI asks for when a folder isn't trusted yet (S6). */
export async function runClaudeThere(cwd: string): Promise<void> {
  const { notify } = useUi.getState()
  if (demo()) return notify('Demo data: nothing was run.')
  const r = await window.agentdeck!.runClaudeIn(cwd).catch(() => FAILED)
  notify(r.ok ? `Opened claude in ${projectName(cwd)}. Accept its trust prompt there, then send the task again.` : r.error, r.ok ? 'ok' : 'error')
}

/** Live: the definitions in ~/.claude/agents and the project's .claude/agents. Demo: the demo's recent agent types. */
export async function loadAgents(cwd: string | null): Promise<AgentDef[]> {
  if (demo()) return useUi.getState().snapshot.recentAgentTypes.map((name) => ({ name, description: '', model: null, scope: 'user' }))
  return window.agentdeck!.listAgents(cwd).catch(() => [])
}

export async function openChangedFile(path: string): Promise<void> {
  const { notify } = useUi.getState()
  if (demo()) return notify('Demo data: nothing was opened.')
  const r = await window.agentdeck!.openFile(path).catch(() => FAILED)
  notify(r.ok ? `Opened ${projectName(path)} in VS Code.` : r.error, r.ok ? 'ok' : 'error')
}
