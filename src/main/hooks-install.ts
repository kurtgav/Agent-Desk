// ADR-0005: merge AgentDeck's HTTP hook entries into Claude Code's settings.json and strip them again.
// Pure: text in, text out. The fs side lives in settings-writer.ts.
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { maskSecrets } from '../collector/redact'

/** SessionStart is excluded: HTTP hooks don't run there (D-004). */
export const HOOK_EVENTS: readonly string[] = [
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
  'Notification',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'TaskCreated',
  'TaskCompleted',
  'PreCompact',
  'CwdChanged'
]

export interface HookTarget {
  port: number
  token: string
  /** Remote approvals: PermissionRequest waits longer than the default 2 s. */
  permissionTimeoutSec?: number
}

export type Plan =
  // `after` is '' when there is no file and nothing to change (then `changed` is false).
  | { ok: true; before: string | null; after: string; changed: boolean; diff: string; conflicts: string[] }
  | { ok: false; error: string }

const TOKEN_HEADER = 'X-AgentDeck-Token'
const OUR_URL = /^http:\/\/127\.0\.0\.1:\d+\/hooks$/
const TIMEOUT_SEC = 2
const CONTEXT = 2

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/** CLAUDE_CONFIG_DIR, else <home>/.claude, then settings.json */
export function settingsPath(env: NodeJS.ProcessEnv, home: string): string {
  return join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'settings.json')
}

/** Ours = type "http", url matches ^http://127\.0\.0\.1:\d+/hooks$, and headers has an "X-AgentDeck-Token" key (D-022). */
export function isOurs(entry: unknown): boolean {
  return (
    isObj(entry) &&
    entry.type === 'http' &&
    typeof entry.url === 'string' &&
    OUR_URL.test(entry.url) &&
    isObj(entry.headers) &&
    Object.hasOwn(entry.headers, TOKEN_HEADER)
  )
}

const ourUrl = (port: number): string => `http://127.0.0.1:${port}/hooks`

function ourGroup(event: string, t: HookTarget): Json {
  const timeout = event === 'PermissionRequest' && t.permissionTimeoutSec !== undefined ? t.permissionTimeoutSec : TIMEOUT_SEC
  return { hooks: [{ type: 'http', url: ourUrl(t.port), timeout, headers: { [TOKEN_HEADER]: t.token } }] }
}

/** Hash-like string of the entry shape WITHOUT port and token (events + timeouts), used to decide when consent must be asked again. */
export function shapeKey(target: Omit<HookTarget, 'port' | 'token'>): string {
  const groups = HOOK_EVENTS.map((e) => [e, ourGroup(e, { ...target, port: 0, token: '' })])
  return createHash('sha256').update(JSON.stringify(groups)).digest('hex').slice(0, 16)
}

type Parsed = { ok: true; root: Json } | { ok: false; error: string }

function parse(text: string | null): Parsed {
  if (text === null) return { ok: true, root: {} }
  let root: unknown
  try {
    root = JSON.parse(text.replace(BOM, '')) // Windows PowerShell 5.1 `Out-File` writes one
  } catch (e) {
    return { ok: false, error: `settings.json is not valid JSON (${(e as Error).message})` }
  }
  if (!isObj(root)) return { ok: false, error: 'settings.json is not a JSON object' }
  if (root.hooks === undefined) return { ok: true, root }
  if (!isObj(root.hooks)) return { ok: false, error: '"hooks" in settings.json is not an object' }
  const bad = Object.entries(root.hooks).find(([, groups]) => !Array.isArray(groups))
  return bad ? { ok: false, error: `"hooks.${bad[0]}" in settings.json is not an array` } : { ok: true, root }
}

/** Decides whether a container (an event array, or `hooks` when event is null) left empty is dropped. */
type Prune = (event: string | null, emptiedByUs: boolean) => boolean
const PRUNE_OURS: Prune = (_, byUs) => byUs
// Install keeps the containers add() refills, so they keep their place and a second install is byte-identical.
const PRUNE_REFILLED: Prune = (e, byUs) => byUs && e !== null && !HOOK_EVENTS.includes(e)
// Comparison: an empty container carries no foreign content.
const PRUNE_ALL: Prune = () => true

function strip(root: Json, prune: Prune): Json {
  if (!isObj(root.hooks)) return root
  const events = Object.entries(root.hooks).flatMap(([event, groups]): [string, unknown][] => {
    if (!Array.isArray(groups)) return [[event, groups]]
    const kept = groups.flatMap((g: unknown) => {
      if (!isObj(g) || !Array.isArray(g.hooks) || !g.hooks.some(isOurs)) return [g]
      const rest = g.hooks.filter((h) => !isOurs(h))
      return rest.length > 0 ? [{ ...g, hooks: rest }] : []
    })
    return kept.length === 0 && prune(event, groups.length > 0) ? [] : [[event, kept]]
  })
  if (events.length === 0 && prune(null, Object.keys(root.hooks).length > 0)) {
    return Object.fromEntries(Object.entries(root).filter(([k]) => k !== 'hooks'))
  }
  return { ...root, hooks: Object.fromEntries(events) }
}

