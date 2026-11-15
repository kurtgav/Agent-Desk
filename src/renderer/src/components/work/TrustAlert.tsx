import { useState } from 'react'
import { X } from 'lucide-react'
import { runClaudeThere } from '@/lib/act'
import { Button, IconButton } from '../ui'
import type { Untrusted } from './sendTask'

/** The composer's answer to "Workspace not trusted": the CLI's own sentence and the fix, in a terminal in that folder (D-100). */
export function TrustAlert({ trust, onDismiss }: { trust: Untrusted; onDismiss(): void }) {
  const [opening, setOpening] = useState(false)
  return (
    <div role="alert" className="flex items-center gap-3 rounded-tile bg-[var(--failed-bg)] py-2 pl-3 pr-1.5 text-[13px] text-[var(--failed-ink)]">
      <p className="min-w-0 flex-1 text-pretty [overflow-wrap:anywhere]">{trust.error}</p>
      <Button
        size="sm"
        aria-busy={opening}
        className="aria-busy:opacity-60"
        onClick={() => {
          if (opening) return
          setOpening(true)
          void runClaudeThere(trust.cwd).finally(() => setOpening(false))
        }}
      >
        Run claude there
      </Button>
      <IconButton aria-label="Dismiss" className="text-[var(--failed-ink)]" onClick={onDismiss}>
        <X size={15} strokeWidth={1.75} />
      </IconButton>
    </div>
  )
}
