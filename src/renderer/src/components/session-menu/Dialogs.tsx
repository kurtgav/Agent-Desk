import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ALIAS_MAX, SECTION_NAME_MAX, oneLine } from '@shared/session-meta'
import type { Session } from '@shared/snapshot'
import { useUi } from '@/store'
import { sessionAction } from '@/lib/act'
import { noteOf } from '@/lib/sessionMeta'
import { FIELD } from '../settings/Section'
import { Button, Code, Inline, cn, modalFooter, modalLede, modalOverlay, modalPanel, modalTitle } from '../ui'
import { useDialogs } from './dialogStore'

/** Above the drawer (z-50) and its scrim, which is where most of these are opened from. */
function Frame({ title, lede, opener, children }: { title: string; lede: ReactNode; opener: HTMLElement | null; children: ReactNode }) {
  const close = useDialogs((s) => s.close)
  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn(modalOverlay, 'z-[60]')} />
        <Dialog.Content
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            if (opener?.isConnected) opener.focus()
          }}
          className={cn(modalPanel, 'z-[70] w-[440px] max-w-[calc(100vw-32px)]')}
        >
          <Dialog.Title className={modalTitle}>{title}</Dialog.Title>
          <Dialog.Description className={modalLede}>{lede}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const cancel = (
  <Dialog.Close asChild>
    <Button size="sm">Cancel</Button>
  </Dialog.Close>
)

/** A destructive confirm's button: the solid red the error notice uses. */
const DANGER = 'bg-[var(--failed-solid)] text-white enabled:hover:bg-[var(--failed-solid)] enabled:hover:brightness-110'

/** A one-line name field with Save; Enter saves. `error` is a sentence from the check that refused the name. */
function NameForm({ label, value, onChange, max, error, submit, extra }: { label: string; value: string; onChange(v: string): void; max: number; error: string | null; submit: string; extra?: ReactNode }) {
  const id = useId()
  return (
    <>
      <label htmlFor={id} className="mt-4 block text-[13px] font-medium leading-5">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        maxLength={max}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(FIELD, 'mt-1.5 w-full')}
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-2 text-[12px] leading-4 text-[var(--failed-ink)]">
          {error}
        </p>
      )}
      <div className={modalFooter}>
        {extra}
        {cancel}
        <Button type="submit" variant="primary" size="sm">
          {submit}
        </Button>
      </div>
    </>
  )
}

/** Sets a name only AgentDeck uses. Claude Code keeps its own, and the field says so. */
function RenameDialog({ session, opener }: { session: Session; opener: HTMLElement | null }) {
  const alias = useUi((s) => noteOf(s.sessionMeta, session.id)?.alias)
  const setNote = useUi((s) => s.setSessionMeta)
  const close = useDialogs((s) => s.close)
  const [value, setValue] = useState(alias ?? session.name)
  const save = (e: FormEvent): void => {
    e.preventDefault()
    const name = oneLine(value, ALIAS_MAX)
    setNote(session.id, { alias: name && name !== session.name ? name : null })
    close()
  }
  const reset = (): void => {
    setNote(session.id, { alias: null })
    close()
  }
  return (
    <Frame
      title="Rename session"
      opener={opener}
      lede={
        <>
          AgentDeck shows this name everywhere. Claude Code keeps its own: <Code>{session.name}</Code>.
        </>
      }
    >
      <form onSubmit={save}>
        <NameForm
          label="Name"
          value={value}
          onChange={setValue}
          max={ALIAS_MAX}
          error={null}
          submit="Save"
          extra={
            alias !== undefined && (
              <Button variant="quiet" size="sm" className="mr-auto" onClick={reset}>
                Reset name
              </Button>
            )
          }
        />
      </form>
    </Frame>
  )
}

/** `claude rm`: the one thing here that changes Claude Code's own list, so it says what happens before it does it. */
function DeleteDialog({ session, opener }: { session: Session; opener: HTMLElement | null }) {
  const close = useDialogs((s) => s.close)
  const name = useUi((s) => noteOf(s.sessionMeta, session.id)?.alias) ?? session.name
  const run = (): void => {
    close()
    void sessionAction('delete-background', session).then((ok) => {
      if (ok && useUi.getState().drawer === session.id) useUi.getState().openDrawer(null)
    })
  }
  return (
    <Frame title={`Delete ${name}?`} opener={opener} lede="This removes the background session from Claude Code.">
      <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-[13px] leading-5 text-muted marker:text-muted">
        <li>A session that is still running is stopped first.</li>
        <li>
          <Inline text="Its conversation is kept: `claude --resume` still lists it." />
        </li>
        <li>A worktree it made goes too, unless it holds unpushed work. Then Claude Code refuses and says so.</li>
        <li>
          <Inline text={`AgentDeck runs \`claude rm ${session.bgId ?? ''}\` and deletes no file itself.`} />
        </li>
      </ul>
      <div className={modalFooter}>
        {cancel}
        <Button variant="primary" size="sm" className={DANGER} onClick={run}>
          Delete session
        </Button>
      </div>
    </Frame>
  )
}

