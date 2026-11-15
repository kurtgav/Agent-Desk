import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Check, CircleCheck, Copy, MessageSquarePlus, Pencil, Pin, Send, Trash2, X } from 'lucide-react'
import { goodFor } from '@shared/role-good-for'
import { ROLE_PREVIEW_CHARS, SOURCE_LABEL, skillName, type RoleDetail, type RoleSummary } from '@shared/roles'
import { rolesApi } from '@/lib/roles'
import { useUi } from '@/store'
import { copyToClipboard } from '../console/clipboard'
import { Button, IconButton, Pill, Skeleton, Tag, cn, modalOverlay } from '../ui'
import { PromptPreview } from './PromptPreview'
import { RoleEmoji } from './RoleEmoji'
import { useRolesStore } from './store'

type Load = { state: 'loading' } | { state: 'missing' } | { state: 'ready'; detail: RoleDetail }

function useRoleDetail(id: string | null, version: unknown): Load {
  const [got, setGot] = useState<{ id: string; detail: RoleDetail | null } | null>(null)
  useEffect(() => {
    if (!id) return
    let current = true
    void rolesApi()
      .get(id)
      .then((detail) => {
        if (current) setGot({ id, detail })
      })
    return () => {
      current = false
    }
  }, [id, version])
  if (!id || got?.id !== id) return { state: 'loading' }
  return got.detail ? { state: 'ready', detail: got.detail } : { state: 'missing' }
}

/** What "installed in Claude Code" means for this role, in the words a person needs before starting a conversation. */
export function installNote(r: Pick<RoleSummary, 'source' | 'installed' | 'agentName'>): { yes: boolean; text: string } {
  if (r.installed && r.agentName) return { yes: true, text: `Claude Code already has this agent, so a conversation starts as it with --agent "${r.agentName}".` }
  if (r.installed) return { yes: true, text: 'Claude Code has this agent, but its name has characters AgentDeck will not put on a command line, so it hands the role over as text instead.' }
  if (r.source === 'custom' || r.source === 'builtin') return { yes: false, text: 'Not needed. AgentDeck hands Claude Code this role as text for each conversation, so nothing goes into your agents folder.' }
  return { yes: false, text: 'Not installed, and that is fine. AgentDeck hands Claude Code the role as text for each conversation, and adds nothing to your agents folder.' }
}

interface DrawerProps {
  /** The role to show, or null for closed. */
  id: string | null
  pinned: boolean
  /** AgentDeck has written this role as a Claude Code skill. */
  skill: boolean
  /** Claude Code's skills folder, for the sentence that says where the file goes. */
  skillsPath: string
  onClose(): void
  onEdit(d: RoleDetail): void
  /** A copy was made: open it. */
  onCopied(r: RoleSummary): void
}

/**
 * One role in full: what it is, what it is good for, whether Claude Code has it installed, whether it is a Claude Code skill (add or
 * remove it here), and the first 4 KB of its text. Start a conversation or send a task as this role from here. Custom roles can be
 * edited and deleted; every other role is duplicated first.
 */
