import { Component, useEffect, type ErrorInfo as ReactErrorInfo, type ReactNode } from 'react'
import { TriangleAlert, X } from 'lucide-react'
import agentBot from '@/assets/agent-bot.webp'
import { useUi } from '@/store'
import { describeError, diagnosticsText, type ErrorInfo } from '@/lib/diagnostics'
import { copyToClipboard } from '../console/clipboard'
import { Button, IconButton } from '../ui'
import { newSession } from './actions'

/** Puts the error report on the clipboard and says so (or says it could not): never silent. */
export async function copyDiagnostics(where: string, error: ErrorInfo, componentStack?: string | null): Promise<void> {
  const { version, notify } = useUi.getState()
  const ok = await copyToClipboard(diagnosticsText({ where, error, version, at: Date.now(), componentStack }))
  notify(ok ? 'Copied the diagnostics. Paste them into an issue.' : 'AgentDeck could not copy that. Select the text in Settings › Diagnostics instead.', ok ? 'ok' : 'error')
}

/** What a failed page shows instead of a white screen: calm words, and three ways out. */
export function RecoveryCard({ where, error, componentStack, onRetry }: { where: string; error: ErrorInfo; componentStack?: string | null; onRetry(): void }) {
  return (
    <div role="alert" data-testid="recovery-card" className="mx-auto flex max-w-[520px] flex-col items-center px-6 py-16 text-center">
      <img src={agentBot} alt="" width={64} height={64} draggable={false} className="size-16 rounded-2xl" />
      <h2 className="t-heading mt-4">{where} ran into a problem</h2>
      <p className="mt-1.5 max-w-[46ch] text-pretty text-[14px] leading-5 text-muted">
        AgentDeck is still running, and your sessions are not affected. Try again. If it keeps happening, copy the diagnostics into an issue.
      </p>
      <p className="mt-3 max-w-full truncate rounded-md bg-well px-2 py-1 font-mono text-[12px] text-muted" title={error.message}>
        {error.message}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button variant="primary" onClick={onRetry}>
          Try again
        </Button>
        <Button onClick={() => void copyDiagnostics(where, error, componentStack)}>Copy diagnostics</Button>
        <Button variant="ghost" onClick={newSession}>
          Go to a new session
        </Button>
      </div>
    </div>
  )
}

interface Props {
  /** The page or area, in the words the card uses: "Tasks", "This session". */
  where: string
  /** Change it and a failed boundary tries again (a new page, another session). */
  resetKey?: string
  children: ReactNode
}

interface State {
  error: ErrorInfo | null
  componentStack: string | null
}

/**
 * A failure in one page or in the open session shows a recovery card in its place; the sidebar, the top bar and every other page
 * keep working (QUALITY § Reliability). Moving to another page resets it, so one bad page never traps you.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, componentStack: null }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: describeError(error) }
  }

  override componentDidCatch(_error: unknown, info: ReactErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null })
  }

  override componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null, componentStack: null })
  }

  override render(): ReactNode {
    const { error, componentStack } = this.state
    if (!error) return this.props.children
    return <RecoveryCard where={this.props.where} error={error} componentStack={componentStack} onRetry={() => this.setState({ error: null, componentStack: null })} />
  }
}

/** Errors that mean nothing to a person and fix themselves: the browser's own notice that a resize observer needed another frame. */
export function isIgnorable(message: string): boolean {
  return /ResizeObserver loop/i.test(message)
}

/**
 * Anything that escapes every boundary (an event handler, a promise nobody awaited) is caught here once and said in plain words
 * at the top of the window. Only the first one shows: the ones it causes would bury it.
 */
export function RootErrors() {
  const crash = useUi((s) => s.crash)
  useEffect(() => {
    const report = (where: string, raised: unknown): void => {
      const error = describeError(raised)
      if (!isIgnorable(error.message)) useUi.getState().reportCrash(where, error)
    }
    const onError = (e: ErrorEvent): void => report('The window', e.error ?? e.message)
    const onRejection = (e: PromiseRejectionEvent): void => report('A background task', e.reason)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
  if (!crash) return null
  return (
    <div role="alert" className="flex flex-none items-start gap-3 border-b border-line bg-[var(--failed-bg)] px-5 py-2.5 text-[13px] leading-5 text-[var(--failed-ink)]">
      <TriangleAlert size={16} strokeWidth={1.75} aria-hidden className="mt-0.5 flex-none" />
      <p className="min-w-0 flex-1 text-pretty">
        <span className="font-medium">Something unexpected happened.</span> AgentDeck is still running and your sessions are not affected. If a page looks wrong, try it again.
      </p>
      <Button size="sm" onClick={() => void copyDiagnostics(crash.where, crash.error)}>
        Copy diagnostics
      </Button>
      <IconButton aria-label="Dismiss" className="-my-1 text-[var(--failed-ink)]" onClick={() => useUi.getState().dismissCrash()}>
        <X size={15} strokeWidth={1.75} />
      </IconButton>
    </div>
  )
}