function StopDialog({ session, opener }: { session: Session; opener: HTMLElement | null }) {
  const close = useDialogs((s) => s.close)
  const name = useUi((s) => noteOf(s.sessionMeta, session.id)?.alias) ?? session.name
  return (
    <Frame
      title={`Stop ${name}?`}
      opener={opener}
      lede={
        <>
          AgentDeck runs <Code>claude stop {session.bgId}</Code>. The conversation is kept, and <Code>claude attach</Code> resumes it later.
        </>
      }
    >
      <div className={modalFooter}>
        {cancel}
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            close()
            void sessionAction('stop', session)
          }}
        >
          Stop session
        </Button>
      </div>
    </Frame>
  )
}

/** A new section (and, from a session's menu, that session filed in it at once), or a section's new name. */
function SectionNameDialog({ section, sessionId, opener }: { section: string | null; sessionId: string | null; opener: HTMLElement | null }) {
  const changeSections = useUi((s) => s.changeSections)
  const setNote = useUi((s) => s.setSessionMeta)
  const close = useDialogs((s) => s.close)
  const [value, setValue] = useState(section ?? '')
  const [error, setError] = useState<string | null>(null)
  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const failed = await changeSections(section === null ? { op: 'add', name: value } : { op: 'rename', from: section, to: value })
    if (failed) return setError(failed)
    if (sessionId) setNote(sessionId, { section: oneLine(value, SECTION_NAME_MAX) })
    close()
  }
  return (
    <Frame title={section === null ? 'New section' : 'Rename section'} opener={opener} lede="Sections group sessions on the Sessions page. They stay on this PC.">
      <form onSubmit={(e) => void save(e)}>
        <NameForm label="Section name" value={value} onChange={(v) => (setValue(v), setError(null))} max={SECTION_NAME_MAX} error={error} submit={section === null ? 'Create' : 'Save'} />
      </form>
    </Frame>
  )
}

function DeleteSectionDialog({ section, opener }: { section: string; opener: HTMLElement | null }) {
  const changeSections = useUi((s) => s.changeSections)
  const close = useDialogs((s) => s.close)
  const n = useUi((s) => s.snapshot.sessions.filter((x) => noteOf(s.sessionMeta, x.id)?.section === section).length)
  return (
    <Frame title={`Delete ${section}?`} opener={opener} lede={`Its ${n === 1 ? 'session stays' : 'sessions stay'}: ${n === 1 ? 'it just leaves' : 'they just leave'} the section. Nothing else changes.`}>
      <div className={modalFooter}>
        {cancel}
        <Button
          variant="primary"
          size="sm"
          className={DANGER}
          onClick={() => {
            close()
            void changeSections({ op: 'delete', name: section }).then((error) => error && useUi.getState().notify(error, 'error'))
          }}
        >
          Delete section
        </Button>
      </div>
    </Frame>
  )
}

/** Mounted once (App.tsx): draws whichever of the session menu's dialogs is open. */
export function SessionMenuDialogs() {
  const dialog = useDialogs((s) => s.dialog)
  const close = useDialogs((s) => s.close)
  const session = useUi((s) => (dialog && 'sessionId' in dialog && dialog.sessionId ? s.snapshot.sessions.find((x) => x.id === dialog.sessionId) : undefined))
  // The session ended and left the list while its dialog was open: nothing is left to ask about.
  const gone = dialog !== null && 'sessionId' in dialog && dialog.kind !== 'new-section' && !session
  useEffect(() => {
    if (gone) close()
  }, [gone, close])
  if (!dialog || gone) return null
  switch (dialog.kind) {
    case 'rename':
      return session ? <RenameDialog key={session.id} session={session} opener={dialog.opener} /> : null
    case 'delete':
      return session ? <DeleteDialog session={session} opener={dialog.opener} /> : null
    case 'stop':
      return session ? <StopDialog session={session} opener={dialog.opener} /> : null
    case 'new-section':
      return <SectionNameDialog section={null} sessionId={dialog.sessionId} opener={dialog.opener} />
    case 'rename-section':
      return <SectionNameDialog key={dialog.section} section={dialog.section} sessionId={null} opener={dialog.opener} />
    case 'delete-section':
      return <DeleteSectionDialog section={dialog.section} opener={dialog.opener} />
  }
}
