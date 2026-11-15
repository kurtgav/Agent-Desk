import { useEffect } from 'react'
import type { AgentDeckBridge } from '@shared/bridge'
import { followWork } from '@/lib/work'

/** The bridge pushes `work-changed`. A plain browser, and a preload from before it, do not: those pages poll on the 30 s tick. */
export const canFollowWork = (): boolean => typeof window !== 'undefined' && typeof window.agentdeck?.onWorkChanged === 'function'

/**
 * What the effect below does, apart from React: subscribes when `enabled` and the bridge pushes, and returns the way to
 * unsubscribe (the effect's cleanup); returns nothing, and subscribes to nothing, otherwise.
 */
export function startFollowing(bridge: Pick<AgentDeckBridge, 'onWorkChanged'> | undefined, run: () => void, enabled: boolean): (() => void) | undefined {
  if (!enabled || typeof bridge?.onWorkChanged !== 'function') return undefined
  return followWork((listener) => bridge.onWorkChanged(listener), run)
}

/**
 * Runs `run` whenever the collector reports a change to tasks or the report (at most once a second, see `followWork`),
 * for as long as the page is mounted and `enabled`. Unsubscribes on unmount and when `enabled` turns off.
 */
export function useWorkPush(run: () => void, enabled: boolean): void {
  useEffect(() => startFollowing(window.agentdeck, run, enabled), [enabled, run])
}
