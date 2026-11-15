import type { Session } from '@shared/snapshot'
import { useUi } from '@/store'
import { startResume } from '../console/store'

/**
 * Fork continues a session in the Console as a copy: the next message starts `claude -p … --resume <id> --fork-session`
 * (flag checked on 2.1.323), which gives the copy its own session id and leaves the original as it is.
 */
export function forkSession(session: Session, name: string): void {
  useUi.getState().go({ page: 'console' })
  startResume({ sessionId: session.id, name, cwd: session.cwd, fork: true })
}
