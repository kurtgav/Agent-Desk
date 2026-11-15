import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { HooksPreview } from '@shared/bridge'
import { Button, Code, cn, Inline, modalFooter, modalLede, modalOverlay, modalPanel, modalTitle } from './ui'

export type CodexMode = 'install' | 'uninstall'

const COPY: Record<CodexMode, { title: string; lead: string; action: string; nothing: string }> = {
  install: {
    title: 'Connect AgentDeck to Codex CLI',
    lead: "AgentDeck adds one command hook per event to your Codex CLI hooks.json, so every Codex CLI session reports what it is doing. Each one runs curl, which reads AgentDeck's address and token from a file in AgentDeck's own folder. The entries stay when you quit AgentDeck. Codex runs new hooks only after you trust them: open Codex and type `/hooks`. Nothing else in the file changes.",
    action: 'Install hooks',
    nothing: 'hooks.json already has these entries.'
  },
  uninstall: {
    title: "Remove AgentDeck's Codex CLI hooks",
    lead: "Removes only AgentDeck's entries from your Codex CLI hooks.json, and deletes the file their commands read.",
    action: 'Remove hooks',
    nothing: 'hooks.json has no AgentDeck entries.'
  }
}

/** One line of the masked unified diff, coloured by its marker (the same reading as the hooks dialog). */
function DiffLine({ line }: { line: string }) {
  const tone = line.startsWith('@@') ? 'text-muted' : line.startsWith('+') ? 'bg-[var(--done-bg)] text-[var(--done-ink)]' : line.startsWith('-') ? 'bg-[var(--failed-bg)] text-[var(--failed-ink)]' : ''
  return <span className={cn('block px-3', tone)}>{line || ' '}</span>
}

/**
 * ADR-0005 § 4 for Codex CLI's hooks.json (ADR-0014): the exact change is shown first, and main writes it only from the
 * button here.
 */
export function CodexDialog({ mode, onClose, onDone }: { mode: CodexMode | null; onClose: () => void; onDone: () => void }) {
  const [preview, setPreview] = useState<HooksPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const bridge = window.agentdeck
    if (!mode || !bridge) return
    let current = true
    setPreview(null)
    setError(null)
    void (mode === 'install' ? bridge.previewCodexInstall() : bridge.previewCodexUninstall())
      .then((p) => current && setPreview(p))
      .catch((e: unknown) => current && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      current = false
    }
  }, [mode])

  const apply = async (): Promise<void> => {
    const bridge = window.agentdeck
    if (!mode || !bridge) return
    setBusy(true)
    const r = await (mode === 'install' ? bridge.installCodexHooks() : bridge.uninstallCodexHooks()).catch((e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : String(e)
    }))
    setBusy(false)
    if (r.ok) {
      onDone()
      onClose()
    } else setError(r.error)
  }

  const copy = mode ? COPY[mode] : null
  // The diff's first two lines are the ---/+++ file headers.
  const lines = preview?.ok ? preview.diff.split('\n').slice(2) : []
  return (
    <Dialog.Root open={mode !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={modalOverlay} />
        <Dialog.Content className={cn(modalPanel, 'flex max-h-[85vh] w-[600px] max-w-[calc(100vw-32px)] flex-col')}>
          <Dialog.Title className={modalTitle}>{copy?.title}</Dialog.Title>
          <Dialog.Description className={modalLede}>{copy && <Inline text={copy.lead} />}</Dialog.Description>

          {!preview && !error && <p className="mt-4 text-[13px] text-muted">Reading hooks.json…</p>}

          {preview && !preview.ok && (
            <p role="alert" className="mt-4 rounded-tile bg-[var(--failed-bg)] p-3 text-[13px] text-[var(--failed-ink)]">
              {preview.error} AgentDeck did not change <code>{preview.path}</code>.
            </p>
          )}

          {preview?.ok && (
            <>
              <p className="mt-4 text-[13px] leading-5">
                File: <Code className="break-all">{preview.path}</Code>
              </p>
              {preview.changed && (
                <p className="t-meta mt-1.5 text-muted">
                  A copy of the current file is saved first in <code className="break-all">{preview.backups}</code>. Below, the values already in your file are hidden; only the keys and AgentDeck's commands show.
                </p>
              )}
              {preview.changed ? (
                <pre role="region" tabIndex={0} aria-label="Changes to hooks.json" className="mt-3 min-h-0 flex-1 overflow-auto rounded-tile bg-well py-2 font-mono text-[12px] leading-5">
                  {lines.map((l, i) => (
                    <DiffLine key={i} line={l} />
                  ))}
                </pre>
              ) : (
                <p className="mt-3 text-[13px] text-muted">Nothing to change: {copy?.nothing}</p>
              )}
            </>
          )}

          {error && (
            <p role="alert" className="mt-3 text-[13px] text-[var(--failed-ink)]">
              {error}
            </p>
          )}

          <div className={modalFooter}>
            <Dialog.Close asChild>
              <Button size="sm">{preview?.ok && preview.changed ? 'Cancel' : 'Close'}</Button>
            </Dialog.Close>
            {preview?.ok && preview.changed && (
              <Button variant="primary" size="sm" disabled={busy} onClick={() => void apply()}>
                {busy ? 'Writing…' : copy?.action}
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
