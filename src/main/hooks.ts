// ADR-0005 integration operations: state, dry run, install, uninstall. Every one takes a HookSpec (Claude's by default), so
// Codex CLI's hooks.json goes through the same code (ADR-0014). No electron import: unit-testable.
import type { AppStatus, HooksPreview, HooksResult, RemoteApprovals } from '@shared/bridge'
import { CLAUDE, claudeSpec, inspect, planDiff, planInstall, planUninstall, shapeKey, type HookFile, type HookSpec, type HookTarget, type Plan } from './hooks-install'
import { readText, writeSettings } from './settings-writer'

export interface HookPaths {
  /** The hooks file: settings.json (CLAUDE_CONFIG_DIR respected, hooks-install settingsPath), or Codex's hooks.json. */
  settings: string
  /** %APPDATA%\AgentDeck\backups */
  backups: string
}

/** ADR-0006: remote approvals change one thing in the entries, the PermissionRequest timeout: the wait plus 10 s. */
export const hookOptions = (ra: RemoteApprovals): Omit<HookTarget, 'port' | 'token'> => (ra.enabled ? { permissionTimeoutSec: ra.waitSec + 10 } : {})

/** ADR-0005 § 4: the user's OK covers this entry shape; when the shape changes, the diff is shown again. */
export const shapeFor = (ra: RemoteApprovals): string => shapeKey(hookOptions(ra))

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** The file's text, or why it can't be used. Never throws: a broken file must not take the status refresh down. */
function read<T>(path: string, file: string, use: (text: string | null) => T): T | { ok: false; error: string } {
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
    return { ok: false, error: `AgentDeck could not make sense of ${file}, so it left the file alone.` }
  }
}

/**
 * `installed` when the file holds exactly our entries for `target`. Before the collector has a port
 * (`target` null) it can only say whether any of our entries are there.
 */
export function hooksState<T = HookTarget>(
  paths: HookPaths,
  target: NoInfer<T> | null,
  spec: HookSpec<T> = claudeSpec<T>()
): Pick<AppStatus, 'hooks' | 'hooksError' | 'conflicts'> {
  const r = read(paths.settings, spec.file, (text) => inspect(text, target, spec))
  if (!r.ok) return { hooks: 'error', hooksError: r.error, conflicts: [] }
  return { hooks: r.installed ? 'installed' : 'missing', hooksError: null, conflicts: r.conflicts }
}

function preview(paths: HookPaths, spec: HookFile, make: (text: string | null) => Plan): HooksPreview {
  const r = read(paths.settings, spec.file, (text) => {
    const plan = make(text)
    return plan.ok ? { ...plan, diff: planDiff(plan, spec) } : plan
  })
  if (!r.ok) return { ok: false, path: paths.settings, error: r.error }
  return { ok: true, path: paths.settings, backups: paths.backups, changed: r.changed, diff: r.diff, conflicts: r.conflicts }
}

export const previewInstall = <T = HookTarget>(paths: HookPaths, target: NoInfer<T>, spec: HookSpec<T> = claudeSpec<T>()): HooksPreview =>
  preview(paths, spec, (t) => planInstall(t, target, spec))
export const previewUninstall = (paths: HookPaths, spec: HookFile = CLAUDE): HooksPreview => preview(paths, spec, (t) => planUninstall(t, spec))

export function install<T = HookTarget>(paths: HookPaths, target: NoInfer<T>, spec: HookSpec<T> = claudeSpec<T>()): HooksResult {
  const r = writeSettings(paths.settings, (t) => planInstall(t, target, spec), paths.backups, undefined, spec)
  return r.ok ? { ok: true } : r
}

export function uninstall(paths: HookPaths, spec: HookFile = CLAUDE): HooksResult {
  const r = writeSettings(paths.settings, (t) => planUninstall(t, spec), paths.backups, undefined, spec)
  return r.ok ? { ok: true } : r
}
