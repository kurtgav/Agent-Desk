import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  foreignUnchanged,
  HOOK_EVENTS,
  inspect,
  isOurs,
  globMatches,
  planDiff,
  planInstall,
  planUninstall,
  settingsPath,
  shapeKey,
  type HookTarget,
  type Plan
} from './hooks-install'
import { writeSettings } from './settings-writer'

const T: HookTarget = { port: 47821, token: 'tok-secret-123' }
const OURS = { type: 'http', url: 'http://127.0.0.1:47821/hooks', timeout: 2, headers: { 'X-AgentDeck-Token': 'tok-secret-123' } }
const LINT = { matcher: 'Bash', hooks: [{ type: 'command', command: 'lint' }] }
const SETTINGS = {
  env: { FOO: 'bar' },
  hooks: { PreToolUse: [LINT], SessionStart: [{ hooks: [{ type: 'command', command: 'hello' }] }] },
  permissions: { allow: ['Bash(npm test)'] }
}

function ok(p: Plan) {
  if (!p.ok) throw new Error(p.error)
  return p
}
const install = (text: string | null, t = T) => ok(planInstall(text, t))
const uninstall = (text: string | null) => ok(planUninstall(text))
const json = (text: string) => JSON.parse(text) as { hooks: Record<string, { hooks: unknown[] }[]> } & Record<string, unknown>

describe('isOurs', () => {
  it('accepts our entry', () => {
    expect(isOurs(OURS)).toBe(true)
  })

  it('rejects everything else', () => {
    const token = { 'X-AgentDeck-Token': 'x' }
    expect(isOurs({ type: 'http', url: 'http://127.0.0.1:9000/other', headers: token })).toBe(false)
    expect(isOurs({ type: 'command', command: 'echo' })).toBe(false)
    expect(isOurs({ type: 'http', url: OURS.url })).toBe(false)
    expect(isOurs({ type: 'http', url: OURS.url, headers: { Authorization: 'x' } })).toBe(false)
    expect(isOurs({ type: 'http', url: 'https://127.0.0.1:47821/hooks', headers: token })).toBe(false)
    expect(isOurs({ type: 'http', url: 'http://localhost:47821/hooks', headers: token })).toBe(false)
    expect(isOurs(null)).toBe(false)
    expect(isOurs('x')).toBe(false)
  })
})

describe('settingsPath', () => {
  it('uses CLAUDE_CONFIG_DIR when set, else <home>/.claude', () => {
    expect(settingsPath({ CLAUDE_CONFIG_DIR: join('D:', 'cfg') }, join('C:', 'home'))).toBe(join('D:', 'cfg', 'settings.json'))
    expect(settingsPath({}, join('C:', 'home'))).toBe(join('C:', 'home', '.claude', 'settings.json'))
  })
})

