// ADR-0005: merge AgentDeck's HTTP hook entries into Claude Code's settings.json and strip them again.
// Pure: text in, text out. The fs side lives in settings-writer.ts.
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { findNodeAtLocation, parseTree, type JSONPath, type Node, type ParseError } from 'jsonc-parser'

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
  | { ok: true; before: string | null; after: string; changed: boolean; conflicts: string[] }
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

/** " (line L, column C)" of the first syntax error, or "" if jsonc-parser finds none (it is laxer than JSON.parse). */
function where(body: string): string {
  const errors: ParseError[] = []
  parseTree(body, errors, { disallowComments: true })
  const at = errors[0]?.offset
  if (at === undefined) return ''
  const before = body.slice(0, at)
  return ` (line ${before.split('\n').length}, column ${at - before.lastIndexOf('\n')})`
}

/** Text to edit: none, or only whitespace (an editor's empty save), counts as `{}`. */
const bodyOf = (text: string | null): string => (text === null || !text.replace(BOM, '').trim() ? '{}\n' : text.replace(BOM, ''))

function parse(text: string | null): Parsed {
  const body = bodyOf(text) // Windows PowerShell 5.1 `Out-File` writes a BOM
  let root: unknown
  try {
    root = JSON.parse(body)
  } catch {
    // Not the engine's message: it quotes the file around the error, and the file can hold API keys.
    return { ok: false, error: `settings.json is not valid JSON${where(body)}` }
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
// Install keeps the containers it refills, so they keep their place in the file.
const PRUNE_REFILLED: Prune = (e, byUs) => byUs && e !== null && !HOOK_EVENTS.includes(e)
// Comparison: an empty container carries no foreign content.
const PRUNE_ALL: Prune = () => true

/** Object form, for `foreignUnchanged`: an independent check of what the text edits below did. */
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

const BOM = /^\uFEFF/

// ── Text edits: every byte outside our entries stays as the user wrote it (acceptance: "nothing else changes") ──

// jsonc-parser only locates nodes; the splices are ours, so a removal is the exact inverse of an insertion. (Its
// `modify` reformats whole neighbouring lines on insert and drops a `\r` when it removes a CRLF file's last item.)

const splice = (text: string, from: number, to: number, content: string): string => text.slice(0, from) + content + text.slice(to)
const tree = (text: string): Node => parseTree(text)! // the text is strict JSON throughout

/** Leading whitespace of the line `offset` is on, plus one unit if something precedes `offset` on that line. */
function indentAt(text: string, offset: number, unit: string): string {
  const start = text.lastIndexOf('\n', offset - 1) + 1
  const lead = /^[ \t]*/.exec(text.slice(start))![0]
  return text.slice(start + lead.length, offset).trim() ? lead + unit : lead
}

/** Appends `value` (as `"key": value` in an object) after the container's last child, in the file's own style. */
function append(text: string, path: JSONPath, value: unknown, key?: string): string {
  const unit = /^([ \t]+)\S/m.exec(text)?.[1] ?? '  '
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const box = findNodeAtLocation(tree(text), path)!
  const open = box.parent?.type === 'property' ? box.parent.offset : box.offset
  const kids = box.children ?? []
  const last = kids.at(-1)
  const outer = indentAt(text, open, '')
  const inner = last ? indentAt(text, last.offset, unit) : outer + unit
  const body = (key === undefined ? '' : `${JSON.stringify(key)}: `) + JSON.stringify(value, null, unit).replaceAll('\n', eol + inner)
  if (last) return splice(text, last.offset + last.length, last.offset + last.length, `,${eol}${inner}${body}`)
  return splice(text, box.offset + 1, box.offset + box.length - 1, `${eol}${inner}${body}${eol}${outer}`)
}

/** Deletes the array item or object property at `path`, with the comma and whitespace that joined it to a sibling. */
function remove(text: string, path: JSONPath): string {
  const value = findNodeAtLocation(tree(text), path)!
  const node = value.parent?.type === 'property' ? value.parent : value
  const box = node.parent!
  const kids = box.children!
  const i = kids.indexOf(node)
  if (kids.length === 1) return splice(text, box.offset + 1, box.offset + box.length - 1, '')
  if (i === kids.length - 1) return splice(text, kids[i - 1]!.offset + kids[i - 1]!.length, node.offset + node.length, '')
  return splice(text, node.offset, kids[i + 1]!.offset, '')
}

/** `hooks` after some edits. */
const hooksOf = (text: string): Json => (JSON.parse(text) as { hooks: Json }).hooks

/** Removes our hook entries (and groups and containers our removal emptied, as `prune` decides) by deleting their text. */
function stripText(text: string, prune: Prune): string {
  const root = JSON.parse(text) as Json
  if (!isObj(root.hooks)) return text
  let out = text
  const events = Object.entries(root.hooks)
  for (const [event, groups] of events) {
    if (!Array.isArray(groups)) continue
    // Back to front, so the indices still to visit don't move.
    for (let g = groups.length - 1; g >= 0; g--) {
      const group: unknown = groups[g]
      if (!isObj(group) || !Array.isArray(group.hooks) || !group.hooks.some(isOurs)) continue
      if (group.hooks.every(isOurs)) out = remove(out, ['hooks', event, g])
      else for (let h = group.hooks.length - 1; h >= 0; h--) if (isOurs(group.hooks[h])) out = remove(out, ['hooks', event, g, 'hooks', h])
    }
    const emptied = groups.length > 0 && (hooksOf(out)[event] as unknown[]).length === 0
    if (emptied && prune(event, true)) out = remove(out, ['hooks', event])
  }
  if (events.length > 0 && Object.keys(hooksOf(out)).length === 0 && prune(null, true)) out = remove(out, ['hooks'])
  return out
}

/** Appends our group to each event; new event keys go at the end of `hooks`, a new `hooks` at the end of the root. */
function addText(text: string, t: HookTarget): string {
  let out = isObj((JSON.parse(text) as Json).hooks) ? text : append(text, [], {}, 'hooks')
  for (const e of HOOK_EVENTS) {
    out = Array.isArray(hooksOf(out)[e]) ? append(out, ['hooks', e], ourGroup(e, t)) : append(out, ['hooks'], [ourGroup(e, t)], e)
  }
  return out
}

function plan(text: string | null, root: Json, edit: (body: string) => string, conflicts: string[]): Plan {
  const bom = text !== null && BOM.test(text) ? '\uFEFF' : ''
  const edited = bom + edit(bodyOf(text))
  // Nothing to add or remove: keep the user's bytes, whatever their formatting.
  if (isDeepStrictEqual(JSON.parse(edited.replace(BOM, '')), root)) return { ok: true, before: text, after: text ?? '', changed: false, conflicts }
  return { ok: true, before: text, after: edited, changed: true, conflicts }
}

/** The masked unified diff a preview shows. Only previews build it: status checks run on every window focus. */
export function planDiff(p: Extract<Plan, { ok: true }>): string {
  return p.changed ? unifiedDiff(p.before ?? '', p.after) : ''
}

/** `text` is the current file content, or null when the file does not exist. */
export function planInstall(text: string | null, target: HookTarget): Plan {
  const parsed = parse(text)
  if (!parsed.ok) return parsed
  return plan(text, parsed.root, (body) => addText(stripText(body, PRUNE_REFILLED), target), conflicts(parsed.root, target.port))
}

export function planUninstall(text: string | null): Plan {
  const parsed = parse(text)
  if (!parsed.ok) return parsed
  return plan(text, parsed.root, (body) => stripText(body, PRUNE_OURS), [])
}

export type Inspection = { ok: true; installed: boolean; conflicts: string[] } | { ok: false; error: string }

/**
 * With a target: every event has exactly one of our entries, equal to the one we'd write, and no other event has any.
 * Order doesn't matter, so a group that `/hooks` added after ours still reads as installed (M3 code review).
 * Without one (no port yet): whether any of ours is there.
 */
export function inspect(text: string | null, target: HookTarget | null): Inspection {
  const parsed = parse(text)
  if (!parsed.ok) return parsed
  const hooks = isObj(parsed.root.hooks) ? parsed.root.hooks : {}
  const ours = (event: string): unknown[] => {
    const groups = hooks[event]
    return (Array.isArray(groups) ? groups : []).flatMap((g: unknown) => (isObj(g) && Array.isArray(g.hooks) ? g.hooks : [])).filter(isOurs)
  }
  if (!target) return { ok: true, installed: Object.keys(hooks).some((e) => ours(e).length > 0), conflicts: [] }
  const exact = (e: string): boolean => {
    const found = ours(e)
    return found.length === 1 && isDeepStrictEqual(found[0], (ourGroup(e, target).hooks as unknown[])[0])
  }
  const installed = HOOK_EVENTS.every(exact) && Object.keys(hooks).every((e) => HOOK_EVENTS.includes(e) || ours(e).length === 0)
  return { ok: true, installed, conflicts: conflicts(parsed.root, target.port) }
}

/** True when `after` keeps every foreign (non-ours) piece of `before` deep-equal, i.e. stripping ours from both gives equal objects. */
export function foreignUnchanged(before: string | null, after: string): boolean {
  const a = parse(before)
  const b = parse(after)
  return a.ok && b.ok && isDeepStrictEqual(strip(a.root, PRUNE_ALL), strip(b.root, PRUNE_ALL))
}

/** `*` matches any run of characters. Linear: the pattern comes from the user's file, so no regex to backtrack. */
export function globMatches(pattern: string, s: string): boolean {
  const parts = pattern.split('*')
  const first = parts[0] ?? ''
  const last = parts.at(-1) ?? ''
  if (parts.length === 1) return pattern === s
  if (!s.startsWith(first) || s.length < first.length + last.length) return false
  let at = first.length
  for (const part of parts.slice(1, -1)) {
    const i = s.indexOf(part, at)
    if (i < 0) return false
    at = i + part.length
  }
  return s.length - last.length >= at && s.endsWith(last)
}

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

const LCS_MAX_CELLS = 4_000_000 // ≈ 16 MB; about 2,000 lines each side

// shortcut: O(n·m) LCS table, fine for settings.json sizes; past LCS_MAX_CELLS the diff is the whole file out and in
function lineOps(a: string[], b: string[]): Op[] {
  if ((a.length + 1) * (b.length + 1) > LCS_MAX_CELLS) return [...a.map((l): Op => ['-', l]), ...b.map((l): Op => ['+', l])]
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

const JSON_STRING = /"(?:[^"\\]|\\.)*"(\s*:)?/g
const SHOWN = /^"(?:http|http:\/\/127\.0\.0\.1:\d+\/hooks)"$/
/**
 * Structure only: keys stay, every string value is hidden except our entry's type and URL. Pattern masking missed
 * secrets in shapes it didn't know (M3 security review), and the token can sit on a line of its own.
 */
const mask = (line: string): string => line.replace(JSON_STRING, (s, key?: string) => (key || SHOWN.test(s) ? s : '"•••"'))
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
