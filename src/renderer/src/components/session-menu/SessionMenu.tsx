import { createContext, use, useEffect, useId, useRef, useState, type ComponentType, type KeyboardEvent, type ReactElement, type ReactNode, type RefObject } from 'react'
import * as Menu from '@radix-ui/react-context-menu'
import {
  AppWindow, Archive, ArchiveRestore, Check, ChevronRight, Code, Copy, Ellipsis, FolderInput, FolderOpen, GitFork, Mail, MailOpen, MonitorUp, MousePointer2, PanelRight, Pencil, Pin,
  PinOff, Plus, Square, SquareTerminal, Terminal, Trash2
} from 'lucide-react'
import type { Session } from '@shared/snapshot'
import { useUi } from '@/store'
import { sessionAction } from '@/lib/act'
import { isRunning } from '@/lib/sessionMeta'
import { Hint, IconButton, StatusPill, cn, menuItem, menuLabel, menuPanel, menuSeparator } from '../ui'
import { useDialogs, type DialogState } from './dialogStore'
import { forkSession } from './fork'
import { useDisplayName, useNote } from './hooks'
import { ARCHIVED, ARCHIVED_RUNNING, buildMenu, itemForKey, type IconKey, type MenuDo, type MenuEntry, type MenuItem, type MenuSub } from './model'
import { useTools } from './tools'

type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

const ICON: Record<IconKey, Icon> = {
  open: AppWindow, details: PanelRight, code: Code, cursor: MousePointer2, explorer: FolderOpen, terminal: SquareTerminal, desktop: MonitorUp, attach: Terminal,
  pin: Pin, unpin: PinOff, unread: Mail, read: MailOpen, rename: Pencil, fork: GitFork, move: FolderInput, archive: Archive, unarchive: ArchiveRestore, delete: Trash2,
  stop: Square, copy: Copy, plus: Plus
}

/** What a row's ⋯ button needs from the menu around it. */
interface MenuHandle {
  open: boolean
  /** Opens the menu under `anchor`, the way a right-click opens it under the pointer. */
  openFrom(anchor: HTMLElement): void
}
const HandleContext = createContext<MenuHandle | null>(null)

const glyph = (key: IconKey | undefined): ReactNode => {
  if (!key) return null
  const I = ICON[key]
  return <I size={15} strokeWidth={1.75} className="flex-none text-muted" />
}

/**
 * A letter or digit runs the item whose key it is: it presses that item, so the choice, the close and the focus work as for the
 * mouse. A submenu opened by hovering leaves focus in this menu, so its keys (the digits) are answered from here too.
 */
function accelerate(entries: readonly MenuEntry[]) {
  return (e: KeyboardEvent<HTMLElement>): void => {
    // A submenu's keys bubble up through its portal; each menu answers only its own.
    if (!e.currentTarget.contains(e.target as Node)) return
    const own = itemForKey(entries, e.nativeEvent)
    const trigger = e.currentTarget.querySelector<HTMLElement>('[data-sub][data-state="open"]')
    const sub = entries.find((x): x is MenuSub => x.kind === 'sub' && x.id === trigger?.dataset.sub)
    const item = own ?? (sub ? itemForKey(sub.entries, e.nativeEvent) : undefined)
    if (!item?.key) return
    const root = own ? e.currentTarget : document.getElementById(trigger?.getAttribute('aria-controls') ?? '')
    const press = root?.querySelector<HTMLElement>(`[data-accel="${item.key.toLowerCase()}"]`)
    if (!press) return
    e.preventDefault()
    press.click()
  }
}

/** An item that can not run stays in the menu and in the tab order, with its reason as the tooltip (D-103); choosing it says the reason. */
function Row({ item }: { item: MenuItem }) {
  const reason = item.disabled
  const reasonId = useId()
  const props = {
    'data-accel': item.key?.toLowerCase(),
    'aria-disabled': reason ? true : undefined,
    'aria-describedby': reason ? reasonId : undefined,
    'aria-keyshortcuts': item.key?.toUpperCase(),
    onSelect: (e: Event) => {
      if (!reason) return item.run()
      e.preventDefault()
      useUi.getState().notify(reason)
    },
    className: cn(menuItem, 'aria-disabled:opacity-50', item.danger && 'text-[var(--failed-ink)] data-[highlighted]:bg-[var(--failed-bg)]')
  }
  const inside = (
    <>
      {item.checked !== undefined ? <span className="w-3.5 flex-none">{item.checked && <Check size={14} strokeWidth={2} />}</span> : glyph(item.icon)}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.key && (
        <span aria-hidden className="pl-4 text-[12px] tabular-nums text-muted">
          {item.key.toUpperCase()}
        </span>
      )}
    </>
  )
  // A choice among sections is a checkable item (menuitemcheckbox); everything else is a plain menuitem.
  const row = item.checked === undefined ? (
    <Menu.Item {...props}>{inside}</Menu.Item>
  ) : (
    <Menu.CheckboxItem checked={item.checked} {...props}>
      {inside}
    </Menu.CheckboxItem>
  )
  if (!reason) return row
  return (
    <>
      <Hint label={reason} side="right">
        {row}
      </Hint>
      {/* The reason is the item's description, not part of its name: kept beside it, hidden, and referenced. */}
      <span id={reasonId} hidden>
        {reason}
      </span>
    </>
  )
}