describe('planInstall', () => {
  it('creates every event into a missing file, ending with a newline', () => {
    const p = install(null)
    expect(p).toMatchObject({ before: null, changed: true, conflicts: [] })
    expect(p.after.endsWith('}\n')).toBe(true)
    const { hooks } = json(p.after)
    expect(Object.keys(hooks)).toEqual(HOOK_EVENTS)
    expect(hooks.Stop).toEqual([{ hooks: [OURS] }])
    expect(hooks.SessionStart).toBeUndefined()
  })

  it('installs into {} keeping the trailing-newline rule', () => {
    expect(install('{}').after.endsWith('}')).toBe(true)
    expect(install('{}\n').after.endsWith('}\n')).toBe(true)
    expect(Object.keys(json(install('{}').after).hooks)).toHaveLength(16)
  })

  it('appends after foreign groups and leaves other events and keys alone', () => {
    const after = json(install(JSON.stringify(SETTINGS, null, 2)).after)
    expect(Object.keys(after)).toEqual(['env', 'hooks', 'permissions'])
    expect(after.env).toEqual(SETTINGS.env)
    expect(after.permissions).toEqual(SETTINGS.permissions)
    expect(after.hooks.PreToolUse).toEqual([LINT, { hooks: [OURS] }])
    expect(after.hooks.SessionStart).toEqual(SETTINGS.hooks.SessionStart)
    expect(Object.keys(after.hooks).slice(0, 2)).toEqual(['PreToolUse', 'SessionStart'])
  })

  it('adds hooks at the end of a file with only unrelated keys', () => {
    const text = JSON.stringify({ env: { A: '1' }, permissions: { deny: [] } }, null, 2)
    expect(Object.keys(json(install(text).after))).toEqual(['env', 'permissions', 'hooks'])
  })

  it('is idempotent', () => {
    const first = install(JSON.stringify(SETTINGS, null, 2))
    const second = install(first.after)
    expect(second).toMatchObject({ changed: false, after: first.after })
  })

  it('replaces our entries when port or token change', () => {
    const original = JSON.stringify(SETTINGS, null, 2)
    const moved = { port: 50000, token: 'new-token' }
    const after = install(install(original).after, moved).after
    expect(after).toBe(install(original, moved).after)
    expect(after).not.toContain('47821')
    const { hooks } = json(after)
    expect(hooks.PreToolUse?.[0]).toEqual(LINT)
    for (const e of HOOK_EVENTS) expect(hooks[e]?.filter((g) => g.hooks.some(isOurs))).toHaveLength(1)
  })

  it('permissionTimeoutSec changes only the PermissionRequest timeout, and the shape key', () => {
    const { hooks } = json(install(null, { ...T, permissionTimeoutSec: 310 }).after)
    expect(hooks.PermissionRequest).toEqual([{ hooks: [{ ...OURS, timeout: 310 }] }])
    expect(hooks.PreToolUse).toEqual([{ hooks: [OURS] }])
    expect(shapeKey({})).toBe(shapeKey({}))
    expect(shapeKey({ permissionTimeoutSec: 310 })).not.toBe(shapeKey({}))
  })

  it('aborts on unparseable or malformed settings', () => {
    for (const bad of ['{not json', '[1,2]', '{"hooks":[]}', '{"hooks":null}', '{"hooks":{"Stop":{}}}']) {
      expect(planInstall(bad, T).ok).toBe(false)
      expect(planUninstall(bad).ok).toBe(false)
    }
  })

  it('reports disableAllHooks and an allowedHttpHookUrls list that blocks us', () => {
    expect(install('{"disableAllHooks":true}').conflicts).toEqual([expect.stringContaining('disableAllHooks')])
    expect(install('{"allowedHttpHookUrls":["https://example.com/*"]}').conflicts).toEqual([
      expect.stringContaining('allowedHttpHookUrls')
    ])
    expect(install('{"allowedHttpHookUrls":[]}').conflicts).toHaveLength(1)
    expect(install('{"allowedHttpHookUrls":["http://127.0.0.1:*"]}').conflicts).toEqual([])
    expect(install('{"allowedHttpHookUrls":["http://127.0.0.1:47821/hooks"]}').conflicts).toEqual([])
    expect(install('{"disableAllHooks":true}').changed).toBe(true)
  })
})

describe('diff', () => {
  it('masks our token and other secrets', () => {
    const text = JSON.stringify({ env: { ANTHROPIC_API_KEY: 'sk-ant-api03-abcdef' } }, null, 2) + '\n'
    const diff = planDiff(install(text))
    expect(diff).toMatch(/^--- settings\.json\n\+\+\+ settings\.json \(after\)\n@@ -\d+,\d+ \+\d+,\d+ @@/)
    expect(diff).toContain('"ANTHROPIC_API_KEY": "•••"')
    expect(diff).toContain('"X-AgentDeck-Token": "•••"')
    expect(diff).not.toContain('sk-ant')
    expect(diff).not.toContain('tok-secret')
  })

  it('counts lines in hunk headers', () => {
    const p = install(null)
    const lines = p.after.trimEnd().split('\n')
    expect(planDiff(p).split('\n')[2]).toBe(`@@ -0,0 +1,${lines.length} @@`)
    expect(planDiff(uninstall(p.after)).split('\n').slice(2, 4)).toEqual([`@@ -1,${lines.length} +1,1 @@`, '-{'])
  })

  it('shows only the changed lines with 2 lines of context on a port change', () => {
    const diff = planDiff(install(install('{}').after, { port: 1, token: 'other' }))
    const changes = diff.split('\n').filter((l) => /^[-+] /.test(l))
    expect(changes).toHaveLength(64) // 16 events × (url + token) × (old + new)
    expect(diff).not.toContain('other')
  })

  it('shows structure only: keys and our address stay, every other value is hidden, wherever it sits', () => {
    const user = [
      '{',
      '  "env": { "DB_PASS": "hunter two", "Authorization": "Basic dXNlcjpwYXNz" },',
      '  "hooks": {',
      '    "Stop": [',
      '      { "hooks": [{ "type": "command", "command": "curl https://hooks.slack.com/services/T0/B0/xyz" }] }',
      '    ]',
      '  }',
      '}',
      ''
    ].join('\n')
    const diff = planDiff(install(user))
    expect(diff).toContain('"url": "http://127.0.0.1:47821/hooks"')
    expect(diff).toContain('"type": "http"')
    for (const secret of ['hunter', 'dXNlcjpwYXNz', 'slack', 'tok-secret']) expect(diff).not.toContain(secret)
    // A hand-wrapped token on a line of its own, and a minified one-line file.
    const wrapped = install(null).after.replace(/("X-AgentDeck-Token":) /g, '$1\n          ')
    expect(planDiff(uninstall(wrapped))).not.toContain('tok-secret')
    expect(planDiff(install('{"env":{"K":"v-secret"}}'))).not.toContain('v-secret')
  })
})

