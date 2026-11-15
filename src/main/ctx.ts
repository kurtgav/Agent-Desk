import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import type { Supervisor } from './collector'

/** `handle` from index.ts: registers an IPC channel that only our own page may call (ADR-0010). */
export type Handle = <T>(channel: string, fn: (e: IpcMainInvokeEvent, ...args: unknown[]) => T) => void

/** What a feature module needs from main. Passed in, so the module never imports index.ts. */
export interface MainCtx {
  handle: Handle
  collector(): Supervisor | null
  demo(): boolean
  configFile(): string
  userData(): string
  window(): BrowserWindow | null
}

/** Returned by a feature's register function; called on quit. */
export type Dispose = () => void
