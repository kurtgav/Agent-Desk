import { useState } from 'react'
import { Copy, FileDown, FolderOpen } from 'lucide-react'
import type { ActionResult } from '@shared/bridge'
import type { EodReport, EodWrite } from '@shared/work'
import { renderEodMarkdown } from '@shared/eod-markdown'
import { useUi } from '@/store'
import { Button } from '../ui'
import { useIsDemo } from './useEod'

const FAILED_TEXT = 'AgentDeck could not do that.'
const FAILED: ActionResult = { ok: false, error: FAILED_TEXT }
const NO_BRIDGE = 'This works in the AgentDeck window, not in a plain browser.'

/**
 * Copy the report as Markdown, write its file now, open the report folder. Demo data writes and opens nothing (D-035);
 * copying only reaches the clipboard, so it works there too. The path of a file just written stays on screen.
 */
export function ReportActions({ report }: { report: EodReport }) {
  const notify = useUi((s) => s.notify)
  const demo = useIsDemo()
  const [wrote, setWrote] = useState<{ day: string; path: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const copy = async (): Promise<void> => {
    if (!window.agentdeck) return notify(NO_BRIDGE, 'error')
    const r = await window.agentdeck.copyText(renderEodMarkdown(report)).catch(() => FAILED)
    notify(r.ok ? 'Copied the report as Markdown.' : r.error, r.ok ? 'ok' : 'error')
  }
  const write = async (): Promise<void> => {
    if (demo) return notify('Demo data: nothing was written.')
    if (busy) return
    setBusy(true)
    const r: EodWrite = await window.agentdeck!.writeEod(report.day).catch(() => ({ ok: false as const, error: FAILED_TEXT }))
    setBusy(false)
    if (r.ok) setWrote({ day: report.day, path: r.path })
    notify(r.ok ? 'Wrote the report file.' : r.error, r.ok ? 'ok' : 'error')
  }
  const openFolder = async (): Promise<void> => {
    if (demo) return notify('Demo data: nothing was opened.')
    const r = await window.agentdeck!.openEodFolder().catch(() => FAILED)
    if (!r.ok) notify(r.error, 'error')
  }

  const path = wrote?.day === report.day ? wrote.path : null
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button onClick={() => void copy()}>
          <Copy size={14} strokeWidth={1.75} />
          Copy as Markdown
        </Button>
        <Button aria-busy={busy} onClick={() => void write()}>
          <FileDown size={14} strokeWidth={1.75} />
          Write file now
        </Button>
        <Button variant="ghost" onClick={() => void openFolder()}>
          <FolderOpen size={14} strokeWidth={1.75} />
          Open folder
        </Button>
      </div>
      {path && (
        <p className="max-w-[56ch] truncate text-[12px] text-muted" title={path}>
          Wrote <span className="text-ink">{path}</span>
        </p>
      )}
    </div>
  )
}
