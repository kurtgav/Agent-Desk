// JSON files in userData (config.json, window-state.json). No electron import: unit-testable.
import { readFileSync, renameSync, writeFileSync } from 'node:fs'

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

/** Merges `patch` into config.json, keeping keys this version does not know about. */
export function updateConfig(file: string, patch: AppConfig): void {
  writeJson(file, { ...readConfig(file), ...patch })
}
