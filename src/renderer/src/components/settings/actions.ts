import type { ActionResult } from '@shared/bridge'
import { useUi } from '@/store'

/** Opens the folder the Daily report is written to, in Explorer. */
export async function openReportFolder(): Promise<void> {
  const { notify } = useUi.getState()
  if (!window.agentdeck) return notify('The report folder opens from the AgentDeck window.', 'error')
  const failed: ActionResult = { ok: false, error: 'AgentDeck could not open the report folder.' }
  const r = await window.agentdeck.openEodFolder().catch(() => failed)
  if (!r.ok) notify(r.error, 'error')
}

/** The Settings page at one of its sections (the palette and the ⋯ menu use this for Diagnostics). */
export function openSettings(section?: 'diagnostics' | 'claude'): void {
  useUi.getState().go(section ? { page: 'settings', query: section } : { page: 'settings' })
}
