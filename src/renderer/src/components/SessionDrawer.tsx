import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Tabs from '@radix-ui/react-tabs'
import { CircleCheck, Circle, Copy, FolderOpen, MonitorUp, RefreshCw, Square, SquareTerminal, X } from 'lucide-react'
import type { LogsResult, SessionAction } from '@shared/bridge'
import type { SessionDetail, TimelineEntry } from '@shared/detail'
import type { Session, Surface } from '@shared/snapshot'
import { useUi } from '@/store'
import { demoDetail } from '@/demo/snapshot'
import { openChangedFile, sessionAction } from '@/lib/act'
import { ago, clock } from '@/lib/format'
import { projectName } from '@/lib/selectors'
import { Avatar } from './Avatar'
import { Button, IconButton, Inline, StatusPill, cn } from './ui'

export const SURFACE: Record<Surface, string> = { cli: 'Terminal', desktop: 'Claude Desktop', vscode: 'VS Code', background: 'Background', sdk: 'SDK' }

type Load = { state: 'loading' } | { state: 'missing' } | { state: 'ready'; detail: SessionDetail }

/** A busy session emits several events a second; each read runs SQLite queries on the collector's hook thread. */
const REFETCH_MS = 500

/**
 * Live: refetched when the session's last event moves, at most every REFETCH_MS, so the timeline follows it.
 * A failed read (collector busy or restarting) keeps what is on screen. Demo: built from the snapshot.
 */
function useDetail(id: string | null): Load {
  const snapshot = useUi((s) => s.snapshot)
  const live = snapshot.sessions.find((s) => s.id === id)
  // Keyed by session, so switching rows never shows the previous session's detail.
  const [got, setGot] = useState<{ id: string; detail: SessionDetail | null } | null>(null)
  const last = useRef<{ id: string; at: number } | null>(null)
  const demo = snapshot.mode === 'demo' || !window.agentdeck
  const stamp = live?.lastEventAt

  useEffect(() => {
    if (!id || demo) return
    let current = true
    const wait = last.current?.id === id ? Math.max(0, last.current.at + REFETCH_MS - Date.now()) : 0
    const timer = setTimeout(() => {
      last.current = { id, at: Date.now() }
      void window.agentdeck!
        .getDetail(id)
        .catch(() => null)
        .then((detail) => {
          if (current) setGot((prev) => (detail === null && prev?.id === id && prev.detail ? prev : { id, detail }))
        })
    }, wait)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [id, demo, stamp])

  if (!id) return { state: 'loading' }
  if (demo) return live ? { state: 'ready', detail: demoDetail(live, snapshot) } : { state: 'missing' }
  if (got?.id !== id) return { state: 'loading' }
  if (!got.detail) return { state: 'missing' }
  // The snapshot's copy of the session is newer than the detail's between two fetches.
  return { state: 'ready', detail: live ? { ...got.detail, session: live } : got.detail }
}

export const DOT: Record<string, string> = {
  'tool.failed': 'var(--failed)',
  'turn.failed': 'var(--failed)',
  'permission.requested': 'var(--needs)',
  'permission.denied': 'var(--needs)',
  'turn.stopped': 'var(--done)',
  'session.ended': 'var(--done)'
}

function Timeline({ entries, now }: { entries: TimelineEntry[]; now: number }) {
  if (!entries.length) return <Empty>No events yet.</Empty>
  return (
    <ol className="flex flex-col">
      {entries.map((e) => (
        <li key={e.id} className="flex items-start gap-3 border-t border-rule py-2 first:border-t-0">
          <span className="mt-[7px] size-1.5 flex-none rounded-full" style={{ background: DOT[e.kind] ?? 'var(--idle)' }} aria-hidden />
          <p className="min-w-0 flex-1 text-[13px] leading-5 [overflow-wrap:anywhere]">
            {e.agentType && <span className="mr-1.5 rounded-md bg-well px-1.5 py-px text-[12px] font-medium">{e.agentType}</span>}
            <Inline text={e.summary} />
          </p>
          <time className="flex-none text-[12px] leading-5 tabular-nums text-muted" dateTime={new Date(e.ts).toISOString()}>
            {clock(e.ts, now)}
          </time>
        </li>
      ))}
    </ol>
  )
}

function Empty({ children }: { children: string }) {
  return <p className="py-6 text-center text-[13px] text-muted">{children}</p>
}

/** Read once when the tab opens; Refresh reads again. The previous output stays up while the next one loads. */
function Logs({ session }: { session: Session }) {
  const demo = useUi((s) => s.snapshot.mode === 'demo') || !window.agentdeck
  const [round, setRound] = useState(0)
  const [got, setGot] = useState<{ key: string; r: LogsResult } | null>(null)
  const key = `${session.id}:${round}`
  useEffect(() => {
    if (demo) return
    let current = true
    void window.agentdeck!
      .logs(session.id)
      .catch((): LogsResult => ({ ok: false, error: 'AgentDeck could not run claude logs.' }))
      .then((r) => {
        if (current) setGot({ key: `${session.id}:${round}`, r })
      })
    return () => {
      current = false
    }
  }, [demo, session.id, round])
  const busy = !demo && got?.key !== key
  const r: LogsResult | null = demo ? { ok: false, error: 'Demo data has no background session to read.' } : (got?.r ?? null)
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="text-[12px] text-muted">
          Output of <code className="rounded-[4px] bg-well px-1">claude logs {session.bgId}</code>
        </p>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setRound((n) => n + 1)} disabled={busy || demo}>
          <RefreshCw size={14} strokeWidth={1.75} className={cn(busy && 'animate-spin motion-reduce:animate-none')} />
          Refresh
        </Button>
      </div>
      {r === null ? (
        <Empty>Reading…</Empty>
      ) : r.ok ? (
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre rounded-tile bg-well p-3 font-mono text-[12px] leading-[18px]">{r.text || '(no output)'}</pre>
      ) : (
        <p className="rounded-tile bg-[var(--failed-bg)] p-3 text-[13px] text-[var(--failed-ink)]">{r.error}</p>
      )}
    </div>
  )
}

