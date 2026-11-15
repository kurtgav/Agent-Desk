import { useEffect, useSyncExternalStore } from 'react'
import type { Usage } from '@shared/snapshot'
import { ago, tokens } from './format'
import { WEEKLY_BUDGET_MAX_USD, type ClaudeLink } from '@shared/work'

// The Claude Code link (shared/work.ts): where the local CLI stands and whether usage telemetry reaches AgentDeck. One copy
// for the Settings section, the sidebar's Usage card and the composer, so the window asks main (which starts claude.exe) once.

/** A window that was in the background asks again when it comes back, but not more often than this. */
const FRESH_MS = 30_000

let link: ClaudeLink | null = null
let loadedAt = 0
let pending: Promise<void> | null = null
const listeners = new Set<() => void>()

/** Asks main for the link unless the last answer is younger than `maxAgeMs`. Never rejects; a failed ask leaves the old answer. */
export function refreshClaudeLink(maxAgeMs = 0): Promise<void> {
  const bridge = window.agentdeck
  if (!bridge) return Promise.resolve()
  if (pending) return pending
  if (link && Date.now() - loadedAt < maxAgeMs) return Promise.resolve()
  pending = bridge
    .getClaudeLink()
    .then(
      (next) => {
        link = next
        loadedAt = Date.now()
        listeners.forEach((l) => l())
      },
      () => undefined
    )
    .finally(() => {
      pending = null
    })
  return pending
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** The link, or null before main has answered (and always without the preload bridge, where demo data stands in). */
export function useClaudeLink(): ClaudeLink | null {
  useEffect(() => {
    const ask = (): void => void refreshClaudeLink(FRESH_MS)
    ask()
    window.addEventListener('focus', ask)
    return () => window.removeEventListener('focus', ask)
  }, [])
  return useSyncExternalStore(subscribe, () => link, () => null)
}

// ---- What the link means in words ------------------------------------------------------------------------------------

export interface CliProblem {
  /** The send button's hint: what to do first. */
  hint: string
  /** Backticks mark `code` (Inline). */
  text: string
}

/** What stops a new session from starting, or null when nothing does (or when main hasn't said yet). */
export function cliProblem(l: ClaudeLink | null): CliProblem | null {
  if (!l) return null
  if (!l.cli.found) return { hint: 'Install Claude Code first', text: 'AgentDeck could not find Claude Code (`claude`), so a task cannot start. Install it, then check again.' }
  if (l.signIn === 'signed-out') return { hint: 'Sign in to Claude Code first', text: 'Claude Code is signed out. Run `claude` once in a terminal and sign in, then check again.' }
  return null
}

export interface SignInSummary {
  /** `ok`: the check mark; `bad`: needs attention; `unknown`: said in words only. */
  tone: 'ok' | 'bad' | 'unknown'
  text: string
}

export function signInSummary(l: ClaudeLink): SignInSummary {
  if (!l.cli.found) return { tone: 'unknown', text: 'Install Claude Code first. AgentDeck starts sessions through it.' }
  switch (l.signIn) {
    case 'subscription':
      return { tone: 'ok', text: `Signed in with your Claude subscription${l.plan ? ` (${l.plan})` : ''}. Sessions you start from AgentDeck run on it.` }
    case 'api-key':
      return { tone: 'ok', text: 'Signed in with an API key. Sessions you start from AgentDeck are billed to that key, by use.' }
    case 'signed-out':
      return { tone: 'bad', text: 'Signed out. Run `claude` once in a terminal and sign in.' }
    default:
      return { tone: 'unknown', text: 'AgentDeck could not tell how Claude Code is signed in. Sessions you start here still run through your own Claude Code.' }
  }
}

/**
 * What the sidebar's Usage line shows (D-139 superseded, ADR-0009 amendment):
 * `figures`: numbers. `reading`: the local logs are being read for the first time (or the collector has not answered yet).
 * `off`: no token source is on, so it shows what AgentDeck knows without one and offers the switch.
 * `waiting`: telemetry is on but no figures yet, and sessions already open will not report. `unknown`: main has not said yet.
 */
export type UsageState = 'figures' | 'reading' | 'off' | 'waiting' | 'unknown'

export function usageState(usage: Usage | null, l: ClaudeLink | null): UsageState {
  if (usage?.logs?.scan) return 'reading'
  if (usage) return 'figures'
  if (l?.usage.readLogs) return 'reading' // reading is on; the first snapshot with figures is on its way
  if (!l) return 'unknown'
  return l.usage.enabled ? 'waiting' : 'off'
}

/** "claude-opus-5-5" → "Opus 5.5"; a name it does not recognise is shown as it is. */
export function modelLabel(model: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(model)
  return m ? `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}` : model
}

/** "12 s ago", then minutes and up through `ago`. */
export function figureAge(ms: number): string {
  return ms < 60_000 ? `${Math.max(0, Math.floor(ms / 1000))} s ago` : ago(ms)
}

/** "14:00", in the reader's own clock and format. */
export const clockTime = (ts: number): string => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Settings' live line while the log reader is on: "Reading 214 log files, last figure 12 s ago". */
export function logsStatus(logs: NonNullable<Usage['logs']>, now: number): string {
  if (logs.scan) return `Reading your logs: ${logs.scan.done} of ${logs.scan.total} files.`
  const files = `${logs.files} log file${logs.files === 1 ? '' : 's'}`
  return logs.lastAt === null ? `Reading ${files}. No figure yet.` : `Reading ${files}, last figure ${figureAge(Math.max(0, now - logs.lastAt))}.`
}

/** The estimated 5-hour window, as one sentence for Settings (the sidebar writes it in two short lines). */
export function blockText(block: NonNullable<Usage['block']>): string {
  return `${tokens(block.tokens)} tokens since ${clockTime(block.startedAt)}; the window ends about ${clockTime(block.endsAt)}.`
}

/** "$40", "40.5", "1,200" → dollars to the cent; null for anything that is not a number above zero and within the limit. */
export function parseBudget(raw: string): number | null {
  const n = Number(raw.replace(/[$,\s]/g, ''))
  const cents = Math.round(n * 100) / 100
  return Number.isFinite(cents) && cents > 0 && n <= WEEKLY_BUDGET_MAX_USD ? cents : null
}

/** The line under the usage switch in Settings. */
export function usageHelp(u: ClaudeLink['usage']): string {
  if (!u.enabled) return 'Off. Claude Code sends no numbers to AgentDeck. Turning it on shows you the exact change to your Claude Code settings first.'
  return u.receiving
    ? 'On. Figures arrived in the last day. Only sessions started after this was switched on report.'
    : 'On. Waiting for the first figures: sessions already open will not report until they restart. Reading the logs (below) shows them now.'
}
