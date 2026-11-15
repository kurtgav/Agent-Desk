import { create } from 'zustand'
import type { ConsoleCapabilities, McpListResult } from '@shared/console'
import { useUi } from '@/store'
import { demoMcpList } from './demo'

/**
 * What Claude can use, as last seen (for the `/` and `@` menus and the Capabilities drawer before a conversation has told its own),
 * and the on-demand `claude mcp list` check. Names only; the lists are capped in main (console-caps.ts).
 */

const KEY = 'agentdeck.console.capabilities'

function read(): ConsoleCapabilities | null {
  try {
    const raw = localStorage.getItem(KEY)
    const v: unknown = raw ? JSON.parse(raw) : null
    return v && typeof v === 'object' && Array.isArray((v as ConsoleCapabilities).commands) && Array.isArray((v as ConsoleCapabilities).mcpServers) ? (v as ConsoleCapabilities) : null
  } catch {
    return null
  }
}

function write(caps: ConsoleCapabilities): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(caps))
  } catch {
    // a per-viewer convenience only
  }
}

export type McpCheck =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'done'; result: Extract<McpListResult, { ok: true }> }
  | { state: 'failed'; error: string }

interface CapsState {
  /** From the newest conversation that reported it; null until one has. */
  last: ConsoleCapabilities | null
  mcp: McpCheck
}

export const useCaps = create<CapsState>(() => ({ last: read(), mcp: { state: 'idle' } }))

/** A conversation reported what it can use: remember it for the next one. Demo data is only held in memory: it must never reach live mode. */
export function rememberCapabilities(caps: ConsoleCapabilities, keep = true): void {
  useCaps.setState({ last: caps })
  if (keep) write(caps)
}

const demo = (): boolean => useUi.getState().snapshot.mode === 'demo' || !window.agentdeck
let run = 0

/** `claude mcp list`: up to 20 s, so it shows as checking, can be cancelled, and main keeps the answer for a minute. */
export async function checkMcp(cwd: string | null): Promise<void> {
  const n = ++run
  useCaps.setState({ mcp: { state: 'checking' } })
  const r: McpListResult = demo()
    ? await new Promise<McpListResult>((resolve) => setTimeout(() => resolve(demoMcpList()), 700))
    : await window.agentdeck!.consoleMcpList(cwd).catch((): McpListResult => ({ ok: false, error: 'AgentDeck could not reach its main process.' }))
  if (n !== run) return // cancelled, or asked again
  useCaps.setState({ mcp: r.ok ? { state: 'done', result: r } : { state: 'failed', error: r.error } })
}

export function cancelMcp(): void {
  run++
  useCaps.setState({ mcp: { state: 'idle' } })
  if (!demo()) void window.agentdeck!.consoleMcpCancel().catch(() => undefined)
}

export const resetCaps = (): void => useCaps.setState({ last: null, mcp: { state: 'idle' } })