function StopButton({ session }: { session: Session }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button size="sm">
          <Square size={13} strokeWidth={1.75} />
          Stop
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/20" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[70] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-surface p-5 shadow-[0_16px_48px_rgb(0_0_0/0.16)]">
          <Dialog.Title className="text-[15px] font-semibold">Stop {session.name}?</Dialog.Title>
          <Dialog.Description className="mt-1 text-pretty text-[13px] text-muted">
            AgentDeck runs <code className="rounded-[4px] bg-well px-1">claude stop {session.bgId}</code>. The conversation is kept, and{' '}
            <code className="rounded-[4px] bg-well px-1">claude attach</code> resumes it later.
          </Dialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button size="sm">Cancel</Button>
            </Dialog.Close>
            <Dialog.Close asChild>
              <Button variant="primary" size="sm" onClick={() => void sessionAction('stop', session)}>
                Stop session
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Attach / Stop for background sessions, Desktop for Desktop ones, the terminal's folder for interactive ones (UI_MAP). */
function Actions({ session }: { session: Session }) {
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
      <Button size="sm" variant="ghost" onClick={() => run('copy-resume')}>
        <Copy size={14} strokeWidth={1.75} />
        Copy resume command
      </Button>
    </div>
  )
}

/**
 * While the drawer is open, Radix hides the rest of the window from screen readers, the bottom Notice included,
 * so action results are announced from in here too.
 */
function Announcer() {
  const notice = useUi((s) => s.notice)
  return (
    <>
      <div className="sr-only" aria-live="polite">{notice?.tone === 'ok' ? notice.text : ''}</div>
      <div className="sr-only" aria-live="assertive">{notice?.tone === 'error' ? notice.text : ''}</div>
    </>
  )
}

const tab =
  'h-7 rounded-full px-3 text-[13px] font-medium text-muted outline-none transition-[background-color,color] duration-150 hover:text-ink data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-[0_1px_2px_rgb(0_0_0/0.08)] focus-visible:ring-2 focus-visible:ring-accent'

