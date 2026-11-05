// JSON files in userData (config.json, window-state.json). No electron import: unit-testable.
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { RemoteApprovals } from '@shared/bridge'

/** Missing or corrupt files read as `undefined` (treated as "no saved data"). */
export function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/** Write-then-rename so a crash or logoff mid-write never leaves a half-written file. */
export function writeJson(file: string, value: unknown): void {
  const tmp = `${file}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2))
    renameSync(tmp, file)
  } catch {
    // shortcut: write failures are dropped (only UI flags/geometry live here in M1); log them once main has a logger
  }
}

export interface AppConfig {
  /** Login item registered on first packaged run (ADR-0012). */
  autostartConfigured?: boolean
  /** The one-time "still running in the tray" balloon was shown. */
  trayHintShown?: boolean
  [key: string]: unknown
}

export function readConfig(file: string): AppConfig {
  const raw = readJson(file)
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as AppConfig) : {}
}

/** ADR-0006: off, 60 s. Clamped so the hook timeout (the wait plus 10 s) stays between 25 s and 310 s. */
export const APPROVAL_WAIT_SEC = { default: 60, min: 15, max: 300 } as const

/** `remoteApprovals` from config.json; the wait is only editable there until Settings (M5). */
export function remoteApprovals(c: AppConfig): RemoteApprovals {
  const r = typeof c.remoteApprovals === 'object' && c.remoteApprovals !== null ? (c.remoteApprovals as Record<string, unknown>) : {}
  const wait = typeof r.waitSec === 'number' && Number.isFinite(r.waitSec) ? Math.round(r.waitSec) : APPROVAL_WAIT_SEC.default
  return { enabled: r.enabled === true, waitSec: Math.min(APPROVAL_WAIT_SEC.max, Math.max(APPROVAL_WAIT_SEC.min, wait)) }
}

/** Merges `patch` into config.json, keeping keys this version does not know about. */
export function updateConfig(file: string, patch: AppConfig): void {
  writeJson(file, { ...readConfig(file), ...patch })
}
