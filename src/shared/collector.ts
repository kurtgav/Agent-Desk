import type { Snapshot } from './snapshot'

/** Main ↔ collector over the utility process's parentPort (ARCHITECTURE § 2). */
export interface CollectorInit {
  type: 'init'
  dbPath: string
  token: string
  ports: number[]
  agentsDir: string | null
  /** CLI path override; false turns the poller off. */
  claude: string | undefined | false
}

export type ToCollector =
  | CollectorInit
  | { type: 'visible'; visible: boolean }
  | { type: 'focus'; focused: boolean; at: number }

export type FromCollector =
  | { type: 'ready'; port: number }
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'error'; message: string }