describe('known limit (D-084)', () => {
  it('an empty container the user already had does not come back after uninstall', () => {
    // Uninstall is stateless: it can't tell `"Stop": []` it emptied from one that was empty before install.
    const text = '{\n  "hooks": {\n    "Stop": []\n  }\n}\n'
    expect(uninstall(install(text).after).after).toBe('{}\n')
    expect(foreignUnchanged(text, '{}\n')).toBe(true) // nothing with content was lost
  })
})

describe('reading the file', () => {
  it('an empty or blank file counts as {}', () => {
    for (const blank of ['', '  \n', '﻿']) {
      expect(json(install(blank).after.replace(/^﻿/, '')).hooks.Stop).toHaveLength(1)
      expect(uninstall(blank)).toMatchObject({ changed: false, after: blank })
    }
  })

  it('a syntax error is reported by line and column, never by quoting the file', () => {
    const p = planInstall('{\n  "env": { "API_KEY": sk-ant-api03-abc }\n}', T)
    expect(p).toEqual({ ok: false, error: 'settings.json is not valid JSON (line 2, column 23)' })
  })
})

describe('inspect (is it installed?)', () => {
  it('is order-insensitive: a group added after ours still reads as installed', () => {
    const after = json(install(JSON.stringify(SETTINGS)).after)
    after.hooks.Stop!.push({ hooks: [{ type: 'command', command: 'added later by /hooks' }] })
    after.hooks.PreToolUse!.reverse()
    expect(inspect(JSON.stringify(after), T)).toMatchObject({ ok: true, installed: true })
  })

  it('is not installed when an event lacks ours, has two, points elsewhere, or ours sits under an event we do not use', () => {
    const base = (): ReturnType<typeof json> => json(install(null).after)
    const missing = base()
    missing.hooks.Stop = []
    const twice = base()
    twice.hooks.Stop!.push({ hooks: [OURS] })
    const extra = base()
    extra.hooks.SessionStart = [{ hooks: [OURS] }]
    for (const s of [missing, twice, extra]) expect(inspect(JSON.stringify(s), T)).toMatchObject({ installed: false })
    expect(inspect(install(null).after, { ...T, port: 1 })).toMatchObject({ installed: false })
    expect(inspect(install(null).after, { ...T, token: 'rotated' })).toMatchObject({ installed: false })
  })

  it('without a port it says whether any of ours is there', () => {
    expect(inspect(JSON.stringify(SETTINGS), null)).toMatchObject({ installed: false })
    expect(inspect(install(null).after, null)).toMatchObject({ installed: true })
  })
})

