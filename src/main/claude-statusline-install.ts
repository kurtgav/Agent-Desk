// ADR-0009 amendment (status line): turn AgentDeck's status line on and off in Claude Code's settings.json, keeping the
// user's own status line running inside ours and putting it back exactly on the way out. Text edits through the same writer
// as the hooks and telemetry (backup, atomic write, validation). No electron import: unit-testable.
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { HooksPreview, HooksResult } from '@shared/bridge'
import {
  LIMITS_FILE, PREVIOUS_FILE, PREVIOUS_PS1, PREVIOUS_SH, isOurStatusLine, ourStatusLine, previousCommand, scriptPath, statusLineCommand, statusLineScript
} from './claude-statusline'
import type { HookPaths } from './hooks'
import { append, parse, plan, planDiff, remove, replace, type Json, type Plan } from './hooks-install'
import { readText, writeSettings } from './settings-writer'

/** `off`: no status line. `on`: ours, as we'd write it now. `stale`: ours, but its script is missing or the command differs. `elsewhere`: the user's own. */
export type StatusLineState = 'off' | 'on' | 'stale' | 'elsewhere'

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const CHANGED = 'Your status line changed while AgentDeck was writing settings.json, so AgentDeck left it as it is. Try again.'

/** Why Claude Code would show no status line at all, as the hooks dialog words its conflicts. */
const conflicts = (root: Json): string[] => (root.disableAllHooks === true ? ['disableAllHooks is true in this file, so Claude Code shows no status line at all.'] : [])

export function inspectStatusLine(text: string | null, command: string, scriptExists: boolean): { ok: true; state: StatusLineState } | { ok: false; error: string } {
  const parsed = parse(text)
  if (!parsed.ok) return parsed
  const line = parsed.root.statusLine
  if (line === undefined) return { ok: true, state: 'off' }
  if (!isOurStatusLine(line)) return { ok: true, state: 'elsewhere' }
  return { ok: true, state: scriptExists && (line as Json).command === command ? 'on' : 'stale' }
}

/** Sets `statusLine` to `value` where it is, or adds it at the end of the root. */
function setLine(body: string, value: unknown): string {
  return (JSON.parse(body) as Json).statusLine === undefined ? append(body, [], value, 'statusLine') : replace(body, ['statusLine'], value)
}

/** Ours in place of whatever is there; the keys the user set (padding, hideVimModeIndicator) stay. */
export function planStatusLineOn(text: string | null, command: string): Plan {
  const parsed = parse(text)
  if (!parsed.ok) return parsed
  return plan(text, parsed.root, (body) => setLine(body, ourStatusLine(parsed.root.statusLine, command)), conflicts(parsed.root))
}

/**
 * The user's previous status line back, exactly as saved (none: the key goes). Only while the entry is still ours: one the user
 * set since is theirs, and stays.
 */
export function planStatusLineOff(text: string | null, previous: unknown): Plan {
  const parsed = parse(text)
  if (!parsed.ok) return parsed
  if (!isOurStatusLine(parsed.root.statusLine)) return plan(text, parsed.root, (body) => body, [])
  return plan(text, parsed.root, (body) => (previous === null || previous === undefined ? remove(body, ['statusLine']) : replace(body, ['statusLine'], previous)), [])
}

/** previous.json: `{ "statusLine": <the user's object> }`, or `{ "statusLine": null }` when they had none. Missing reads as none. */
function readPrevious(dir: string): unknown {
  const text = readText(join(dir, PREVIOUS_FILE))
  if (text === null) return null
  const saved = JSON.parse(text) as unknown
  if (typeof saved !== 'object' || saved === null || !('statusLine' in saved)) throw new Error(`${PREVIOUS_FILE} in ${dir} is not what AgentDeck wrote`)
  return (saved as { statusLine: unknown }).statusLine
}

/** Written to a temp file and renamed over the old one, so the script never reads half a file. */
function writeAtomic(file: string, text: string): void {
  writeFileSync(`${file}.tmp`, text)
  renameSync(`${file}.tmp`, file)
}

