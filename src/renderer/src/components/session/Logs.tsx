import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { LogsResult } from '@shared/bridge'
import type { Session } from '@shared/snapshot'
import { useUi } from '@/store'
import { Button, Code, EmptyState, cn } from '../ui'

/** Read once when it opens; Refresh reads again. The previous output stays up while the next one loads. */
export function Logs({ session }: { session: Session }) {
  const demo = useUi((s) => s.snapshot.mode === 'demo') || !window.agentdeck
  const [round, setRound] = useState(0)
  const [got, setGot] = useState<{ key: string; r: LogsResult } | null>(null)
  const key = `${session.id}:${round}`
  useEffect(() => {
    if (demo) return
    let current = true
    void window.agentdeck!
      .logs(session.id)
      .catch((): LogsResult => ({ ok: false, error: 'AgentDeck could not run claude logs.' }))
      .then((r) => {
        if (current) setGot({ key: `${session.id}:${round}`, r })
      })
    return () => {
      current = false
    }
  }, [demo, session.id, round])
  const busy = !demo && got?.key !== key
  const r: LogsResult | null = demo ? { ok: false, error: 'Demo data has no background session to read.' } : (got?.r ?? null)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="text-[12px] text-muted">
          Output of <Code>claude logs {session.bgId}</Code>
        </p>
        <Button size="sm" variant="quiet" className="ml-auto" onClick={() => setRound((n) => n + 1)} disabled={busy || demo}>
          <RefreshCw size={14} strokeWidth={1.75} className={cn(busy && 'animate-spin motion-reduce:animate-none')} />
          Refresh
        </Button>
      </div>
      {r === null ? (
        <EmptyState center>Reading…</EmptyState>
      ) : r.ok ? (
        <pre className="max-h-72 overflow-auto whitespace-pre rounded-tile bg-well p-3 font-mono text-[12px] leading-[18px]">{r.text || '(no output)'}</pre>
      ) : (
        <p className="rounded-tile bg-[var(--failed-bg)] p-3 text-[13px] text-[var(--failed-ink)]">{r.error}</p>
      )}
    </div>
  )
}