describe('globMatches (allowedHttpHookUrls)', () => {
  it.each([
    ['http://127.0.0.1:*', true],
    ['http://127.0.0.1:*/hooks', true],
    ['*', true],
    ['http://127.0.0.1:47821/hooks', true],
    ['https://*', false],
    ['http://localhost:*', false],
    ['*:47821/hooks*', true],
    ['http://127.0.0.1:*/other', false]
  ])('%s → %s', (pattern, expected) => {
    expect(globMatches(pattern, 'http://127.0.0.1:47821/hooks')).toBe(expected)
  })

  it('stays linear on patterns that make a regex backtrack', () => {
    const start = performance.now()
    expect(globMatches(`${'*a'.repeat(40)}b`, 'a'.repeat(5_000))).toBe(false)
    expect(performance.now() - start).toBeLessThan(200)
  })
})

describe('hand-formatted files (acceptance: nothing else changes)', () => {
  const HAND = [
    '{',
    '    "model": "opus",  "env": { "FOO": "bar" },',
    '    "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "lint" } ] } ] },',
    '    "permissions": {"allow": ["Bash(npm test)"]}',
    '}'
  ]

  it.each([
    ['LF', HAND.join('\n') + '\n'],
    ['CRLF, no trailing newline', HAND.join('\r\n')],
    ['no hooks yet', '{ "model": "opus" }'],
    ['empty object', '{}']
  ])('%s: install keeps every foreign byte, uninstall restores the file exactly', (_, original) => {
    const after = install(original).after
    expect(foreignUnchanged(original, after)).toBe(true)
    expect(json(after).hooks.Stop).toHaveLength(1)
    expect(uninstall(after).after).toBe(original)
    expect(install(after).changed).toBe(false)
  })
})

describe('byte-order mark', () => {
  it('reads a settings.json saved with a BOM, keeps the BOM, and round-trips to the original bytes', () => {
    const original = `\uFEFF${JSON.stringify(SETTINGS, null, 2).replaceAll('\n', '\r\n')}\r\n`
    const after = install(original).after
    expect(after.startsWith('\uFEFF{')).toBe(true)
    expect(json(after.slice(1)).hooks.Stop).toHaveLength(1)
    expect(uninstall(after).after).toBe(original)
  })
})

describe('planUninstall', () => {
  it('restores the original bytes after install', () => {
    for (const original of [
      JSON.stringify(SETTINGS, null, 2) + '\n',
      JSON.stringify(SETTINGS, null, 2),
      JSON.stringify(SETTINGS, null, 4) + '\n',
      '{}',
      JSON.stringify(SETTINGS, null, 2).replaceAll('\n', '\r\n') + '\r\n'
    ]) {
      expect(uninstall(install(original).after).after).toBe(original)
    }
  })

  it('keeps foreign groups that share an event, and foreign hooks inside a mixed group', () => {
    const text = JSON.stringify({ hooks: { PreToolUse: [LINT, { hooks: [OURS] }], Stop: [{ hooks: [{ type: 'command', command: 'x' }, OURS] }] } })
    const { hooks } = json(uninstall(text).after)
    expect(hooks).toEqual({ PreToolUse: [LINT], Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] })
    expect(json(install(text).after).hooks.Stop).toEqual([{ hooks: [{ type: 'command', command: 'x' }] }, { hooks: [OURS] }])
  })

  it('is a no-op without our entries or without a file', () => {
    const minified = JSON.stringify(SETTINGS)
    expect(uninstall(minified)).toMatchObject({ changed: false, after: minified })
    expect(uninstall(null)).toMatchObject({ changed: false })
  })
})

describe('foreignUnchanged', () => {
  it('ignores our entries and catches foreign edits', () => {
    const original = JSON.stringify(SETTINGS)
    const after = install(original).after
    expect(foreignUnchanged(original, after)).toBe(true)
    expect(foreignUnchanged(null, install(null).after)).toBe(true)
    expect(foreignUnchanged(original, after.replace('"bar"', '"baz"'))).toBe(false)
    expect(foreignUnchanged(original, '{oops')).toBe(false)
  })
})

