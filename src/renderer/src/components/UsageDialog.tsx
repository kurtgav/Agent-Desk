import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { HooksPreview } from '@shared/bridge'
import { Button, Code, cn, modalFooter, modalLede, modalOverlay, modalPanel, modalTitle } from './ui'

export type UsageMode = 'on' | 'off'

const COPY: Record<UsageMode, { title: string; lead: string; action: string; nothing: string }> = {
  on: {
    title: 'Send usage figures to AgentDeck',
    lead: "AgentDeck adds a few environment settings to your Claude Code user settings. Claude Code then tells AgentDeck, on this PC only, how many tokens each request used and its estimated cost. No prompts, replies, file contents or account details are sent. It applies to sessions you start after this.",
    action: 'Turn on usage figures',
    nothing: 'settings.json already has these entries.'
  },
  off: {
    title: 'Stop sending usage figures',
    lead: "Removes only AgentDeck's entries from your Claude Code user settings. Sessions already open keep sending until they end. The figures AgentDeck already has stay.",
    action: 'Turn off usage figures',
    nothing: 'settings.json has no AgentDeck usage entries.'
  }
}

/** One line of the masked unified diff, coloured by its marker (the same reading as the hooks dialog). */
function DiffLine({ line }: { line: string }) {
  const tone = line.startsWith('@@') ? 'text-muted' : line.startsWith('+') ? 'bg-[var(--done-bg)] text-[var(--done-ink)]' : line.startsWith('-') ? 'bg-[var(--failed-bg)] text-[var(--failed-ink)]' : ''
  return <span className={cn('block px-3', tone)}>{line || ' '}</span>
}

/**
 * ADR-0005 § 4 for the usage entries (ADR-0007): the exact change to settings.json is shown first, and main writes it
 * only from the button here.
 */
export function UsageDialog({ mode, onClose, onDone }: { mode: UsageMode | null; onClose: () => void; onDone: () => void }) {
  const [preview, setPreview] = useState<HooksPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const bridge = window.agentdeck
    if (!mode || !bridge) return
    let current = true
    setPreview(null)
    setError(null)
    void bridge
      .previewUsageTelemetry(mode === 'on')
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
    const r = await bridge.setUsageTelemetry(mode === 'on').catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }))
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
          <Dialog.Description className={modalLede}>{copy?.lead}</Dialog.Description>

          {!preview && !error && <p className="mt-4 text-[13px] text-muted">Reading settings.json…</p>}

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
                  A copy of the current file is saved first in <code className="break-all">{preview.backups}</code>. Below, the values already in your file and AgentDeck's token are hidden; the keys and AgentDeck's address show.
                </p>
              )}
              {preview.changed ? (
                <pre role="region" tabIndex={0} aria-label="Changes to settings.json" className="mt-3 min-h-0 flex-1 overflow-auto rounded-tile bg-well py-2 font-mono text-[12px] leading-5">
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
