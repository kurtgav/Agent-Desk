import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Check, Copy, FolderOpen, RefreshCw, X } from 'lucide-react'
import { REPO_CLONE_COMMAND, type RolesStatus } from '@shared/roles'
import { useUi } from '@/store'
import { rolesApi } from '@/lib/roles'
import { copyToClipboard } from '../console/clipboard'
import { Button, IconButton, Pill, cn, modalOverlay, modalLede, modalTitle } from '../ui'
import { useRolesStore } from './store'

/** A command to run in a terminal, in a well, with a Copy button. AgentDeck never runs it. */
export function CommandLine({ command, label }: { command: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    if (!(await copyToClipboard(command))) return useUi.getState().notify('AgentDeck could not copy that.', 'error')
    setCopied(true)
    setTimeout(() => setCopied(false), 1_800)
  }
  return (
    <div className="flex items-center gap-2 rounded-lg bg-well py-1.5 pl-3 pr-1.5">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap bg-transparent p-0 text-[12px] text-ink" aria-label={label} tabIndex={0}>
        {command}
      </code>
      <Button size="sm" onClick={() => void copy()} aria-label={`Copy: ${label}`}>
        {copied ? <Check size={14} strokeWidth={2} aria-hidden /> : <Copy size={14} strokeWidth={1.75} aria-hidden />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

/** The way to point AgentDeck at a clone: a path box, Browse… and Use this folder. Checked in main before it is saved. */
function FolderField({ current }: { current: string | null }) {
  const [path, setPath] = useState(current ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const apply = async (value: string | null): Promise<void> => {
    setBusy(true)
    setError(null)
    const r = await useRolesStore.getState().setRepo(value)
    setBusy(false)
    if (!r.ok) setError(r.error)
    else useUi.getState().notify(value ? `Reading roles from ${value}.` : 'Went back to the default folder.')
  }
  const browse = async (): Promise<void> => {
    const picked = await rolesApi().browse()
    if (picked) {
      setPath(picked)
      void apply(picked)
    }
  }
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        if (path.trim()) void apply(path.trim())
      }}
      className="flex flex-col gap-1.5"
    >
      <label htmlFor="roles-repo-path" className="t-label">
        Or use a copy you already have
      </label>
      <div className="flex items-center gap-2">
        <input
          id="roles-repo-path"
          type="text"
          value={path}
          onChange={(e) => {
            setPath(e.target.value)
            setError(null)
          }}
          placeholder="C:\Users\you\agency-agents"
          aria-invalid={error !== null}
          aria-describedby={error ? 'roles-repo-error' : undefined}
          spellCheck={false}
          className="h-9 min-w-0 flex-1 rounded-lg border border-control bg-surface px-3 font-mono text-[12px] text-ink outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent aria-[invalid=true]:border-[var(--failed)]"
        />
        <Button onClick={() => void browse()} disabled={busy}>
          <FolderOpen size={14} strokeWidth={1.75} aria-hidden />
          Browse…
        </Button>
        <Button type="submit" variant="primary" disabled={busy || !path.trim()}>
          Use this folder
        </Button>
      </div>
      {error && (
        <p id="roles-repo-error" role="alert" className="t-meta text-[var(--failed-ink)]">
          {error}
        </p>
      )}
      {current && (
        <button type="button" className="t-meta w-fit text-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => void apply(null)}>
          Forget this folder
        </button>
      )}
    </form>
  )
}

/** Shown when no clone is found: what is missing, the one command that fixes it, and the other way. Never a dead end. */
export function RepoSetup({ status }: { status: RolesStatus }) {
  const refreshing = useRolesStore((s) => s.refreshing)
  return (
    <section aria-label="Get the agency roles" className="rounded-card border border-line bg-surface p-5">
      <h2 className="t-title">Add the agency roles</h2>
      <p className="mt-1 max-w-[62ch] text-pretty text-[13px] leading-5 text-muted">
        {status.configuredMissing && status.configuredPath ? (
          <>
            The folder you chose, <code>{status.configuredPath}</code>, is not there. Pick it again, or fetch the library below.
          </>
        ) : (
          <>
            The roles you see now are AgentDeck's own and the agents you installed in Claude Code. The open-source <strong className="font-medium text-ink">agency-agents</strong> library adds
            about 280 more, from engineering to sales. It is not on this PC yet.
          </>
        )}
      </p>
      <div className="mt-4 flex flex-col gap-1.5">
        <p className="t-label">Get it with git</p>
        <CommandLine command={REPO_CLONE_COMMAND} label="clone command" />
        <p className="t-meta text-pretty text-muted">
          Run it inside <code>{status.suggestedPath.replace(/[\\/]agency-agents$/, '')}</code> (any folder works), then choose Reload. AgentDeck never downloads anything itself.
        </p>
      </div>
      <div className="mt-4">
        <FolderField current={status.configuredPath} />
      </div>
      <div className="mt-4">
        <Button onClick={() => void useRolesStore.getState().reload()} disabled={refreshing}>
          <RefreshCw size={14} strokeWidth={1.75} aria-hidden className={cn(refreshing && 'animate-spin motion-reduce:animate-none')} />
          Reload roles
        </Button>
      </div>
    </section>
  )
}

function Row({ name, where, detail, found }: { name: string; where: string; detail: string; found: boolean }) {
  return (
    <li className="flex items-start gap-3 border-t border-rule py-3 first:border-t-0">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium leading-5">{name}</p>
        <p className="t-meta mt-0.5 break-all text-muted">{where}</p>
      </div>
      <div className="flex flex-none flex-col items-end gap-1">
        <Pill tone={found ? 'done' : 'idle'}>{found ? 'Found' : 'Not found'}</Pill>
        <span className="t-meta tabular-nums text-muted">{detail}</span>
      </div>
    </li>
  )
}

/** Where the roles come from, how many of each, how to update them, and Reload. All of it is local files. */
export function SourcesDialog({ open, status, onClose }: { open: boolean; status: RolesStatus; onClose(): void }) {
  const refreshing = useRolesStore((s) => s.refreshing)
  const c = status.counts
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={modalOverlay} />
        <Dialog.Content
          aria-describedby="roles-sources-lede"
          className="anim-rise fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-48px)] w-[640px] max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card border border-line bg-overlay shadow-modal outline-none"
        >
          <header className="flex flex-none items-start gap-3 px-6 pb-4 pt-5">
            <div className="min-w-0 flex-1">
              <Dialog.Title className={modalTitle}>Where roles come from</Dialog.Title>
              <Dialog.Description id="roles-sources-lede" className={modalLede}>
                Four places on this PC. AgentDeck reads the files and sends nothing anywhere.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton aria-label="Close" className="-mr-2 -mt-1">
                <X size={16} strokeWidth={1.75} />
              </IconButton>
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-6 py-4">
            <ul>
              <Row name="Agency roles" where={status.repoPath ?? status.suggestedPath} detail={`${c.agency} roles${c.duplicates ? `, ${c.duplicates} duplicate hidden` : ''}`} found={status.repoFound} />
              <Row name="Claude Code agents" where={status.installedPath} detail={`${c.installedFlagged} installed, ${c.installed} not in the library`} found={status.installedFound} />
              <Row name="Your roles" where={status.customPath} detail={`${c.custom} ${c.custom === 1 ? 'role' : 'roles'}`} found />
              <Row name="Built in to AgentDeck" where="Leadership roles that ship with the app" detail={`${c.builtin} roles`} found />
            </ul>
            {c.skipped > 0 && <p className="t-meta mt-1 text-muted">{c.skipped} files were skipped: unreadable, too large, or without a name.</p>}

            <div className="mt-5 flex flex-col gap-1.5">
              <h3 className="t-label">Update the agency roles</h3>
              {status.repoPath ? (
                <>
                  <CommandLine command={`git -C "${status.repoPath}" pull`} label="update command" />
                  <p className="t-meta text-muted">Run it in a terminal, then choose Reload. AgentDeck itself never fetches anything.</p>
                </>
              ) : (
                <p className="t-meta text-muted">Nothing to update yet. Add the library first.</p>
              )}
            </div>
            <div className="mt-5">
              <FolderField current={status.configuredPath} />
            </div>
            <p className="t-meta mt-5 border-t border-rule pt-4 text-pretty text-muted">
              The library is msitarzewski/agency-agents (MIT licence), read from your own copy and never bundled. The leadership roles were written for AgentDeck.
            </p>
          </div>
          <footer className="flex flex-none justify-end gap-2 border-t border-line px-6 py-4">
            <Button onClick={() => void useRolesStore.getState().reload()} disabled={refreshing}>
              <RefreshCw size={14} strokeWidth={1.75} aria-hidden className={cn(refreshing && 'animate-spin motion-reduce:animate-none')} />
              Reload roles
            </Button>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

