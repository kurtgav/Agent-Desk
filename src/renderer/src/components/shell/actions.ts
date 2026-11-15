import { useUi } from '@/store'
import { requestNewConversation } from '../console/store'

/** Ctrl+N, the New session button and the palette: the new session screen, no role, empty draft, cursor in the composer. */
export function newSession(): void {
  useUi.getState().setRole(null)
  requestNewConversation()
}

/**
 * A click on an agent: the new session screen with that agent put in the store for the composer (`role`), remembered as recent.
 * The composer reads `role` and starts the session as that agent; nothing is sent until you write a message.
 */
export function startSessionAs(roleId: string): void {
  const ui = useUi.getState()
  ui.setRole(roleId)
  ui.rememberRole(roleId)
  requestNewConversation()
}