function Submenu({ sub }: { sub: MenuSub }) {
  return (
    <Menu.Sub>
      <Menu.SubTrigger data-sub={sub.id} className={cn(menuItem, 'data-[state=open]:bg-hover')}>
        {glyph(sub.icon)}
        <span className="min-w-0 flex-1 truncate">{sub.label}</span>
        <ChevronRight size={14} strokeWidth={1.75} className="flex-none text-muted" />
      </Menu.SubTrigger>
      <Menu.Portal>
        <Menu.SubContent sideOffset={6} alignOffset={-5} collisionPadding={8} onKeyDown={accelerate(sub.entries)} className={cn(menuPanel, 'w-60')}>
          {sub.entries.map(draw)}
        </Menu.SubContent>
      </Menu.Portal>
    </Menu.Sub>
  )
}

function draw(e: MenuEntry, i: number): ReactNode {
  switch (e.kind) {
    case 'rule':
      return <Menu.Separator key={i} className={menuSeparator} />
    case 'heading':
      return (
        <Menu.Label key={i} className={menuLabel}>
          {e.text}
        </Menu.Label>
      )
    case 'sub':
      return <Submenu key={e.id} sub={e} />
    case 'item':
      return <Row key={e.id} item={e} />
  }
}

function Body({ session, openerRef }: { session: Session; openerRef: RefObject<HTMLElement | null> }) {
  const note = useNote(session.id)
  const sections = useUi((s) => s.sessionMeta.sections)
  const cursor = useTools((s) => s.cursor)
  const setNote = useUi((s) => s.setSessionMeta)
  const name = useDisplayName(session)
  const ask = (dialog: DialogState): void => useDialogs.getState().show(dialog, openerRef.current)
  const choose: MenuDo = {
    details: () => useUi.getState().openDrawer(session.id),
    action: (action) => void sessionAction(action, session),
    note: (patch) => {
      setNote(session.id, patch)
      if (patch.archived === true) useUi.getState().notify(isRunning(session) ? ARCHIVED_RUNNING : ARCHIVED)
    },
    rename: () => ask({ kind: 'rename', sessionId: session.id }),
    fork: () => forkSession(session, name),
    newSection: () => ask({ kind: 'new-section', sessionId: session.id }),
    stop: () => ask({ kind: 'stop', sessionId: session.id }),
    remove: () => ask({ kind: 'delete', sessionId: session.id })
  }
  const entries = buildMenu({ session, note, sections, tools: { cursor }, do: choose })
  return (
    <Menu.Content
      aria-label={`Actions for ${name}`}
      collisionPadding={8}
      onKeyDown={accelerate(entries)}
      onCloseAutoFocus={(e) => {
        // Radix would focus the row itself, which can not take focus. A dialog the choice opened looks after focus itself.
        e.preventDefault()
        const from = openerRef.current
        if (useDialogs.getState().dialog === null && from?.isConnected && from !== document.body) from.focus()
      }}
      className={cn(menuPanel, 'w-64')}
    >
      {/* Who this is about: quiet, and not an item. */}
      <Menu.Label className="flex items-center gap-2 px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-muted">{name}</span>
        <StatusPill status={session.status} />
      </Menu.Label>
      <Menu.Separator className={menuSeparator} />
      {entries.map(draw)}
    </Menu.Content>
  )
}

/**
 * The menu every session has, on right-click, the Menu key and Shift+F10 (the browser sends all three as `contextmenu` to the
 * focused row), and from the row's ⋯ button. Wrap the row's own element: `<SessionMenu session={s}><li>…</li></SessionMenu>`.
 * Its items are built only while it is open (model.ts), so a long list pays for a trigger per row and nothing more.
 */
export function SessionMenu({ session, children }: { session: Session; children: ReactElement }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLSpanElement>(null)
  const anchor = useRef<HTMLElement | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => useTools.getState().load(useUi.getState().snapshot.mode === 'demo'), [])
  const handle: MenuHandle = {
    open,
    openFrom: (button) => {
      anchor.current = button
      const at = button.getBoundingClientRect()
      trigger.current?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: at.left, clientY: at.bottom + 4 }))
    }
  }
  return (
    <HandleContext value={handle}>
      <Menu.Root
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) return
          // Where focus goes back to: the ⋯ button that opened it, else whatever had focus (the row's name button, or nothing).
          opener.current = anchor.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
          anchor.current = null
        }}
      >
        <Menu.Trigger asChild ref={trigger} className="group">
          {children}
        </Menu.Trigger>
        <Menu.Portal>
          <Body session={session} openerRef={opener} />
        </Menu.Portal>
      </Menu.Root>
    </HandleContext>
  )
}

/**
 * The visible way in: shown when the row is pointed at or has focus, and always for a screen reader. It sits above the row's
 * whole-row link, so give it a spot of its own at the row's end.
 */
export function MoreButton({ session, className }: { session: Session; className?: string }) {
  const handle = use(HandleContext)
  const name = useDisplayName(session)
  if (!handle) return null
  return (
    <IconButton
      aria-label={`Actions for ${name}`}
      aria-haspopup="menu"
      aria-expanded={handle.open}
      onClick={(e) => handle.openFrom(e.currentTarget)}
      className={cn(
        'relative z-10 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:bg-active aria-expanded:text-ink aria-expanded:opacity-100',
        className
      )}
    >
      <Ellipsis size={16} strokeWidth={1.75} />
    </IconButton>
  )
}
