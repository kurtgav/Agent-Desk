import { useCallback, useEffect, useState } from 'react'
import { CircleCheck, TriangleAlert } from 'lucide-react'
import type { Diagnostics } from '@shared/work'
import { useUi } from '@/store'
import { Button } from '../ui'
import { StateNote } from '../pages/kit'
import { diagnosticsReport, formatBytes } from './report'
import { Section, Verdict } from './Section'

type Load = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; d: Diagnostics }

const COLLECTOR = { up: 'Running', down: 'Not running', demo: 'Not used with demo data' } as const

function Fact({ label, children, mono }: { label: string; children: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-[12px] leading-5 text-muted">{label}</dt>
      <dd className={mono ? 'break-all font-mono text-[12px] leading-5' : 'text-[13px] leading-5'}>{children}</dd>
    </>
  )
}

/** Settings › Diagnostics (ADR-0008): the checks as a status list, the versions and paths, and a report to paste into a bug. */
export function DiagnosticsSection() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const notify = useUi((s) => s.notify)

  const run = useCallback(() => {
    setLoad({ kind: 'loading' })
    const bridge = window.agentdeck
    if (!bridge) return setLoad({ kind: 'failed' })
    bridge.getDiagnostics().then(
      (d) => setLoad({ kind: 'ready', d }),
      () => setLoad({ kind: 'failed' })
    )
  }, [])
  useEffect(run, [run])

  async function copy(d: Diagnostics): Promise<void> {
    const r = await (window.agentdeck?.copyText(diagnosticsReport(d)) ?? Promise.resolve({ ok: false as const, error: 'Copying needs the AgentDeck window.' })).catch(() => ({
      ok: false as const,
      error: 'AgentDeck could not copy to the clipboard.'
    }))
    notify(r.ok ? 'Copied. Your home folder shows as ~ and no token is included.' : r.error, r.ok ? 'ok' : 'error')
  }

  const ready = load.kind === 'ready' ? load.d : null
  const failing = ready?.checks.filter((c) => !c.ok).length ?? 0
  return (
    <Section
      id="diagnostics"
      title="Diagnostics"
      description="What AgentDeck found on this PC, ready to paste into a bug report."
      action={
        <span className="flex gap-2">
          <Button variant="ghost" onClick={run}>
            Check again
          </Button>
          <Button variant="primary" onClick={() => ready && void copy(ready)} disabled={!ready}>
            Copy diagnostics
          </Button>
        </span>
      }
    >
      {load.kind === 'loading' && (
        <StateNote tone="loading" divided>
          Checking your setup…
        </StateNote>
      )}
      {load.kind === 'failed' && (
        <StateNote tone="error" title="Diagnostics are not available" divided>
          AgentDeck could not read its diagnostics. Press Check again to retry.
        </StateNote>
      )}
      {ready && (
        <>
          <p role="status" className="flex items-center gap-2 border-t border-rule px-4 py-3 text-[14px] font-medium">
            {failing === 0 ? (
              <CircleCheck size={16} strokeWidth={1.75} aria-hidden className="text-[var(--done-ink)]" />
            ) : (
              <TriangleAlert size={16} strokeWidth={1.75} aria-hidden className="text-[var(--needs-ink)]" />
            )}
            {failing === 0 ? `All ${ready.checks.length} checks passed.` : `${failing} of ${ready.checks.length} checks need attention.`}
          </p>
          <ul>
            {ready.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-4 border-t border-rule px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium leading-5">{c.label}</p>
                  <p className="mt-0.5 break-words text-pretty text-[12px] leading-4 text-muted">{c.detail}</p>
                </div>
                <Verdict ok={c.ok} />
              </li>
            ))}
          </ul>
          <dl className="mx-4 mb-4 mt-1 grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-tile bg-ground/70 px-4 py-3.5">
            <Fact label="AgentDeck">{`${ready.version} (Electron ${ready.electron}, Node ${ready.node})`}</Fact>
            <Fact label="System">{ready.os}</Fact>
            <Fact label="Running since">{new Date(ready.startedAt).toLocaleString()}</Fact>
            <Fact label="Collector">{`${COLLECTOR[ready.collector]}${ready.port !== null ? `, port ${ready.port}` : ''}`}</Fact>
            <Fact label="Claude Code">{ready.claudeVersion ? `${ready.claudeVersion}` : 'Not found'}</Fact>
            {ready.claudePath && (
              <Fact label="Claude Code path" mono>
                {ready.claudePath}
              </Fact>
            )}
            <Fact label="Data folder" mono>
              {ready.userData}
            </Fact>
            <Fact label="Database" mono>
              {`${ready.dbPath} (${formatBytes(ready.dbBytes)})`}
            </Fact>
          </dl>
          <p className="border-t border-rule px-4 py-3 text-[12px] leading-4 text-muted">Copy diagnostics shows your home folder as ~ and never includes the hooks token.</p>
        </>
      )}
    </Section>
  )
}
