import { useEffect, useRef, useState, type ComponentType } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Popover from '@radix-ui/react-popover'
import { CircleX, Eye, Hourglass, MessageCircle, ShieldAlert, Terminal } from 'lucide-react'
import type { Verdict } from '@shared/bridge'
import type { AttentionItem, AttentionKind, Session } from '@shared/snapshot'
import { useUi } from '@/store'
import { answerItem, sessionAction } from '@/lib/act'
import { ago } from '@/lib/format'
import { byPriority, projectName, sessionIndex, waitingWithoutItem } from '@/lib/selectors'
import { Avatar } from './Avatar'
import { Button, Card, CardHeader, Inline, cn } from './ui'

const MAX_ROWS = 3 // the reference shows three; the rest sit behind "See all"

type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

/** Kind icon and the status colour it borrows (UI_MAP § Needs you). */
const KIND: Record<AttentionKind, { icon: Icon; tone: 'needs' | 'failed' | 'idle' | 'working'; label: string }> = {
  approval: { icon: ShieldAlert, tone: 'needs', label: 'Approval' },
  question: { icon: MessageCircle, tone: 'needs', label: 'Question' },
  failed: { icon: CircleX, tone: 'failed', label: 'Failed' },
  stuck: { icon: Hourglass, tone: 'idle', label: 'Stuck' },
  review: { icon: Eye, tone: 'working', label: 'Ready for review' }
}

