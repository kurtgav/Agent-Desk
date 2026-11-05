import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { HooksPreview } from '@shared/bridge'
import { Button, cn } from './ui'

export type IntegrationMode = 'install' | 'uninstall'

const COPY: Record<IntegrationMode, { title: string; lead: string; action: string; nothing: string }> = {
  install: {
    title: 'Connect AgentDeck to Claude Code',
    lead: 'AgentDeck adds one HTTP hook per event to your Claude Code user settings, so every session reports what it is doing. It removes them when you quit AgentDeck and adds them back when it starts. Nothing else in the file changes.',
    action: 'Install hooks',
    nothing: 'settings.json already has these entries.'
  },
  uninstall: {
    title: "Remove AgentDeck's hooks",
    lead: "Removes only AgentDeck's entries from your Claude Code user settings. AgentDeck stops adding them at launch until you install them again.",
    action: 'Remove hooks',
    nothing: 'settings.json has no AgentDeck entries.'
  }
}

/** One line of the masked unified diff, coloured by its marker. */
function DiffLine({ line }: { line: string }) {
  const tone = line.startsWith('@@') ? 'text-muted' : line.startsWith('+') ? 'bg-[var(--done-bg)] text-[var(--done-ink)]' : line.startsWith('-') ? 'bg-[var(--failed-bg)] text-[var(--failed-ink)]' : ''
  return <span className={cn('block px-3', tone)}>{line || ' '}</span>
}

/**
 * ADR-0005 § 4: the first install, and any change in its shape, shows the diff and needs an explicit OK.
 * Main writes settings.json only from the button here.
 */
export function IntegrationDialog({ mode, onClose }: { mode: IntegrationMode | null; onClose: () => void }) {
  const [preview, setPreview] = useState<HooksPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const bridge = window.agentdeck
    if (!mode || !bridge) return
    let current = true
    setPreview(null)
    setError(null)
    void (mode === 'install' ? bridge.previewInstall() : bridge.previewUninstall())
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
    const r = await (mode === 'install' ? bridge.installHooks() : bridge.uninstallHooks()).catch((e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : String(e)
    }))
    setBusy(false)
    if (r.ok) onClose()
    else setError(r.error)
  }

  const copy = mode ? COPY[mode] : null
  // The diff's first two lines are the ---/+++ file headers.
  const lines = preview?.ok ? preview.diff.split('\n').slice(2) : []
  return (
    <Dialog.Root open={mode !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[600px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card border border-line bg-surface p-5 shadow-[0_16px_48px_rgb(0_0_0/0.16)]">
          <Dialog.Title className="text-[15px] font-semibold [text-wrap:balance]">{copy?.title}</Dialog.Title>
          <Dialog.Description className="mt-1 text-[13px] leading-5 text-muted [text-wrap:pretty]">{copy?.lead}</Dialog.Description>

          {!preview && !error && <p className="mt-4 text-[13px] text-muted">Reading settings.json…</p>}

          {preview && !preview.ok && (
            <p role="alert" className="mt-4 rounded-tile bg-[var(--failed-bg)] p-3 text-[13px] text-[var(--failed-ink)]">
              {preview.error} AgentDeck did not change <code>{preview.path}</code>.
            </p>
          )}

          {preview?.ok && (
            <>
              <p className="mt-4 text-[13px]">
                File: <code className="break-all rounded-[4px] bg-well px-1 py-px">{preview.path}</code>
              </p>
              {preview.changed && (
                <p className="mt-1 text-[12px] text-muted">
                  A copy of the current file is saved first in <code className="break-all">{preview.backups}</code>. Token values are hidden below.
                </p>
              )}
              {preview.conflicts.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1 rounded-tile bg-[var(--needs-bg)] p-3 text-[13px] text-[var(--needs-ink)]">
                  {preview.conflicts.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
              {preview.changed ? (
                <pre aria-label="Changes to settings.json" className="mt-3 min-h-0 flex-1 overflow-auto rounded-tile bg-well py-2 font-mono text-[12px] leading-5">
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

          <div className="mt-5 flex justify-end gap-2">
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
