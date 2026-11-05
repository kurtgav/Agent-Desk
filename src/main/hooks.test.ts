import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hookOptions, hooksState, install, previewInstall, previewUninstall, shapeFor, uninstall, type HookPaths } from './hooks'

describe('remote approvals shape (ADR-0006)', () => {
  it('stretches only the PermissionRequest timeout, to the wait plus 10 s, and a new shape asks for consent again', () => {
    const off = { enabled: false, waitSec: 60 }
    expect(hookOptions(off)).toEqual({})
    expect(hookOptions({ enabled: true, waitSec: 60 })).toEqual({ permissionTimeoutSec: 70 })
    expect(shapeFor({ ...off, waitSec: 90 })).toBe(shapeFor(off)) // the wait matters only while on
    expect(shapeFor({ enabled: true, waitSec: 60 })).not.toBe(shapeFor(off))
    expect(shapeFor({ enabled: true, waitSec: 90 })).not.toBe(shapeFor({ enabled: true, waitSec: 60 }))
  })
})

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** A temp config dir; `settings` seeds settings.json, omitted means no file (and no `.claude` dir) yet. */
function paths(settings?: string): HookPaths {
  const dir = mkdtempSync(join(tmpdir(), 'agentdeck-hooks-'))
  dirs.push(dir)
  const p = { settings: join(dir, '.claude', 'settings.json'), backups: join(dir, 'backups') }
  if (settings !== undefined) {
    mkdirSync(join(dir, '.claude'))
    writeFileSync(p.settings, settings)
  }
  return p
}

const T = { port: 47821, token: 'a'.repeat(64) }
const ORIGINAL = '{\n  "model": "opus",\n  "env": { "ANTHROPIC_API_KEY": "sk-ant-secret" }\n}\n'

describe('hook integration (acceptance: uninstall removes exactly our entries)', () => {
  it('goes missing → installed → missing, leaving the file byte-identical, with one backup per write', () => {
    const p = paths(ORIGINAL)
    expect(hooksState(p, T)).toEqual({ hooks: 'missing', hooksError: null, conflicts: [] })
    expect(hooksState(p, null).hooks).toBe('missing')

    expect(install(p, T)).toEqual({ ok: true })
    expect(hooksState(p, T).hooks).toBe('installed')
    expect(hooksState(p, null).hooks).toBe('installed')
    expect(hooksState(p, { ...T, port: 47822 }).hooks).toBe('missing') // stale port: needs a rewrite (R31)
    expect(install(p, T)).toEqual({ ok: true }) // idempotent: no second backup
    expect(readdirSync(p.backups)).toHaveLength(1)

    expect(uninstall(p)).toEqual({ ok: true })
    expect(readFileSync(p.settings, 'utf8')).toBe(ORIGINAL)
    expect(readdirSync(p.backups)).toHaveLength(2)
  })

  it('previews without writing, and never shows the token or other secrets', () => {
    const p = paths(ORIGINAL)
    const before = readFileSync(p.settings, 'utf8')
    const pre = previewInstall(p, T)
    expect(pre).toMatchObject({ ok: true, changed: true, path: p.settings, backups: p.backups })
    if (!pre.ok) throw new Error(pre.error)
    expect(pre.diff).toContain('+')
    expect(pre.diff).toContain('http://127.0.0.1:47821/hooks')
    expect(pre.diff).not.toContain(T.token)
    expect(pre.diff).not.toContain('sk-ant-secret')
    expect(readFileSync(p.settings, 'utf8')).toBe(before)
    expect(previewUninstall(p)).toMatchObject({ ok: true, changed: false, diff: '' })
  })

  it('creates settings.json when there is none, and reports a broken file without touching it', () => {
    const fresh = paths()
    expect(install(fresh, T)).toEqual({ ok: true })
    expect(hooksState(fresh, T).hooks).toBe('installed')

    const broken = paths('{ "model": ')
    expect(hooksState(broken, T)).toMatchObject({ hooks: 'error', hooksError: expect.stringContaining('not valid JSON') })
    expect(install(broken, T)).toMatchObject({ ok: false })
    expect(readFileSync(broken.settings, 'utf8')).toBe('{ "model": ')
  })

  it('surfaces conflicts that would stop our hooks from running', () => {
    const p = paths('{ "disableAllHooks": true }')
    expect(hooksState(p, T).conflicts).toEqual([expect.stringContaining('disableAllHooks')])
  })

  it('a file the planner cannot handle is an error state, not a crash, and is left alone', () => {
    const dup = '{ "hooks": {}, "hooks": [] }' // duplicate keys: jsonc sees the first, JSON.parse the last
    const p = paths(dup)
    expect(hooksState(p, T)).toMatchObject({ hooks: 'error' })
    expect(previewInstall(p, T)).toMatchObject({ ok: false })
    expect(install(p, T)).toMatchObject({ ok: false })
    expect(readFileSync(p.settings, 'utf8')).toBe(dup)
  })

  it('refuses a file that is not UTF-8 instead of rewriting its bytes', () => {
    const p = paths()
    mkdirSync(join(p.settings, '..'))
    const latin1 = Buffer.from('{ "name": "caf\xe9" }\n', 'latin1')
    writeFileSync(p.settings, latin1)
    expect(hooksState(p, T)).toMatchObject({ hooks: 'error', hooksError: expect.stringContaining('not UTF-8') })
    expect(install(p, T)).toMatchObject({ ok: false })
    expect(readFileSync(p.settings).equals(latin1)).toBe(true)
  })

  it('launch and quit reuse their two backups instead of piling up copies', () => {
    const p = paths(ORIGINAL)
    for (let i = 0; i < 3; i++) {
      expect(install(p, T)).toEqual({ ok: true })
      expect(uninstall(p)).toEqual({ ok: true })
    }
    const names = readdirSync(p.backups)
    expect(names).toHaveLength(2)
    expect(names.map((n) => readFileSync(join(p.backups, n), 'utf8'))).toContain(ORIGINAL)
  })
})
