import { useEffect, useRef, useState } from 'react'
import { FolderClosed, PanelRight, Square } from 'lucide-react'
import { ALIAS_MAX } from '@shared/session-meta'
import type { RoleSummary } from '@shared/roles'
import { PROVIDER_NAME } from '@shared/snapshot'
import { useUi } from '@/store'
import { sessionAction } from '@/lib/act'
import type { SessionEntry } from '@/lib/sessionList'
import { Avatar } from '../Avatar'
import { RoleEmoji } from '../roles/RoleEmoji'
import { formatCost } from '../console/format'
import { isRunning, stopConversation, useConsole } from '../console/store'
import { MoreButton, SessionMenu } from '../session-menu/SessionMenu'
import { toggleDetails, useDetailsOpen } from '../shell/useDetailsOpen'
import { Button, Hint, IconButton, Kbd, StatusPill, cn } from '../ui'
import { SURFACE } from './labels'

/**
 * The name, as a button that becomes a field: Enter keeps it (a local note, never Claude Code's file), Esc leaves it, an empty name
 * puts Claude Code's back. The same rename as the session menu's, one click closer.
 */
function EditableName({ entry }: { entry: SessionEntry }) {
  const [editing, setEditing] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing) input.current?.select()
  }, [editing])
  const commit = (value: string): void => {
    setEditing(false)
    const alias = value.trim()
    if (alias !== entry.name) useUi.getState().setSessionMeta(entry.session.id, { alias: alias && alias !== entry.session.name ? alias : null })
  }
  if (editing) {
    return (
      <input
        ref={input}
        defaultValue={entry.name}
        maxLength={ALIAS_MAX}
        aria-label="Session name"
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(e.currentTarget.value)
          if (e.key === 'Escape') {
            e.stopPropagation()
            setEditing(false)
          }
        }}
        className="t-title h-7 w-full min-w-0 rounded-md bg-well px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
    )
  }
  return (
    <Hint label="Click to rename. Only you see this name.">
      <button type="button" onClick={() => setEditing(true)} className="t-title -mx-1.5 max-w-full truncate rounded-md px-1.5 text-left outline-none hover:bg-active/60 focus-visible:ring-2 focus-visible:ring-accent">
        {entry.name}
      </button>
    </Hint>
  )
}

/** The agent it runs as, and the folder it works in (a click opens it in Explorer). */
function Chips({ entry, role }: { entry: SessionEntry; role: RoleSummary | undefined }) {
  const { session } = entry
  return (
    <>
      {role && (
        <span className="inline-flex h-6 flex-none items-center gap-1 rounded-full bg-well pl-1 pr-2 text-[12px] font-medium" title={`Runs as ${role.name}`}>
          <RoleEmoji role={role} size={16} />
          <span className="sr-only">Runs as </span>
          <span className="max-w-40 truncate">{role.name}</span>
        </span>
      )}
      {session.cwd && (
        <Hint label={`${session.cwd}. Click to open the folder.`}>
          <button
            type="button"
            onClick={() => void sessionAction('open-explorer', session)}
            className="press inline-flex h-6 min-w-0 max-w-48 items-center gap-1 rounded-full bg-well px-2 text-[12px] text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
          >
            <FolderClosed size={12} strokeWidth={1.75} aria-hidden className="flex-none" />
            <span className="truncate">{entry.project}</span>
          </button>
        </Hint>
      )}
    </>
  )
}

/**
 * The open session's header: its name, the agent and folder chips, its status and cost, and on the right Stop (while a turn runs), the
 * session menu (the same as a right-click on its row) and the Details toggle.
 */
export function SessionHeader({ entry, role }: { entry: SessionEntry; role: RoleSummary | undefined }) {
  const { session } = entry
  const detailsOpen = useDetailsOpen()
  const view = useConsole((s) => (entry.conv ? s.convs[entry.conv] : undefined))
  const running = isRunning(view)
  const cost = view && view.thread.totalCostUsd > 0 ? formatCost(view.thread.totalCostUsd) : ''
  return (
    <SessionMenu session={session}>
      <header className="group flex min-h-[60px] flex-none items-center gap-3 border-b border-line px-5 py-2.5">
        <Avatar seed={session.name} size={32} className="flex-none" />
        <div className="min-w-0 flex-1">
          <h2 className="min-w-0">
            <EditableName entry={entry} />
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Chips entry={entry} role={role} />
            {session.provider && session.provider !== 'claude' && (
              <span className="inline-flex h-6 max-w-48 flex-none items-center rounded-full bg-well px-2 text-[12px] text-muted" title={`Started in ${PROVIDER_NAME[session.provider]}${session.model ? `, with ${session.model}` : ''}`}>
                <span className="sr-only">Started in </span>
                <span className="truncate">{[PROVIDER_NAME[session.provider], session.model].filter(Boolean).join(' · ')}</span>
              </span>
            )}
            <StatusPill status={session.status} />
            {entry.origin === 'watching' && <span className="text-[12px] text-muted">Watching · {SURFACE[session.surface]}</span>}
            {cost && (
              <Hint label="Claude Code's own estimate. A subscription is not billed per call.">
                <span tabIndex={0} className="rounded-sm text-[12px] tabular-nums text-muted">
                  ≈ {cost}
                </span>
              </Hint>
            )}
          </div>
        </div>
        {running && entry.conv && (
          <Hint label={<>Stop this turn <Kbd>Esc</Kbd></>}>
            <Button onClick={() => void stopConversation(entry.conv!)}>
              <Square size={12} strokeWidth={2} aria-hidden /> Stop
            </Button>
          </Hint>
        )}
        <MoreButton session={session} className="opacity-100" />
        <Hint label={detailsOpen ? 'Hide details (Ctrl Alt D)' : 'Show details (Ctrl Alt D)'}>
          <IconButton aria-label="Details" aria-pressed={detailsOpen} aria-keyshortcuts="Control+Alt+D" onClick={toggleDetails} className={cn(detailsOpen && 'bg-active text-ink')}>
            <PanelRight size={16} strokeWidth={1.75} />
          </IconButton>
        </Hint>
      </header>
    </SessionMenu>
  )
}
