import type { AgentDeckBridge } from '../shared/bridge'

declare global {
  interface Window {
    /** Absent when the renderer is opened in a plain browser (design checks). */
    agentdeck?: AgentDeckBridge
  }
}