function Body({ detail, now }: { detail: SessionDetail; now: number }) {
  const s = detail.session
  const interactive = (s.surface === 'cli' || s.surface === 'vscode') && s.bgId === null
  return (
    <>
      <header className="flex flex-col gap-3 border-b border-line px-5 pb-4 pt-5">
        <div className="flex items-start gap-3">
          <Avatar seed={s.name} size={36} className="flex-none" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Dialog.Title className="truncate text-[17px] font-semibold leading-6">{s.name}</Dialog.Title>
              <StatusPill status={s.status} />
            </div>
            <Dialog.Description className="text-[12px] leading-4 text-muted">
              {SURFACE[s.surface]} · {projectName(s.cwd)} · started {ago(now - s.startedAt)}
            </Dialog.Description>
          </div>
          <Dialog.Close asChild>
            <IconButton aria-label="Close" className="-mr-1.5 -mt-1">
              <X size={16} strokeWidth={1.75} />
            </IconButton>
          </Dialog.Close>
        </div>
        <code className="block truncate rounded-md bg-well px-2 py-1 text-[12px]" title={s.cwd}>
          {s.cwd || 'Folder unknown'}
        </code>
        {interactive && (
          <p className="text-[13px]">
            <span className="font-medium">{s.status === 'needs_you' ? 'Answer in its terminal.' : 'Runs in its own terminal.'}</span>{' '}
            <span className="text-muted">AgentDeck can't type into it.</span>
          </p>
        )}
        <Actions session={s} />
      </header>
      <Tabs.Root defaultValue="timeline" className="flex min-h-0 flex-1 flex-col px-5 pt-3">
        <Tabs.List aria-label="Session details" className="flex w-fit gap-0.5 rounded-full bg-well p-0.5">
          <Tabs.Trigger value="timeline" className={tab}>Timeline</Tabs.Trigger>
          <Tabs.Trigger value="plan" className={tab}>Plan</Tabs.Trigger>
          <Tabs.Trigger value="files" className={tab}>Files</Tabs.Trigger>
          <Tabs.Trigger value="final" className={tab}>Final message</Tabs.Trigger>
          {s.bgId && <Tabs.Trigger value="logs" className={tab}>Logs</Tabs.Trigger>}
        </Tabs.List>
        <Tabs.Content value="timeline" className="min-h-0 flex-1 overflow-y-auto py-3 outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
          <Timeline entries={detail.timeline} now={now} />
        </Tabs.Content>
        <Tabs.Content value="plan" className="min-h-0 flex-1 overflow-y-auto py-3 outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
          {detail.tasks.length ? (
            <ol className="flex flex-col gap-1.5">
              {detail.tasks.map((t) => (
                <li key={t.id} className="flex items-start gap-2 text-[13px] leading-5">
                  {t.done ? <CircleCheck size={16} strokeWidth={1.75} className="mt-0.5 flex-none text-[var(--done)]" aria-label="Done" /> : <Circle size={16} strokeWidth={1.75} className="mt-0.5 flex-none text-muted" aria-label="Open" />}
                  <span className={cn(t.done && 'text-muted')}>{t.subject}</span>
                </li>
              ))}
            </ol>
          ) : (
            <Empty>No plan. The session didn't create tasks.</Empty>
          )}
        </Tabs.Content>
        <Tabs.Content value="files" className="min-h-0 flex-1 overflow-y-auto py-3 outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
          {detail.files.length ? (
            <ul className="flex flex-col">
              {detail.files.map((f) => (
                <li key={f.path} className="border-t border-rule first:border-t-0">
                  <button type="button" onClick={() => void openChangedFile(f.path)} className="flex w-full items-center gap-3 rounded-md py-2 text-left hover:bg-ground" title={`Open ${f.path} in VS Code`}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] leading-5">{projectName(f.path)}</span>
                      <span className="block truncate text-[12px] leading-4 text-muted">{f.path}</span>
                    </span>
                    <span className="flex-none text-[12px] text-muted">{f.tool} · {ago(now - f.changedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No files changed by this session.</Empty>
          )}
        </Tabs.Content>
        <Tabs.Content value="final" className="min-h-0 flex-1 overflow-y-auto py-3 outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
          {detail.finalMessage ? (
            <p className="whitespace-pre-wrap rounded-tile bg-well p-3 text-[13px] leading-5 [overflow-wrap:anywhere]">{detail.finalMessage}</p>
          ) : (
            <Empty>No final message yet. It appears when a turn ends.</Empty>
          )}
        </Tabs.Content>
        {s.bgId && (
          <Tabs.Content value="logs" className="flex min-h-0 flex-1 flex-col py-3 outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
            <Logs session={s} />
          </Tabs.Content>
        )}
      </Tabs.Root>
    </>
  )
}

/** UI_MAP § Session drawer: opens from any session row or tile; Esc closes it. */
export function SessionDrawer() {
  const id = useUi((s) => s.drawer)
  const now = useUi((s) => s.now)
  const load = useDetail(id)
  // No Dialog.Trigger (rows, tiles and items open it), so Radix has nowhere to put focus back: remember the opener.
  const opener = useRef<HTMLElement | null>(null)
  return (
    <Dialog.Root open={id !== null} onOpenChange={(open) => !open && useUi.getState().openDrawer(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/10" />
        <Dialog.Content
          onOpenAutoFocus={() => {
            opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
          }}
          onCloseAutoFocus={(e) => {
            if (!opener.current?.isConnected) return
            e.preventDefault()
            opener.current.focus()
          }}
          className="fixed inset-y-0 right-0 z-50 flex w-[560px] max-w-[calc(100vw-48px)] flex-col border-l border-line bg-surface shadow-[0_16px_48px_rgb(0_0_0/0.12)] outline-none"
        >
          <Announcer />
          {load.state === 'ready' ? (
            <Body detail={load.detail} now={now} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <Dialog.Title className="text-[15px] font-semibold">{load.state === 'loading' ? 'Loading the session…' : 'Session not found'}</Dialog.Title>
              <Dialog.Description className="text-[13px] text-muted">
                {load.state === 'loading' ? 'Reading its timeline from the collector.' : 'AgentDeck has no record of it, or its collector is restarting.'}
              </Dialog.Description>
              <Dialog.Close asChild>
                <Button size="sm">Close</Button>
              </Dialog.Close>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
