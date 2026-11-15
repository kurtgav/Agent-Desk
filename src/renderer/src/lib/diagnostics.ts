/**
 * What "Copy diagnostics" puts on the clipboard when a page fails: where it happened, the error and the build. Plain text a person
 * can paste into an issue. It holds no session text, no prompt and no file contents: only the error's own message and stack.
 */

export interface ErrorInfo {
  message: string
  stack: string | null
}

const MESSAGE_MAX = 500
const STACK_MAX = 4_000

export function describeError(error: unknown): ErrorInfo {
  if (error instanceof Error) return { message: error.message.slice(0, MESSAGE_MAX) || error.name, stack: error.stack?.slice(0, STACK_MAX) ?? null }
  if (typeof error === 'string') return { message: error.slice(0, MESSAGE_MAX), stack: null }
  try {
    return { message: JSON.stringify(error)?.slice(0, MESSAGE_MAX) ?? 'Unknown error', stack: null }
  } catch {
    return { message: 'Unknown error', stack: null }
  }
}

export interface DiagnosticsInput {
  /** The page or area that failed ("Tasks", "Session"). */
  where: string
  error: ErrorInfo
  version: string
  at: number
  componentStack?: string | null
}

export function diagnosticsText({ where, error, version, at, componentStack }: DiagnosticsInput): string {
  return [
    `AgentDeck ${version}`,
    `When: ${new Date(at).toISOString()}`,
    `Where: ${where}`,
    `Error: ${error.message}`,
    ...(error.stack ? ['', 'Stack:', error.stack] : []),
    ...(componentStack ? ['', 'Component stack:', componentStack.trim().slice(0, STACK_MAX)] : [])
  ].join('\n')
}
