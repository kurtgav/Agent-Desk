import { utilityProcess, type UtilityProcess } from 'electron'
import type { CollectorInit, FromCollector, ToCollector } from '@shared/collector'

/** ADR-0002: restart after 0.5 s, 1 s, 2 s … capped at 30 s; a run that lasted 30 s resets the ladder. */
export function restartDelay(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 30_000)
}
const HEALTHY_MS = 30_000
/** A request the collector hasn't answered by then resolves to null (it is busy, or restarting). */
const REQUEST_TIMEOUT_MS = 5_000

export interface Supervisor {
  post(m: ToCollector): void
  /** Sends a request built around a fresh `reqId`; resolves with the reply, or null on timeout or exit. */
  request(build: (reqId: number) => ToCollector): Promise<FromCollector | null>
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
  // Visibility and focus are state: a restarted collector must get the latest of each. Commands and requests are not replayed.
  const latest = new Map<string, ToCollector>()
  const waiting = new Map<number, (m: FromCollector | null) => void>()
  let nextReq = 1

  const spawn = (): void => {
    retry = null
    startedAt = Date.now()
    const proc = utilityProcess.fork(entry, [], {
      serviceName: 'AgentDeck collector',
      // node:sqlite prints an ExperimentalWarning on first use.
      execArgv: ['--disable-warning=ExperimentalWarning']
    })
    child = proc
    proc.on('message', (m: FromCollector) => {
      if ('reqId' in m) waiting.get(m.reqId)?.(m)
      else onMessage(m)
    })
    proc.on('exit', () => {
      if (child === proc) child = null
      for (const answer of [...waiting.values()]) answer(null)
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
      if (m.type === 'visible' || m.type === 'focus') latest.set(m.type, m)
      child?.postMessage(m)
    },
    request: (build) => {
      if (!child) return Promise.resolve(null)
      const reqId = nextReq++
      const proc = child
      return new Promise((resolve) => {
        const answer = (m: FromCollector | null): void => {
          clearTimeout(timer)
          waiting.delete(reqId)
          resolve(m)
        }
        const timer = setTimeout(() => answer(null), REQUEST_TIMEOUT_MS)
        waiting.set(reqId, answer)
        proc.postMessage(build(reqId))
      })
    },
    stop: () => {
      stopped = true
      if (retry) clearTimeout(retry)
      child?.kill()
      child = null
    }
  }
}
