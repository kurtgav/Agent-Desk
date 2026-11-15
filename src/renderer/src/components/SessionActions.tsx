import { useRef } from 'react'
import { Copy, FolderOpen, MonitorUp, Square, SquareTerminal } from 'lucide-react'
import type { SessionAction } from '@shared/bridge'
import type { Session } from '@shared/snapshot'
import { useUi } from '@/store'
import { sessionAction } from '@/lib/act'
import { useDialogs } from './session-menu/dialogStore'
import { Button, Hint, IconButton } from './ui'

/** Opens the same confirmation the session menu's Stop opens (session-menu/Dialogs.tsx). */
function StopButton({ session }: { session: Session }) {
  return (
    <Button size="sm" onClick={(e) => useDialogs.getState().show({ kind: 'stop', sessionId: session.id }, e.currentTarget)}>
      <Square size={13} strokeWidth={1.75} />
      Stop
    </Button>
  )
}

/** Attach / Stop for background sessions, Desktop for Desktop ones, the terminal's folder for interactive ones (UI_MAP). */
export function Actions({ session }: { session: Session }) {
  const bg = session.bgId !== null
  // A second click while the first is still starting would open a second window.
  const busy = useRef(false)
  const run = (action: SessionAction): void => {
    if (busy.current) return
    busy.current = true
    void sessionAction(action, session).finally(() => {
      busy.current = false
    })
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {bg && (
        <Button variant="primary" size="sm" onClick={() => run('attach')}>
          <SquareTerminal size={14} strokeWidth={1.75} />
          Attach
        </Button>
      )}
      {bg && session.status !== 'done' && <StopButton session={session} />}
      {session.surface === 'desktop' && (
        <Button variant="primary" size="sm" onClick={() => run('open-desktop')}>
          <MonitorUp size={14} strokeWidth={1.75} />
          Open in Claude Desktop
        </Button>
      )}
      {session.cwd && (
        <Button size="sm" onClick={() => run('open-folder')}>
          <FolderOpen size={14} strokeWidth={1.75} />
          Open in VS Code
        </Button>
      )}
      {/* A utility, not a next step: an icon at the row's end, so the labelled buttons are what you do to the session. */}
      <Hint label="Copy resume command">
        <IconButton aria-label="Copy resume command" className="-mr-1.5 ml-auto" onClick={() => run('copy-resume')}>
          <Copy size={15} strokeWidth={1.75} />
        </IconButton>
      </Hint>
    </div>
  )
}

/**
 * While the drawer is open, Radix hides the rest of the window from screen readers, the bottom Notice included,
 * so action results are announced from in here too.
 */
export function Announcer() {
  const notice = useUi((s) => s.notice)
  return (
    <>
      <div className="sr-only" aria-live="polite">{notice?.tone === 'ok' ? notice.text : ''}</div>
      <div className="sr-only" aria-live="assertive">{notice?.tone === 'error' ? notice.text : ''}</div>
    </>
  )
}
