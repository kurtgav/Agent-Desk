// ADR-0005 integration operations: state, dry run, install, uninstall. No electron import: unit-testable.
import type { AppStatus, HooksPreview, HooksResult } from '@shared/bridge'
import { planInstall, planUninstall, shapeKey, type HookTarget, type Plan } from './hooks-install'
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

function read(path: string): { ok: true; text: string | null } | { ok: false; error: string } {
  try {
    return { ok: true, text: readText(path) }
  } catch (e) {
    return { ok: false, error: `Could not read ${path}: ${message(e)}` }
  }
}

/**
 * `installed` when settings.json already holds exactly our entries for `target`. Before the collector has a port
 * (`target` null) it can only say whether any of our entries are there.
 */
export function hooksState(paths: HookPaths, target: HookTarget | null): Pick<AppStatus, 'hooks' | 'hooksError' | 'conflicts'> {
  const file = read(paths.settings)
  if (!file.ok) return { hooks: 'error', hooksError: file.error, conflicts: [] }
  const plan = target ? planInstall(file.text, target) : planUninstall(file.text)
  if (!plan.ok) return { hooks: 'error', hooksError: plan.error, conflicts: [] }
  const installed = target ? !plan.changed : plan.changed
  return { hooks: installed ? 'installed' : 'missing', hooksError: null, conflicts: plan.conflicts }
}

function preview(paths: HookPaths, make: (text: string | null) => Plan): HooksPreview {
  const file = read(paths.settings)
  if (!file.ok) return { ok: false, path: paths.settings, error: file.error }
  const plan = make(file.text)
  if (!plan.ok) return { ok: false, path: paths.settings, error: plan.error }
  return { ok: true, path: paths.settings, backups: paths.backups, changed: plan.changed, diff: plan.diff, conflicts: plan.conflicts }
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
