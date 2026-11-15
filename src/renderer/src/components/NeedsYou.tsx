import { useEffect, useRef, useState, type ComponentType } from 'react'
import agentBot from '@/assets/agent-bot.webp'
import * as Dialog from '@radix-ui/react-dialog'
import { CircleCheck, CircleX, Eye, Hourglass, MessageCircle, ShieldAlert, Terminal } from 'lucide-react'
import type { Verdict } from '@shared/bridge'
import type { AttentionItem, AttentionKind, Session } from '@shared/snapshot'
import { useUi } from '@/store'
import { answerItem, sessionAction } from '@/lib/act'
import { ago } from '@/lib/format'
import { byPriority, projectName, sessionIndex, waitingWithoutItem } from '@/lib/selectors'
import { nameOf } from '@/lib/sessionMeta'
import { Avatar } from './Avatar'
import { useDisplayName } from './session-menu/hooks'
import { MoreButton, SessionMenu } from './session-menu/SessionMenu'
import { Button, Card, CardAction, CardHeader, EmptyState, Hint, Inline, Tag, cn, modalFooter, modalLede, modalOverlay, modalPanel, modalTitle } from './ui'

export const MAX_ROWS = 3 // the reference shows three; the rest sit behind "See all"

type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

/** Kind icon and the status colour it borrows (UI_MAP § Needs you). */
export const KIND: Record<AttentionKind, { icon: Icon; tone: 'needs' | 'failed' | 'idle' | 'working'; label: string }> = {
  approval: { icon: ShieldAlert, tone: 'needs', label: 'Approval' },
  question: { icon: MessageCircle, tone: 'needs', label: 'Question' },
  failed: { icon: CircleX, tone: 'failed', label: 'Failed' },
  stuck: { icon: Hourglass, tone: 'idle', label: 'Stuck' },
  review: { icon: Eye, tone: 'working', label: 'Ready for review' }
}

function ApproveButton({ item, session, answer }: { item: AttentionItem; session: Session | undefined; answer: (v: Verdict) => void }) {
  const demo = useUi((s) => s.snapshot.mode === 'demo')
  const name = useDisplayName(session)
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
        <Dialog.Overlay className={modalOverlay} />
        <Dialog.Content className={cn(modalPanel, 'w-[440px] max-w-[calc(100vw-32px)]')}>
          <Dialog.Title className={modalTitle}>Approve a risky request?</Dialog.Title>
          <Dialog.Description className={modalLede}>
            {session ? `${name} in ${projectName(session.cwd)}` : 'Unknown session'} wants to run:
          </Dialog.Description>
          <pre className="mt-3 whitespace-pre-wrap break-all rounded-tile bg-well p-3 font-mono text-[12px] leading-5">
            {item.title.replace(/`/g, '')}
          </pre>
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Risks">
            {item.riskFlags.map((f) => (
              <li key={f}>
                <Tag tone="failed">{f}</Tag>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-muted">
            {demo ? 'Demo data: approving here sends nothing.' : 'Approve lets this one call run. AgentDeck adds no permission rule.'}
          </p>
          <div className={modalFooter}>
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

/** Takes you to the window the session runs in (the terminal, Claude Desktop or VS Code). When it can't, the notice says where it waits. */
function AnswerInTerminal({ session }: { session: Session }) {
  // A second click while the first is still looking for the window would only repeat it.
  const busy = useRef(false)
  const name = useDisplayName(session)
  const go = (): void => {
    if (busy.current) return
    busy.current = true
    void sessionAction('focus-terminal', session).finally(() => {
      busy.current = false
    })
  }
  return (
    <Hint label={`Brings the window ${name} runs in to the front`}>
      <Button size="sm" onClick={go}>
        <Terminal size={14} strokeWidth={1.75} />
        Answer in terminal
      </Button>
    </Hint>
  )
}

/** Approve, Reject, Answer in terminal, Attach, Open or Dismiss: what an item can be answered with. The sidebar and the cards share it. */
export function AttentionActions({ item, session }: { item: AttentionItem; session: Session | undefined }) {
  const resolve = useUi((s) => s.resolve)
  const open = useUi((s) => s.openSession)
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
  const name = useDisplayName(session)
  const row = (
    <li
      ref={rowRef}
      tabIndex={-1}
      data-item={item.id}
      className={cn(
        'flex min-h-[60px] items-center gap-3 border-t border-rule px-4 py-2.5 outline-none transition-[background-color] duration-300',
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
        <p className={cn('text-[14px] font-medium leading-5', item.kind === 'approval' ? '[overflow-wrap:anywhere]' : 'truncate')}>
          <Inline text={item.title} />
        </p>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-muted">
          {session && <Avatar seed={session.name} size={14} className="flex-none" />}
          <span className="truncate">
            {session ? `${name} · ${projectName(session.cwd)}` : 'Unknown session'} · {ago(now - item.openedAt)}
          </span>
          {item.riskFlags.map((f) => (
            <Tag key={f} tone="failed" className="leading-4">
              {f}
            </Tag>
          ))}
          {/* Right-click the row works too; this is the way in for the keyboard and for a mouse that has no second button. */}
          {session && <MoreButton session={session} className="-my-1 size-6 flex-none" />}
        </p>
        {item.hint && <p className="mt-0.5 truncate text-[12px] leading-4 text-muted">{item.hint}</p>}
      </div>
      <div className="flex flex-none items-center gap-2">
        <AttentionActions item={item} session={session} />
      </div>
    </li>
  )
  return session ? <SessionMenu session={session}>{row}</SessionMenu> : row
}

const FLASH_MS = 2_000

/** A toast was clicked (ADR-0013): reveal that row, scroll to it, focus it and tint it briefly. */
export function useRevealedItem(setExpanded: (v: boolean) => void): { flash: string | null; rows: Map<string, HTMLLIElement> } {
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
  const meta = useUi((s) => s.sessionMeta)
  const [expanded, setExpanded] = useState(approvals)
  const { flash, rows } = useRevealedItem(setExpanded)
  const items = byPriority(snapshot.attention).filter((i) => !approvals || i.priority === 1)
  const sessions = sessionIndex(snapshot)
  const shown = expanded ? items : items.slice(0, MAX_ROWS)
  const more = approvals ? 0 : items.length - Math.min(items.length, MAX_ROWS)
  const elsewhere = waitingWithoutItem(snapshot)
  // Amber only for what is asking for you; a finished task waiting for review is not urgent.
  const urgent = items.some((i) => i.priority <= 2) || elsewhere.length > 0

  return (
    <Card aria-labelledby="needs-you">
      <CardHeader
        id="needs-you"
        title={approvals ? 'Waiting for your OK' : 'Needs you'}
        count={items.length + elsewhere.length}
        countLabel="open"
        countTone={urgent ? 'needs' : 'neutral'}
        action={
          more > 0 && (
            <CardAction aria-expanded={expanded} aria-controls="needs-you-list" onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Show fewer' : `See all (${more} more)`}
            </CardAction>
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
        <p className="border-t border-rule px-4 py-5 text-[13px] leading-5">
          Waiting in its own window: <span className="font-medium">{elsewhere.map((x) => nameOf(meta, x)).join(', ')}</span>.{' '}
          <span className="text-muted">Answer it where it runs.</span>
        </p>
      ) : (
        <EmptyState icon={CircleCheck} art={agentBot}>
          {approvals ? 'Nothing waits for your OK right now.' : 'Nothing needs you right now.'}
        </EmptyState>
      )}
    </Card>
  )
}