/** Keeps the user's status line for the way back, and their command as files the script can run under either shell. */
function savePrevious(dir: string, previous: unknown): void {
  writeAtomic(join(dir, PREVIOUS_FILE), `${JSON.stringify({ statusLine: previous ?? null }, null, 2)}\n`)
  const command = previousCommand(previous)
  if (command === null) {
    for (const f of [PREVIOUS_SH, PREVIOUS_PS1]) rmSync(join(dir, f), { force: true })
    return
  }
  writeAtomic(join(dir, PREVIOUS_SH), `${command}\n`)
  writeAtomic(join(dir, PREVIOUS_PS1), `\uFEFF${command}\r\n`)
}

/** The settings.json text, or why it can't be read. */
function readSettingsText(paths: HookPaths): { ok: true; text: string | null } | { ok: false; error: string } {
  try {
    return { ok: true, text: readText(paths.settings) }
  } catch (e) {
    return { ok: false, error: `Could not read ${paths.settings}: ${message(e)}` }
  }
}

/** Never throws: a broken file reads as "off". */
export function statusLineState(paths: HookPaths, dir: string, platform: NodeJS.Platform = process.platform): StatusLineState {
  const r = readSettingsText(paths)
  if (!r.ok) return 'off'
  try {
    const i = inspectStatusLine(r.text, statusLineCommand(dir, platform), existsSync(scriptPath(dir, platform)))
    return i.ok ? i.state : 'off'
  } catch {
    return 'off'
  }
}

export function previewStatusLine(paths: HookPaths, dir: string, on: boolean, platform: NodeJS.Platform = process.platform): HooksPreview {
  const r = readSettingsText(paths)
  if (!r.ok) return { ok: false, path: paths.settings, error: r.error }
  try {
    const p = on ? planStatusLineOn(r.text, statusLineCommand(dir, platform)) : planStatusLineOff(r.text, readPrevious(dir))
    return p.ok
      ? { ok: true, path: paths.settings, backups: paths.backups, changed: p.changed, diff: planDiff(p), conflicts: p.conflicts }
      : { ok: false, path: paths.settings, error: p.error }
  } catch (e) {
    return { ok: false, path: paths.settings, error: e instanceof SyntaxError ? 'AgentDeck could not make sense of settings.json, so it left the file alone.' : message(e) }
  }
}

function turnOn(paths: HookPaths, dir: string, platform: NodeJS.Platform): HooksResult {
  const command = statusLineCommand(dir, platform)
  const r = readSettingsText(paths)
  if (!r.ok) return r
  const parsed = parse(r.text)
  if (!parsed.ok) return parsed
  const current = parsed.root.statusLine
  mkdirSync(dir, { recursive: true })
  // Ours already (stale, or on twice): previous.json still holds the user's own, so it is not overwritten with ours.
  if (!isOurStatusLine(current)) savePrevious(dir, current)
  writeAtomic(scriptPath(dir, platform), statusLineScript(dir, platform))
  const w = writeSettings(
    paths.settings,
    (t) => {
      const p = parse(t)
      if (!p.ok) return p
      // Someone changed the status line since it was saved above: plan nothing over theirs.
      if (!isOurStatusLine(p.root.statusLine) && !isDeepStrictEqual(p.root.statusLine, current)) return { ok: false, error: CHANGED }
      return planStatusLineOn(t, command)
    },
    paths.backups
  )
  return w.ok ? { ok: true } : w
}

function turnOff(paths: HookPaths, dir: string): HooksResult {
  const previous = readPrevious(dir)
  const w = writeSettings(paths.settings, (t) => planStatusLineOff(t, previous), paths.backups)
  if (!w.ok) return w
  // The last figures go too, so the sidebar doesn't keep showing a week that no longer updates.
  rmSync(join(dir, LIMITS_FILE), { force: true })
  return { ok: true }
}

/** Never throws. */
export function setStatusLine(paths: HookPaths, dir: string, on: boolean, platform: NodeJS.Platform = process.platform): HooksResult {
  try {
    return on ? turnOn(paths, dir, platform) : turnOff(paths, dir)
  } catch (e) {
    return { ok: false, error: message(e) }
  }
}

/** The uninstaller's step (ADR-0012): the user's status line back, everything else byte for byte. */
export const removeStatusLine = (paths: HookPaths, dir: string): HooksResult => setStatusLine(paths, dir, false)