describe('writeSettings', () => {
  let dir: string
  let file: string
  let backups: string
  const AT = new Date(Date.UTC(2026, 10, 5, 14, 3, 22, 123))
  const toInstall = (text: string | null) => planInstall(text, T)
  const listBackups = () => readdirSync(backups).filter((f) => f.startsWith('settings-')).sort()

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentdeck-hooks-'))
    file = join(dir, 'settings.json')
    backups = join(dir, 'backups')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('backs up, writes the plan and leaves no temp file', () => {
    const original = JSON.stringify(SETTINGS, null, 2) + '\n'
    writeFileSync(file, original)
    const res = writeSettings(file, toInstall, backups, () => AT)
    const backup = join(backups, 'settings-20261105-140322-123.json')
    expect(res).toEqual({ ok: true, backup })
    expect(readFileSync(backup, 'utf8')).toBe(original)
    expect(readFileSync(file, 'utf8')).toBe(install(original).after)
    expect(existsSync(`${file}.agentdeck.tmp`)).toBe(false)
  })

  it('does not write or back up when nothing changes', () => {
    writeFileSync(file, '{}')
    writeSettings(file, toInstall, backups, () => AT)
    const written = readFileSync(file, 'utf8')
    expect(writeSettings(file, toInstall, backups, () => new Date())).toEqual({ ok: true, backup: null })
    expect(listBackups()).toHaveLength(1)
    expect(readFileSync(file, 'utf8')).toBe(written)
  })

  it('creates a missing parent dir and makes no backup of a missing file', () => {
    const nested = join(dir, 'new', 'cfg', 'settings.json')
    expect(writeSettings(nested, toInstall, backups)).toEqual({ ok: true, backup: null })
    expect(readFileSync(nested, 'utf8')).toBe(install(null).after)
  })

  it('keeps the newest 20 backups and ignores other files', () => {
    writeFileSync(file, '{}')
    mkdirSync(backups)
    for (let i = 0; i < 25; i++) writeFileSync(join(backups, `settings-20200101-000000-${String(i).padStart(3, '0')}.json`), '{}')
    writeFileSync(join(backups, 'keep-me.txt'), 'x')
    writeSettings(file, toInstall, backups, () => AT)
    const kept = listBackups()
    expect(kept).toHaveLength(20)
    expect(kept.at(-1)).toBe('settings-20261105-140322-123.json')
    expect(kept[0]).toBe('settings-20200101-000000-006.json')
    expect(existsSync(join(backups, 'keep-me.txt'))).toBe(true)
  })

  it('re-plans when the file changes between read and rename', () => {
    writeFileSync(file, JSON.stringify(SETTINGS, null, 2))
    let calls = 0
    const racing = (text: string | null) => {
      if (calls++ === 0) writeFileSync(file, JSON.stringify({ model: 'opus', ...SETTINGS }, null, 2))
      return planInstall(text, T)
    }
    expect(writeSettings(file, racing, backups).ok).toBe(true)
    expect(calls).toBe(2)
    const after = json(readFileSync(file, 'utf8'))
    expect(after.model).toBe('opus')
    expect(after.hooks.PreToolUse).toEqual([LINT, { hooks: [OURS] }])
  })

  it('gives up when the file keeps changing', () => {
    writeFileSync(file, '{}')
    let n = 0
    const racing = (text: string | null) => {
      writeFileSync(file, JSON.stringify({ n: n++ }))
      return planInstall(text, T)
    }
    expect(writeSettings(file, racing, backups)).toEqual({ ok: false, error: 'settings.json kept changing' })
    expect(readFileSync(file, 'utf8')).toBe('{"n":2}')
    expect(existsSync(`${file}.agentdeck.tmp`)).toBe(false)
  })

  it('restores the original when the written file drops a foreign key', () => {
    const original = JSON.stringify(SETTINGS, null, 2)
    writeFileSync(file, original)
    const lossy = (text: string | null): Plan => {
      const p = ok(planInstall(text, T))
      const rest = Object.fromEntries(Object.entries(json(p.after)).filter(([k]) => k !== 'permissions'))
      return { ...p, after: JSON.stringify(rest, null, 2) }
    }
    const res = writeSettings(file, lossy, backups)
    expect(res.ok).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe(original)
  })

  it('deletes the file again when validation fails and there was none', () => {
    const bad = (): Plan => ({ ok: true, before: null, after: '{"x":1}', changed: true, conflicts: [] })
    expect(writeSettings(file, bad, backups).ok).toBe(false)
    expect(existsSync(file)).toBe(false)
  })

  it('aborts on a parse error without writing or backing up', () => {
    writeFileSync(file, '{bad')
    expect(writeSettings(file, toInstall, backups).ok).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe('{bad')
    expect(existsSync(backups)).toBe(false)
  })
})