/** Appends our group to each event; new event keys go at the end of `hooks`, a new `hooks` at the end of the root. */
function add(root: Json, t: HookTarget): Json {
  const hooks = isObj(root.hooks) ? root.hooks : {}
  const ours = HOOK_EVENTS.map((e) => [e, [...((hooks[e] as unknown[] | undefined) ?? []), ourGroup(e, t)]])
  return { ...root, hooks: { ...hooks, ...Object.fromEntries(ours) } }
}

const BOM = /^﻿/

/** Keeps the original's byte-order mark, indent, line endings and trailing newline (new files end with one). */
function serialize(obj: Json, like: string | null): string {
  const indent = like === null ? '  ' : (/^([ \t]+)\S/m.exec(like)?.[1] ?? '  ')
  const eol = like?.includes('\r\n') ? '\r\n' : '\n'
  const tail = like === null || like.endsWith('\n') ? eol : ''
  const bom = like !== null && BOM.test(like) ? '﻿' : ''
  return bom + JSON.stringify(obj, null, indent).replaceAll('\n', eol) + tail
}

function plan(text: string | null, root: Json, next: Json, conflicts: string[]): Plan {
  // Nothing to add or remove: keep the user's bytes, whatever their formatting.
  if (isDeepStrictEqual(next, root)) return { ok: true, before: text, after: text ?? '', changed: false, diff: '', conflicts }
  const after = serialize(next, text)
  const changed = after !== text
  return { ok: true, before: text, after, changed, diff: changed ? unifiedDiff(text ?? '', after) : '', conflicts }
}

/** `text` is the current file content, or null when the file does not exist. */
export function planInstall(text: string | null, target: HookTarget): Plan {
  const parsed = parse(text)
  if (!parsed.ok) return parsed
  const { root } = parsed
  return plan(text, root, add(strip(root, PRUNE_REFILLED), target), conflicts(root, target.port))
}

export function planUninstall(text: string | null): Plan {
  const parsed = parse(text)
  if (!parsed.ok) return parsed
  return plan(text, parsed.root, strip(parsed.root, PRUNE_OURS), [])
}

/** True when `after` keeps every foreign (non-ours) piece of `before` deep-equal, i.e. stripping ours from both gives equal objects. */
export function foreignUnchanged(before: string | null, after: string): boolean {
  const a = parse(before)
  const b = parse(after)
  return a.ok && b.ok && isDeepStrictEqual(strip(a.root, PRUNE_ALL), strip(b.root, PRUNE_ALL))
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const globMatches = (pattern: string, s: string): boolean =>
  new RegExp(`^${pattern.split(/\*+/).map(escapeRe).join('.*')}$`).test(s)

function conflicts(root: Json, port: number): string[] {
  const url = ourUrl(port)
  const allowed = root.allowedHttpHookUrls
  const blocked = Array.isArray(allowed) && !allowed.some((p) => typeof p === 'string' && globMatches(p, url))
  return [
    ...(root.disableAllHooks === true ? ['disableAllHooks is true in this file, so Claude Code runs no hooks at all.'] : []),
    ...(blocked ? [`allowedHttpHookUrls has no pattern matching ${url}, so Claude Code will block AgentDeck's hooks.`] : [])
  ]
}

type Op = [' ' | '-' | '+', string]
const lines = (t: string): string[] => (t === '' ? [] : t.replace(/\r?\n$/, '').split(/\r?\n/))

// shortcut: O(n·m) LCS table, fine for settings.json sizes; switch to Myers if files reach thousands of lines
function lineOps(a: string[], b: string[]): Op[] {
  const w = b.length + 1
  const lcs = new Uint32Array((a.length + 1) * w)
  const at = (i: number, j: number): number => lcs[i * w + j] ?? 0
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * w + j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
    }
  }
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      ops.push([' ', a[i++] ?? ''])
      j++
    } else if (i < a.length && (j === b.length || at(i + 1, j) >= at(i, j + 1))) {
      ops.push(['-', a[i++] ?? ''])
    } else {
      ops.push(['+', b[j++] ?? ''])
    }
  }
  return ops
}

const TOKEN_VALUE = new RegExp(String.raw`("${TOKEN_HEADER}"\s*:\s*)"(?:[^"\\]|\\.)*"`, 'g')
const mask = (line: string): string => maskSecrets(line.replace(TOKEN_VALUE, '$1"•••"'))
/** Lines of the old (skip '+') or new (skip '-') file covered by `ops`. */
const span = (ops: Op[], skip: '+' | '-'): number => ops.filter(([o]) => o !== skip).length
const range = (start: number, count: number): string => `${count > 0 ? start + 1 : start},${count}`

function unifiedDiff(before: string, after: string): string {
  const ops = lineOps(lines(before), lines(after))
  const hunks: [number, number][] = []
  ops.forEach(([o], k) => {
    if (o === ' ') return
    const last = hunks.at(-1)
    const end = Math.min(ops.length, k + CONTEXT + 1)
    if (last && k - CONTEXT <= last[1]) last[1] = end
    else hunks.push([Math.max(0, k - CONTEXT), end])
  })
  const body = hunks.flatMap(([s, e]) => {
    const head = ops.slice(0, s)
    const hunk = ops.slice(s, e)
    const header = `@@ -${range(span(head, '+'), span(hunk, '+'))} +${range(span(head, '-'), span(hunk, '-'))} @@`
    return [header, ...hunk.map(([o, l]) => o + l)]
  })
  return ['--- settings.json', '+++ settings.json (after)', ...body].map(mask).join('\n')
}
