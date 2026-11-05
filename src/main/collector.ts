import { utilityProcess, type UtilityProcess } from 'electron'
import type { CollectorInit, FromCollector, ToCollector } from '@shared/collector'

/** ADR-0002: restart after 0.5 s, 1 s, 2 s … capped at 30 s; a run that lasted 30 s resets the ladder. */
export function restartDelay(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 30_000)
}
const HEALTHY_MS = 30_000

export interface Supervisor {
  post(m: ToCollector): void
  stop(): void
}

/**
 * Runs the collector in a utility process and keeps it running. Claude Code never depends on it (S2).
 * `onDown` fires when it exits unasked, so the UI stops showing data nobody is updating (D-059).
 */
export function superviseCollector(
  entry: string,
  init: CollectorInit,
  onMessage: (m: FromCollector) => void,
  onDown: () => void
): Supervisor {
  let child: UtilityProcess | null = null
  let stopped = false
  let attempt = 0
  let startedAt = 0
  let retry: NodeJS.Timeout | null = null
  // Visibility and focus are state: a restarted collector must get the latest of each.
  const latest = new Map<string, ToCollector>()

  const spawn = (): void => {
    retry = null
    startedAt = Date.now()
    const proc = utilityProcess.fork(entry, [], {
      serviceName: 'AgentDeck collector',
      // node:sqlite prints an ExperimentalWarning on first use.
      execArgv: ['--disable-warning=ExperimentalWarning']
    })
    child = proc
    proc.on('message', (m: FromCollector) => onMessage(m))
    proc.on('exit', () => {
      if (child === proc) child = null
      if (stopped) return
      onDown()
      if (Date.now() - startedAt > HEALTHY_MS) attempt = 0
      retry = setTimeout(spawn, restartDelay(attempt++))
    })
    proc.postMessage(init)
    for (const m of latest.values()) proc.postMessage(m)
  }
  spawn()

  return {
    post: (m) => {
      latest.set(m.type, m)
      child?.postMessage(m)
    },
    stop: () => {
      stopped = true
      if (retry) clearTimeout(retry)
      child?.kill()
      child = null
    }
  }
}
