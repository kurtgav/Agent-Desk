import { useId, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import {
  ROLE_DESCRIPTION_MAX, ROLE_NAME_MAX, ROLE_PROMPT_MAX, ROLE_VIBE_MAX, checkCustomRole, cleanLine,
  type CustomRoleInput, type RoleDetail, type RoleField, type RoleSummary
} from '@shared/roles'
import { OWN_DIVISIONS } from '@shared/role-catalog'
import { useUi } from '@/store'
import { Button, IconButton, cn, modalOverlay, modalLede, modalTitle } from '../ui'
import { CardFace } from './RoleCard'
import { useRolesStore } from './store'

const PICKS = ['🤖', '🧠', '🧭', '🛠️', '🔬', '🎯', '📣', '🎨', '📈', '🧪', '🔐', '📝', '🚀', '🧩']
const FIELD = 'w-full rounded-lg border border-control bg-surface px-3 text-[13px] text-ink outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent aria-[invalid=true]:border-[var(--failed)]'

interface Draft {
  name: string
  emoji: string
  vibe: string
  description: string
  prompt: string
}

/** The fields that show a hint line under them (the others are self-explanatory). */
const HINTED = new Set<RoleField>(['vibe', 'description', 'prompt'])

const EMPTY: Draft = { name: '', emoji: '🤖', vibe: '', description: '', prompt: '' }

const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`

function Field({ id, label, hint, error, count, children }: { id: string; label: string; hint?: string; error?: string; count?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="t-label">
          {label}
        </label>
        {count && <span className="t-meta tabular-nums text-muted">{count}</span>}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="t-meta text-[var(--failed-ink)]">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="t-meta text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

interface FormProps {
  /** Null = closed. A detail with a prompt = editing that custom role; `{}` shaped as EMPTY = creating. */
  mode: { kind: 'create' } | { kind: 'edit'; role: RoleDetail } | null
  onClose(): void
  onSaved(r: RoleSummary): void
}

/**
 * Create or edit a custom role. Checked as you type with the same rules main enforces; a problem shows once you have left the field
 * or tried to save. The card on the right is what the role will look like in the list.
 */
export function RoleForm({ mode, onClose, onSaved }: FormProps) {
  return (
    <Dialog.Root open={mode !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={modalOverlay} />
        <Dialog.Content
          aria-describedby="role-form-lede"
          className="anim-rise fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-48px)] w-[880px] max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card border border-line bg-overlay shadow-modal outline-none"
        >
          {/* Its own component, so the draft starts over each time the dialog opens. */}
          {mode && <FormBody key={mode.kind === 'edit' ? mode.role.id : 'new'} mode={mode} onClose={onClose} onSaved={onSaved} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function FormBody({ mode, onClose, onSaved }: { mode: NonNullable<FormProps['mode']>; onClose(): void; onSaved(r: RoleSummary): void }) {
  const editing = mode.kind === 'edit' ? mode.role : null
  const uid = useId()
  const [draft, setDraft] = useState<Draft>(editing ? { name: editing.name, emoji: editing.emoji, vibe: editing.vibe, description: editing.description, prompt: editing.prompt ?? '' } : EMPTY)
  const [seen, setSeen] = useState<ReadonlySet<RoleField>>(new Set())
  const [saving, setSaving] = useState(false)
  const [server, setServer] = useState<{ field?: RoleField; error: string } | null>(null)

  const input: CustomRoleInput = { id: editing?.id ?? null, ...draft }
  const problems = new Map(checkCustomRole(input).map((p) => [p.field, p.message]))
  const error = (f: RoleField): string | undefined => (server?.field === f ? server.error : seen.has(f) ? problems.get(f) : undefined)
  const touch = (f: RoleField) => () => setSeen((s) => new Set(s).add(f))
  const set = (patch: Partial<Draft>): void => {
    setDraft((d) => ({ ...d, ...patch }))
    setServer(null)
  }
  const bytes = new TextEncoder().encode(draft.prompt.trim()).length

  const save = async (): Promise<void> => {
    if (problems.size) {
      setSeen(new Set(['name', 'emoji', 'vibe', 'description', 'prompt']))
      document.getElementById(`${uid}-${[...problems.keys()][0]}`)?.focus()
      return
    }
    setSaving(true)
    const r = await useRolesStore.getState().save(input)
    setSaving(false)
    if (r.ok) {
      useUi.getState().notify(editing ? `Saved “${r.role.name}”.` : `Created “${r.role.name}”.`)
      onSaved(r.role)
    } else {
      setServer({ field: r.field, error: r.error })
      if (r.field) document.getElementById(`${uid}-${r.field}`)?.focus()
    }
  }

  const meta = OWN_DIVISIONS.custom!
  const preview = {
    id: 'preview', name: cleanLine(draft.name), division: 'custom', divisionLabel: meta.label, emoji: draft.emoji.trim() || '🤖', color: meta.color,
    vibe: cleanLine(draft.vibe), description: cleanLine(draft.description), source: 'custom' as const, installed: false, agentName: null, promptChars: bytes
  }
  const attrs = (f: RoleField): { id: string; 'aria-invalid': boolean; 'aria-describedby': string | undefined } => ({
    id: `${uid}-${f}`,
    'aria-invalid': error(f) !== undefined,
    'aria-describedby': error(f) ? `${uid}-${f}-error` : HINTED.has(f) ? `${uid}-${f}-hint` : undefined
  })

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <header className="flex flex-none items-start gap-3 px-6 pb-4 pt-5">
        <div className="min-w-0 flex-1">
          <Dialog.Title className={modalTitle}>{editing ? 'Edit role' : 'Create a role'}</Dialog.Title>
          <Dialog.Description id="role-form-lede" className={modalLede}>
            A role is a name, a one-liner and the text Claude Code works from. It is saved as a Markdown file on this PC, so you can edit it by hand too.
          </Dialog.Description>
        </div>
        <Dialog.Close asChild>
          <IconButton aria-label="Close" className="-mr-2 -mt-1">
            <X size={16} strokeWidth={1.75} />
          </IconButton>
        </Dialog.Close>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_288px] gap-6 overflow-y-auto border-t border-line px-6 py-5">
        <div className="flex min-w-0 flex-col gap-4">
          <Field id={`${uid}-name`} label="Name" error={error('name')} count={`${draft.name.length}/${ROLE_NAME_MAX}`}>
            <input {...attrs('name')} type="text" value={draft.name} autoFocus maxLength={ROLE_NAME_MAX + 20} onBlur={touch('name')} onChange={(e) => set({ name: e.target.value })} placeholder="Release Notes Writer" className={cn(FIELD, 'h-9')} />
          </Field>

          <Field id={`${uid}-emoji`} label="Emoji" error={error('emoji')}>
            <div className="flex items-center gap-2">
              <input {...attrs('emoji')} type="text" value={draft.emoji} maxLength={16} onBlur={touch('emoji')} onChange={(e) => set({ emoji: e.target.value })} className={cn(FIELD, 'h-9 w-16 flex-none text-center text-[16px]')} />
              <div role="group" aria-label="Suggested emoji" className="flex min-w-0 flex-wrap gap-0.5">
                {PICKS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-label={`Use ${p}`}
                    aria-pressed={draft.emoji === p}
                    onClick={() => set({ emoji: p })}
                    className="press flex size-7 items-center justify-center rounded-lg text-[15px] hover:bg-hover aria-pressed:bg-active"
                  >
                    <span aria-hidden>{p}</span>
                  </button>
                ))}
              </div>
            </div>
          </Field>

          <Field id={`${uid}-vibe`} label="One-liner" error={error('vibe')} hint="Optional. One line in the role's own voice." count={`${draft.vibe.length}/${ROLE_VIBE_MAX}`}>
            <input {...attrs('vibe')} type="text" value={draft.vibe} onBlur={touch('vibe')} onChange={(e) => set({ vibe: e.target.value })} placeholder="Turns a diff into notes a customer would read." className={cn(FIELD, 'h-9')} />
          </Field>

          <Field id={`${uid}-description`} label="Description" error={error('description')} hint="What it is for, in a sentence or two." count={`${cleanLine(draft.description).length}/${ROLE_DESCRIPTION_MAX}`}>
            <textarea {...attrs('description')} rows={2} value={draft.description} onBlur={touch('description')} onChange={(e) => set({ description: e.target.value })} className={cn(FIELD, 'resize-y py-2 leading-5')} />
          </Field>

          <Field id={`${uid}-prompt`} label="Role text" error={error('prompt')} hint="Who it is, what it does, how it works, what it will not do." count={`${kb(bytes)} of ${ROLE_PROMPT_MAX / 1024} KB`}>
            <textarea {...attrs('prompt')} rows={8} value={draft.prompt} onBlur={touch('prompt')} onChange={(e) => set({ prompt: e.target.value })} className={cn(FIELD, 'resize-y py-2 font-mono text-[12px] leading-5')} />
          </Field>
        </div>

        <div className="flex flex-col gap-2">
          <p className="t-label">Preview</p>
          <div aria-hidden className="flex min-h-[156px] flex-col gap-3 rounded-card border border-line bg-surface p-4">
            <CardFace role={preview} showDivision={false} />
          </div>
          <p className="t-meta text-pretty text-muted">This is how the role looks in the list. Saved in a roles folder in AgentDeck's data folder.</p>
        </div>
      </div>

      <footer className="flex flex-none items-center gap-3 border-t border-line px-6 py-4">
        {server && !server.field && (
          <p role="alert" className="t-meta min-w-0 flex-1 text-[var(--failed-ink)]">
            {server.error}
          </p>
        )}
        <div className="ml-auto flex gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {editing ? 'Save changes' : 'Create role'}
          </Button>
        </div>
      </footer>
    </form>
  )
}
