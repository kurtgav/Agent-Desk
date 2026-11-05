import type { AttentionItem, Session, Snapshot } from '@shared/snapshot'
import { pathKey, projectName } from '@shared/paths'

export { projectName }

export function sessionIndex(s: Snapshot): Map<string, Session> {
  return new Map(s.sessions.map((x) => [x.id, x]))
}

/** Needs-you order: priority first, then the oldest open item. */
export function byPriority(items: readonly AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => a.priority - b.priority || a.openedAt - b.openedAt)
}

/**
 * Sessions marked needs_you that have no open attention item. Until the attention engine (M3)
 * that is every waiting live session; they count as P1 so no number says "nothing waits" (D-054).
 */
export function waitingWithoutItem(s: Snapshot): Session[] {
  const covered = new Set(s.attention.map((i) => i.sessionId))
  return s.sessions.filter((x) => x.status === 'needs_you' && !covered.has(x.id))
}

export function needsOkCount(s: Snapshot): number {
  return s.attention.filter((i) => i.priority === 1).length + waitingWithoutItem(s).length
}

/** "Waiting for you" = open P1 + P2 (D-009). */
export function waiting(s: Snapshot): { count: number; oldestAt: number | null } {
  const times = [
    ...s.attention.filter((i) => i.priority <= 2).map((i) => i.openedAt),
    ...waitingWithoutItem(s).map((x) => x.waitingSince ?? x.lastEventAt)
  ]
  return { count: times.length, oldestAt: times.length ? Math.min(...times) : null }
}

export function tasksFinished(s: Snapshot): { count: number; whileAway: number } {
  const turns = s.week.finishedTurns
  const { awaySince: from, awayUntil: to } = s
  return { count: turns.length, whileAway: from === null ? 0 : turns.filter((t) => t >= from && (to === null || t <= to)).length }
}

export function filesChanged(s: Snapshot): { count: number; projects: number } {
  const sessions = sessionIndex(s)
  const paths = new Set(s.files.map((f) => pathKey(f.path)))
  const projects = new Set(
    s.files.flatMap((f) => {
      const cwd = sessions.get(f.sessionId)?.cwd
      return cwd ? [pathKey(cwd)] : []
    })
  )
  return { count: paths.size, projects: projects.size }
}

/** Working sessions first (oldest first), then the ones waiting on you (longest wait first). */
export function running(s: Snapshot): Session[] {
  const working = s.sessions.filter((x) => x.status === 'working').sort((a, b) => a.startedAt - b.startedAt)
  const waitingOn = s.sessions
    .filter((x) => x.status === 'needs_you')
    .sort((a, b) => (a.waitingSince ?? 0) - (b.waitingSince ?? 0))
  return [...working, ...waitingOn]
}

export function recentSessions(s: Snapshot, max: number): Session[] {
  return [...s.sessions].sort((a, b) => b.lastEventAt - a.lastEventAt).slice(0, max)
}

export function recentProjects(s: Snapshot, max: number): { cwd: string; name: string }[] {
  const seen = new Map<string, string>()
  for (const x of recentSessions(s, s.sessions.length)) {
    const key = pathKey(x.cwd)
    if (!seen.has(key)) seen.set(key, x.cwd)
  }
  return [...seen.values()].slice(0, max).map((cwd) => ({ cwd, name: projectName(cwd) }))
}

/** The greeting's live summary (UI_MAP § Greeting). */
export function summaryLine(s: Snapshot): string {
  const ok = needsOkCount(s)
  const away = tasksFinished(s).whileAway
  const parts: string[] = []
  if (ok) parts.push(ok === 1 ? '1 thing needs your OK.' : `${ok} things need your OK.`)
  if (away) parts.push(`Agents finished ${away} ${away === 1 ? 'task' : 'tasks'} while you were away.`)
  return parts.length ? parts.join(' ') : 'All quiet.'
}