export function RoleDrawer({ id, pinned, skill, skillsPath, onClose, onEdit, onCopied }: DrawerProps) {
  const version = useRolesStore((s) => s.catalog?.status.scannedAt)
  const load = useRoleDetail(id, version)
  const opener = useRef<HTMLElement | null>(null)
  return (
    <Dialog.Root open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn(modalOverlay, 'bg-scrim-soft')} />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
          }}
          onCloseAutoFocus={(e) => {
            if (!opener.current?.isConnected) return
            e.preventDefault()
            opener.current.focus()
          }}
          className="anim-slide fixed inset-y-0 right-0 z-50 flex w-[560px] max-w-[calc(100vw-48px)] flex-col border-l border-line bg-overlay shadow-modal outline-none"
        >
          {load.state === 'ready' ? (
            <Body detail={load.detail} pinned={pinned} skill={skill} skillsPath={skillsPath} onClose={onClose} onEdit={onEdit} onCopied={onCopied} />
          ) : (
            <div className="flex flex-1 flex-col px-5 pt-5">
              <div className="flex items-start gap-3">
                <Dialog.Title className="t-heading min-w-0 flex-1">{load.state === 'loading' ? 'Loading the role…' : 'Role not found'}</Dialog.Title>
                <Dialog.Close asChild>
                  <IconButton aria-label="Close" className="-mr-1.5 -mt-1">
                    <X size={16} strokeWidth={1.75} />
                  </IconButton>
                </Dialog.Close>
              </div>
              {load.state === 'loading' ? (
                <div className="mt-6 flex flex-col gap-3" role="status" aria-label="Loading">
                  <Skeleton className="h-14 w-3/4" />
                  <Skeleton className="h-5" />
                  <Skeleton className="h-5 w-5/6" />
                </div>
              ) : (
                <p className="mt-2 text-[13px] text-muted">This role is gone, or its file could not be read. Reload the roles and try again.</p>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Body({ detail: d, pinned, skill, skillsPath, onClose, onEdit, onCopied }: { detail: RoleDetail } & Omit<DrawerProps, 'id'>) {
  const notify = useUi((s) => s.notify)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const install = installNote(d)
  const good = goodFor(d.description)

  const start = (page: 'console' | 'tasks'): void => {
    const ui = useUi.getState()
    ui.setRole(d.id)
    onClose()
    ui.go({ page })
  }
  const copyName = async (): Promise<void> => {
    notify((await copyToClipboard(d.name)) ? `Copied “${d.name}”.` : 'AgentDeck could not copy that.', 'ok')
  }
  const duplicate = async (): Promise<void> => {
    setBusy(true)
    const r = await useRolesStore.getState().duplicate(d.id)
    setBusy(false)
    if (r.ok) {
      notify(`Made your own copy, “${r.role.name}”. Edit it and it is yours.`)
      onCopied(r.role)
    } else notify(r.error, 'error')
  }
  // The file in the folder's own separator: backslashes on Windows, slashes on macOS.
  const sep = skillsPath.includes('\\') ? '\\' : '/'
  const skillFile = [skillsPath, skillName(d.id), 'SKILL.md'].join(sep)
  const toggleSkill = async (): Promise<void> => {
    setBusy(true)
    const r = await useRolesStore.getState().setSkills([d.id], !skill)
    setBusy(false)
    if (r.ok) notify(skill ? `Removed the “${d.name}” skill (${skillName(d.id)}).` : `Added “${d.name}” as the ${skillName(d.id)} skill. New Claude Code sessions can use it.`)
    else notify(r.error, 'error')
  }
  const remove = async (): Promise<void> => {
    setBusy(true)
    const ok = await useRolesStore.getState().remove(d.id)
    setBusy(false)
    if (ok) {
      notify(`Deleted “${d.name}”.`)
      onClose()
    } else notify('AgentDeck could not delete that role.', 'error')
  }

  return (
    <>
      <header className="flex-none px-5 pb-4 pt-5">
        <div className="flex items-start gap-3">
          <RoleEmoji emoji={d.emoji} color={d.color} size={56} />
          <div className="min-w-0 flex-1 pt-0.5">
            <Dialog.Title className="t-heading text-balance">{d.name}</Dialog.Title>
            <p className="mt-0.5 text-pretty text-[13px] leading-5 text-muted">{d.vibe}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Tag>{SOURCE_LABEL[d.source]}</Tag>
              {d.source !== 'custom' && d.source !== 'builtin' && <Tag>{d.divisionLabel}</Tag>}
              {d.source === 'builtin' && <Tag>Leadership</Tag>}
              {d.installed && (
                <span className="inline-flex items-center gap-1 text-[12px] text-[var(--done-ink)]">
                  <CircleCheck size={13} strokeWidth={1.75} aria-hidden />
                  Installed
                </span>
              )}
            </div>
          </div>
          <Dialog.Close asChild>
            <IconButton aria-label="Close" className="-mr-1.5 -mt-1">
              <X size={16} strokeWidth={1.75} />
            </IconButton>
          </Dialog.Close>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => start('console')}>
            <MessageSquarePlus size={15} strokeWidth={1.75} aria-hidden />
            Start a conversation
          </Button>
          <Button onClick={() => start('tasks')}>
            <Send size={14} strokeWidth={1.75} aria-hidden />
            Send as a task
          </Button>
          <IconButton
            aria-label={`${pinned ? 'Unpin' : 'Pin'} ${d.name}`}
            aria-pressed={pinned}
            className={cn('ml-auto border border-control', pinned && 'text-accent')}
            onClick={() => void useRolesStore.getState().togglePin(d.id)}
          >
            <Pin size={15} strokeWidth={1.75} className={pinned ? 'fill-current' : undefined} aria-hidden />
          </IconButton>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-5 pb-6 pt-5">
        <section aria-label="About this role">
          <p className="text-pretty text-[14px] leading-6">{d.description || 'No description.'}</p>
          {good.length > 0 && (
            <>
              <h3 className="t-label mt-5">Good for</h3>
              <ul className="mt-2 flex flex-col gap-1.5">
                {good.map((g) => (
                  <li key={g} className="flex gap-2 text-[13px] leading-5">
                    <Check size={14} strokeWidth={2} className="mt-[3px] flex-none text-muted" aria-hidden />
                    <span>{g}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section aria-label="Installed in Claude Code" className="mt-6 rounded-tile border border-line p-4">
          <div className="flex items-center gap-2">
            <h3 className="t-label">Installed in Claude Code</h3>
            <Pill tone={install.yes ? 'done' : 'idle'}>{install.yes ? 'Yes' : 'No'}</Pill>
          </div>
          <p className="mt-1.5 text-pretty text-[13px] leading-5 text-muted">{install.text}</p>
        </section>

        <section aria-label="Claude Code skill" className="mt-6 rounded-tile border border-line p-4">
          <div className="flex items-center gap-2">
            <h3 className="t-label">Claude Code skill</h3>
            <Pill tone={skill ? 'done' : 'idle'}>{skill ? 'Yes' : 'No'}</Pill>
            <Button size="sm" className="ml-auto" disabled={busy} onClick={() => void toggleSkill()}>
              {skill ? 'Remove skill' : 'Add as a skill'}
            </Button>
          </div>
          <p className="mt-1.5 text-pretty text-[13px] leading-5 text-muted [overflow-wrap:anywhere]">
            {skill
              ? `Claude Code loads it by itself when a task fits, from ${skillFile}. Removing it deletes only the file AgentDeck wrote.`
              : `Writes ${skillFile}, so Claude Code can pick this role up by itself when a task fits. Each skill adds its description to every new session.`}
          </p>
        </section>

        <section aria-label="Role text" className="mt-6">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="t-label">Role text</h3>
            <span className="t-meta tabular-nums text-muted">{kb(d.promptChars)}</span>
          </div>
          <div className="mt-2 rounded-tile bg-well p-4">
            <PromptPreview text={d.preview} />
            {d.previewTruncated && <p className="t-meta mt-3 border-t border-line pt-3 text-muted">Showing the first {ROLE_PREVIEW_CHARS / 1024} KB. The whole text is used when you start.</p>}
          </div>
        </section>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void copyName()}>
            <Copy size={14} strokeWidth={1.75} aria-hidden />
            Copy name
          </Button>
          {d.editable ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => onEdit(d)}>
                <Pencil size={14} strokeWidth={1.75} aria-hidden />
                Edit
              </Button>
              {confirming ? (
                <span className="ml-auto flex items-center gap-2" role="group" aria-label="Confirm delete">
                  <span className="text-[13px] text-muted">Delete this role?</span>
                  <Button size="sm" onClick={() => setConfirming(false)}>
                    Keep it
                  </Button>
                  <Button size="sm" variant="primary" className="bg-[var(--failed-solid)] enabled:hover:bg-[var(--failed-solid)]" disabled={busy} onClick={() => void remove()}>
                    Delete
                  </Button>
                </span>
              ) : (
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setConfirming(true)}>
                  <Trash2 size={14} strokeWidth={1.75} aria-hidden />
                  Delete
                </Button>
              )}
            </>
          ) : (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void duplicate()}>
              <Copy size={14} strokeWidth={1.75} aria-hidden />
              Duplicate to edit
            </Button>
          )}
        </div>
      </div>
    </>
  )
}

const kb = (chars: number): string => (chars < 1_000 ? `${chars} characters` : `${(chars / 1024).toFixed(1)} KB`)
