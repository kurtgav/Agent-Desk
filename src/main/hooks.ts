// ADR-0005 integration operations: state, dry run, install, uninstall. No electron import: unit-testable.
import type { AppStatus, HooksPreview, HooksResult } from '@shared/bridge'
import { inspect, planDiff, planInstall, planUninstall, shapeKey, type HookTarget, type Plan } from './hooks-install'
import { readText, writeSettings } from './settings-writer'

export interface HookPaths {
  /** settings.json (CLAUDE_CONFIG_DIR respected, hooks-install settingsPath). */
  settings: string
  /** %APPDATA%\AgentDeck\backups */
  backups: string
}

/** ADR-0005 § 4: the user's OK covers this entry shape; when the shape changes, the diff is shown again. */
export const SHAPE = shapeKey({})

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** The file's text, or why it can't be used. Never throws: a broken file must not take the status refresh down. */
function read<T>(path: string, use: (text: string | null) => T): T | { ok: false; error: string } {
  let text: string | null
  try {
    text = readText(path)
  } catch (e) {
    return { ok: false, error: `Could not read ${path}: ${message(e)}` }
  }
  try {
    return use(text)
  } catch {
    // A shape the planner doesn't expect (duplicate keys, for one). Nothing was written.
    return { ok: false, error: 'AgentDeck could not make sense of settings.json, so it left the file alone.' }
  }
}

/**
 * `installed` when settings.json holds exactly our entries for `target`. Before the collector has a port
 * (`target` null) it can only say whether any of our entries are there.
 */
export function hooksState(paths: HookPaths, target: HookTarget | null): Pick<AppStatus, 'hooks' | 'hooksError' | 'conflicts'> {
  const r = read(paths.settings, (text) => inspect(text, target))
  if (!r.ok) return { hooks: 'error', hooksError: r.error, conflicts: [] }
  return { hooks: r.installed ? 'installed' : 'missing', hooksError: null, conflicts: r.conflicts }
}

function preview(paths: HookPaths, make: (text: string | null) => Plan): HooksPreview {
  const r = read(paths.settings, (text) => {
    const plan = make(text)
    return plan.ok ? { ...plan, diff: planDiff(plan) } : plan
  })
  if (!r.ok) return { ok: false, path: paths.settings, error: r.error }
  return { ok: true, path: paths.settings, backups: paths.backups, changed: r.changed, diff: r.diff, conflicts: r.conflicts }
}

export const previewInstall = (paths: HookPaths, target: HookTarget): HooksPreview => preview(paths, (t) => planInstall(t, target))
export const previewUninstall = (paths: HookPaths): HooksPreview => preview(paths, planUninstall)

export function install(paths: HookPaths, target: HookTarget): HooksResult {
  const r = writeSettings(paths.settings, (t) => planInstall(t, target), paths.backups)
  return r.ok ? { ok: true } : r
}

export function uninstall(paths: HookPaths): HooksResult {
  const r = writeSettings(paths.settings, planUninstall, paths.backups)
  return r.ok ? { ok: true } : r
}