function ApproveButton({ item, session, answer }: { item: AttentionItem; session: Session | undefined; answer: (v: Verdict) => void }) {
  const demo = useUi((s) => s.snapshot.mode === 'demo')
  if (!item.riskFlags.length) {
    return (
      <Button variant="primary" size="sm" onClick={() => answer('approve')}>
        Approve
      </Button>
    )
  }
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button variant="primary" size="sm">
          Approve
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-surface p-5 shadow-[0_16px_48px_rgb(0_0_0/0.16)]">
          <Dialog.Title className="text-[15px] font-semibold">Approve a risky request?</Dialog.Title>
          <Dialog.Description className="mt-1 text-[13px] text-muted">
            {session ? `${session.name} in ${projectName(session.cwd)}` : 'Unknown session'} wants to run:
          </Dialog.Description>
          <pre className="mt-3 whitespace-pre-wrap break-all rounded-tile bg-well p-3 font-mono text-[12px] leading-5">
            {item.title.replace(/`/g, '')}
          </pre>
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Risks">
            {item.riskFlags.map((f) => (
              <li key={f} className="rounded-md bg-[var(--failed-bg)] px-1.5 text-[12px] font-medium leading-5 text-[var(--failed-ink)]">
                {f}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-muted">
            {demo ? 'Demo data: approving here sends nothing.' : 'Approve lets this one call run. AgentDeck adds no permission rule.'}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button size="sm">Cancel</Button>
            </Dialog.Close>
            <Dialog.Close asChild>
              <Button variant="primary" size="sm" onClick={() => answer('approve')}>
                Approve
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function AnswerInTerminal({ session }: { session: Session }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button size="sm">
          <Terminal size={14} strokeWidth={1.75} />
          Answer in terminal
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 w-72 rounded-tile border border-line bg-surface p-3 text-[13px] shadow-[0_8px_24px_rgb(0_0_0/0.10)]">
          <p className="font-medium">{session.name} is waiting in its terminal.</p>
          <p className="mt-1 text-muted">This request is not held by AgentDeck, so answer it where the session runs:</p>
          <code className="mt-2 block break-all rounded-md bg-well px-2 py-1 text-[12px]">{session.cwd}</code>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function Actions({ item, session }: { item: AttentionItem; session: Session | undefined }) {
  const resolve = useUi((s) => s.resolve)
  const open = useUi((s) => s.openDrawer)
  const busy = useRef(false)
  // One click, one answer: a double click must not send a second one (approve-once, ADR-0006).
  const answer = (v: Verdict): void => {
    if (busy.current) return
    busy.current = true
    void answerItem(item, v).finally(() => {
      busy.current = false
    })
  }
  if (item.kind === 'approval' || item.kind === 'question') {
    if (item.held) {
      return (
        <>
          <Button size="sm" onClick={() => answer('reject')}>
            Reject
          </Button>
          <ApproveButton item={item} session={session} answer={answer} />
        </>
      )
    }
    if (!session) return null
    if (session.surface === 'cli' || session.surface === 'vscode') return <AnswerInTerminal session={session} />
    if (session.surface === 'desktop')
      return (
        <Button size="sm" onClick={() => void sessionAction('open-desktop', session)}>
          Open in Desktop
        </Button>
      )
    if (session.bgId)
      return (
        <Button size="sm" onClick={() => void sessionAction('attach', session)}>
          Attach
        </Button>
      )
    return (
      <Button size="sm" onClick={() => open(session.id)}>
        Open
      </Button>
    )
  }
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => resolve(item.id, 'dismissed')}>
        Dismiss
      </Button>
      <Button size="sm" onClick={() => open(item.sessionId)}>
        Open
      </Button>
    </>
  )
}

function Row({ item, session, now, flash, rowRef }: { item: AttentionItem; session: Session | undefined; now: number; flash: boolean; rowRef: (el: HTMLLIElement | null) => void }) {
  const k = KIND[item.kind]
  return (
    <li
      ref={rowRef}
      tabIndex={-1}
      data-item={item.id}
      className={cn(
        'flex min-h-[58px] items-center gap-3 border-t border-rule px-4 py-2.5 outline-none transition-[background-color] duration-300 ease-out',
        flash && 'bg-[var(--needs-bg)]'
      )}
    >
      <span
        className="grid size-7 flex-none place-items-center rounded-lg"
        style={{ background: `var(--${k.tone}-bg)`, color: `var(--${k.tone}-ink)` }}
        aria-label={k.label}
        role="img"
      >
        <k.icon size={15} strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        {/* Approvals wrap so the tail of a long command is never hidden behind an ellipsis. */}
        <p className={cn('text-[14px] leading-5', item.kind === 'approval' ? '[overflow-wrap:anywhere]' : 'truncate')}>
          <Inline text={item.title} />
        </p>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-muted">
          {session && <Avatar seed={session.name} size={14} className="flex-none" />}
          <span className="truncate">
            {session ? `${session.name} · ${projectName(session.cwd)}` : 'Unknown session'} · {ago(now - item.openedAt)}
          </span>
          {item.riskFlags.map((f) => (
            <span key={f} className="flex-none rounded-md bg-[var(--failed-bg)] px-1.5 font-medium text-[var(--failed-ink)]">
              {f}
            </span>
          ))}
        </p>
        {item.hint && <p className="mt-0.5 truncate text-[12px] leading-4 text-muted">{item.hint}</p>}
      </div>
      <div className="flex flex-none items-center gap-2">
        <Actions item={item} session={session} />
      </div>
    </li>
  )
}

const FLASH_MS = 2_000

/** A toast was clicked (ADR-0013): reveal that row, scroll to it, focus it and tint it briefly. */
function useRevealedItem(setExpanded: (v: boolean) => void): { flash: string | null; rows: Map<string, HTMLLIElement> } {
  const focused = useUi((s) => s.focusedItem)
  const [flash, setFlash] = useState<string | null>(null)
  const rows = useRef(new Map<string, HTMLLIElement>()).current

  useEffect(() => {
    if (!focused) return
    useUi.getState().focusItem(null) // consumed, so a second click on the same toast works again
    const index = byPriority(useUi.getState().snapshot.attention).findIndex((i) => i.id === focused)
    if (index < 0) return // answered meanwhile
    if (index >= MAX_ROWS) setExpanded(true)
    setFlash(focused)
  }, [focused, setExpanded])

  useEffect(() => {
    if (!flash) return
    const row = rows.get(flash)
    row?.scrollIntoView({ block: 'nearest' })
    row?.focus({ preventScroll: true })
    const t = setTimeout(() => setFlash(null), FLASH_MS)
    return () => clearTimeout(t)
  }, [flash, rows])

  return { flash, rows }
}

/** Home: every open item, three shown. The Approvals page (`approvals`): only P1 items, all of them. */
export function NeedsYou({ approvals = false }: { approvals?: boolean }) {
  const snapshot = useUi((s) => s.snapshot)
  const now = useUi((s) => s.now)
  const [expanded, setExpanded] = useState(approvals)
  const { flash, rows } = useRevealedItem(setExpanded)
  const items = byPriority(snapshot.attention).filter((i) => !approvals || i.priority === 1)
  const sessions = sessionIndex(snapshot)
  const shown = expanded ? items : items.slice(0, MAX_ROWS)
  const more = approvals ? 0 : items.length - Math.min(items.length, MAX_ROWS)
  const elsewhere = waitingWithoutItem(snapshot)

  return (
    <Card aria-labelledby="needs-you">
      <CardHeader
        id="needs-you"
        title={approvals ? 'Waiting for your OK' : 'Needs you'}
        count={items.length + elsewhere.length}
        countLabel="open"
        action={
          more > 0 && (
            <Button variant="ghost" size="sm" aria-expanded={expanded} aria-controls="needs-you-list" onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Show fewer' : `See all (${more} more)`}
            </Button>
          )
        }
      />
      {shown.length ? (
        <ul id="needs-you-list" className={cn(expanded && !approvals && 'max-h-[420px] overflow-y-auto')}>
          {shown.map((i) => (
            <Row
              key={i.id}
              item={i}
              session={sessions.get(i.sessionId)}
              now={now}
              flash={flash === i.id}
              rowRef={(el) => {
                if (el) rows.set(i.id, el)
                else rows.delete(i.id)
              }}
            />
          ))}
        </ul>
      ) : elsewhere.length ? (
        // D-054: a waiting session with no item (the poll saw a wait it can't name) must not read as "nothing".
        <p className="border-t border-rule px-4 py-6 text-[13px]">
          Waiting in its own window: <span className="font-medium">{elsewhere.map((x) => x.name).join(', ')}</span>.{' '}
          <span className="text-muted">Answer it where it runs.</span>
        </p>
      ) : (
        <p className="border-t border-rule px-4 py-6 text-[13px] text-muted">{approvals ? 'Nothing waits for your OK right now.' : 'Nothing needs you right now.'}</p>
      )}
    </Card>
  )
}
