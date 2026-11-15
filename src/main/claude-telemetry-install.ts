// ADR-0007: add, inspect and remove the `env` entries that point Claude Code's usage telemetry at AgentDeck.
// Text edits like the hook entries (hooks-install.ts), through the same writer: backup, atomic write, validation.
// No electron import: unit-testable.
import type { HooksPreview, HooksResult } from '@shared/bridge'
import { foreignTelemetryKeys, isCurrentTelemetry, isOurTelemetry, ourTelemetryKeys, telemetryEnv, type TelemetryTarget } from './claude-telemetry'
import type { HookPaths } from './hooks'
import { append, isObj, parse, plan, planDiff, remove, type Json, type Plan } from './hooks-install'
import { readText, writeSettings } from './settings-writer'

/** `off`: nothing of ours. `on`: exactly what we'd write now. `stale`: ours, but another port or token. `elsewhere`: the user's own (R21). */
export type TelemetryState = 'off' | 'on' | 'stale' | 'elsewhere'
export type Inspection = { ok: true; state: TelemetryState; foreign: string[] } | { ok: false; error: string }

const MAX_NAMED = 3

/** Names only. `where` is "in settings.json" or "in the environment AgentDeck was started from". */
function elsewhere(names: string[], where: string): string {
  const shown = names.slice(0, MAX_NAMED).join(', ')
  const more = names.length > MAX_NAMED ? ` and ${names.length - MAX_NAMED} more` : ''
  return `Telemetry is already set up ${where} (${shown}${more}). AgentDeck does not override it, so usage figures stay off. Remove those settings first, or point your own collector at AgentDeck.`
}

/** The `env` block, or the reason it can't be used. A missing block is an empty one. */
function envOf(root: Json): { ok: true; env: Json } | { ok: false; error: string } {
  if (root.env === undefined) return { ok: true, env: {} }
  return isObj(root.env) ? { ok: true, env: root.env } : { ok: false, error: '"env" in settings.json is not an object' }
}

export function inspectTelemetry(text: string | null, target: TelemetryTarget | null): Inspection {
  const parsed = parse(text)
  if (!parsed.ok) return parsed
  const e = envOf(parsed.root)
  if (!e.ok) return e
  if (isOurTelemetry(e.env)) return { ok: true, state: !target || isCurrentTelemetry(e.env, target) ? 'on' : 'stale', foreign: [] }
  const foreign = foreignTelemetryKeys(e.env)
  return { ok: true, state: foreign.length ? 'elsewhere' : 'off', foreign }
}

/** Removes our keys from the text; with `prune`, an `env` that this leaves empty goes too. */
function stripEnv(text: string, prune: boolean): string {
  const env = (JSON.parse(text) as Json).env
  if (!isObj(env)) return text
  const ours = ourTelemetryKeys(env)
  let out = text
  for (const k of ours) out = remove(out, ['env', k])
  return prune && ours.length > 0 && ours.length === Object.keys(env).length ? remove(out, ['env']) : out
}

/** Appends our keys after the user's, in the file's own style; a missing `env` goes at the end of the root. */
function addEnv(text: string, target: TelemetryTarget): string {
  let out = isObj((JSON.parse(text) as Json).env) ? text : append(text, [], {}, 'env')
  for (const [k, v] of Object.entries(telemetryEnv(target))) out = append(out, ['env'], v, k)
  return out
}

/**
 * `shell` names the OTEL_* variables AgentDeck itself was started with: Claude Code sessions started from the same
 * place inherit them, so they count as "configured elsewhere" too.
 */
export function planTelemetryOn(text: string | null, target: TelemetryTarget, shell: readonly string[] = []): Plan {
  const parsed = parse(text)
  if (!parsed.ok) return parsed
  const e = envOf(parsed.root)
  if (!e.ok) return e
  if (!isOurTelemetry(e.env)) {
    const foreign = foreignTelemetryKeys(e.env)
    if (foreign.length > 0) return { ok: false, error: elsewhere(foreign, 'in settings.json') }
    if (shell.length > 0) return { ok: false, error: elsewhere([...shell], 'in the environment AgentDeck was started from') }
  }
  return plan(text, parsed.root, (body) => addEnv(stripEnv(body, false), target), [])
}

export function planTelemetryOff(text: string | null): Plan {
  const parsed = parse(text)
  if (!parsed.ok) return parsed
  const e = envOf(parsed.root)
  if (!e.ok) return e
  return plan(text, parsed.root, (body) => stripEnv(body, true), [])
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** The settings.json text, or why it can't be read. */
function readSettingsText(paths: HookPaths): { ok: true; text: string | null } | { ok: false; error: string } {
  try {
    return { ok: true, text: readText(paths.settings) }
  } catch (e) {
    return { ok: false, error: `Could not read ${paths.settings}: ${message(e)}` }
  }
}

/** Never throws: a broken file reads as "off", with the reason for the dialog that asks. */
export function telemetryState(paths: HookPaths, target: TelemetryTarget | null): TelemetryState {
  const r = readSettingsText(paths)
  if (!r.ok) return 'off'
  try {
    const i = inspectTelemetry(r.text, target)
    return i.ok ? i.state : 'off'
  } catch {
    return 'off'
  }
}

export function previewTelemetry(paths: HookPaths, on: boolean, target: TelemetryTarget | null, shell: readonly string[] = []): HooksPreview {
  const r = readSettingsText(paths)
  if (!r.ok) return { ok: false, path: paths.settings, error: r.error }
  try {
    const p = on ? (target ? planTelemetryOn(r.text, target, shell) : null) : planTelemetryOff(r.text)
    if (!p) return { ok: false, path: paths.settings, error: 'AgentDeck is still starting its collector. Try again in a moment.' }
    return p.ok
      ? { ok: true, path: paths.settings, backups: paths.backups, changed: p.changed, diff: planDiff(p), conflicts: p.conflicts }
      : { ok: false, path: paths.settings, error: p.error }
  } catch {
    // A shape the planner doesn't expect (duplicate keys, for one). Nothing was written.
    return { ok: false, path: paths.settings, error: 'AgentDeck could not make sense of settings.json, so it left the file alone.' }
  }
}

export function setTelemetry(paths: HookPaths, on: boolean, target: TelemetryTarget | null, shell: readonly string[] = []): HooksResult {
  if (on && !target) return { ok: false, error: 'AgentDeck is still starting its collector. Try again in a moment.' }
  const r = writeSettings(paths.settings, (t) => (on && target ? planTelemetryOn(t, target, shell) : planTelemetryOff(t)), paths.backups)
  return r.ok ? { ok: true } : r
}

/** The uninstaller's step (ADR-0012): our entries out of settings.json, everything else byte for byte. */
export const removeTelemetry = (paths: HookPaths): HooksResult => setTelemetry(paths, false, null)
