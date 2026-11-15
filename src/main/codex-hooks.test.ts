import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CODEX,
  CODEX_EVENTS,
  codexCommand,
  codexHome,
  codexPaths,
  codexState,
  codexTarget,
  curlrcText,
  installCodex,
  isOurCodex,
  PARKED,
  parkCurlrc,
  previewCodex,
  uninstallCodex,
  type CodexPaths
} from './codex-hooks'
import { install as installClaude } from './hooks'
import { foreignUnchanged, inspect, planInstall, planUninstall } from './hooks-install'

const ENDPOINT = { port: 47821, token: 'c'.repeat(64) }

/** Hand-edited, like the files Codex users keep: foreign PreToolUse and PermissionRequest groups, a `description`, a curl of their own. */
const FOREIGN = [
  '{',
  '  "description": "my hooks",',
  '  "hooks": {',
  '    "PreToolUse": [',
  '      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "python3 ~/.codex/hooks/guard.py", "timeout": 10, "statusMessage": "Checking" }] }',
  '    ],',
  '    "PermissionRequest": [',
  '      { "matcher": "apply_patch", "hooks": [{ "type": "command", "command": "node C:/tools/approve.js" }] }',
  '    ],',
  '    "Stop": [{ "hooks": [{ "type": "command", "command": "curl -sf -K ~/.curlrc --data-binary @- https://example.com/hook" }] }]',
  '  }',
  '}'
]

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** A temp Codex home (made unless `codex` is false) and userData; `hooks` seeds hooks.json. */
function setup(hooks?: string, codex = true): CodexPaths {
  const root = mkdtempSync(join(tmpdir(), 'agentdeck-codex-'))
  dirs.push(root)
  const p = codexPaths({ CODEX_HOME: join(root, 'codex') }, root, join(root, 'userData'))
  if (codex) mkdirSync(p.home)
  if (hooks !== undefined) writeFileSync(p.settings, hooks)
  return p
}

const target = (p: CodexPaths) => codexTarget(p, 'win32')
const groups = (text: string) => (JSON.parse(text.replace(/^\uFEFF/, '')) as { hooks: Record<string, { hooks: Record<string, unknown>[] }[]> }).hooks

describe('where Codex keeps hooks.json', () => {
  it('uses CODEX_HOME when set, else <home>/.codex', () => {
    expect(codexHome({ CODEX_HOME: join('D:', 'cx') }, join('C:', 'home'))).toBe(join('D:', 'cx'))
    expect(codexHome({}, join('C:', 'home'))).toBe(join('C:', 'home', '.codex'))
    expect(codexPaths({}, join('C:', 'home'), join('C:', 'ud'))).toEqual({
      home: join('C:', 'home', '.codex'),
      settings: join('C:', 'home', '.codex', 'hooks.json'),
      backups: join('C:', 'ud', 'backups'),
      curlrc: join('C:', 'ud', 'hooks', 'codex.curlrc')
    })
  })
})

describe('commands (their text is what Codex trusts: it must never change between runs)', () => {
  const WIN = { curlrc: 'C:\\Users\\dev\\AppData\\Roaming\\AgentDeck\\hooks\\codex.curlrc', platform: 'win32' as const }
  const MAC = { curlrc: '/Users/dev/Library/Application Support/AgentDeck/hooks/codex.curlrc', platform: 'darwin' as const }

  it('are exactly these on Windows', () => {
    const curl = "& (Join-Path $env:SystemRoot 'System32\\curl.exe') -sf --connect-timeout 0.3 -m 3 -K 'C:/Users/dev/AppData/Roaming/AgentDeck/hooks/codex.curlrc'"
    expect(codexCommand('Stop', WIN)).toBe(`${curl} --data-binary '@-'; exit 0`)
    expect(codexCommand('SessionStart', WIN)).toBe(
      `$p = (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $PID)).ParentProcessId; ${curl} -H ('X-AgentDeck-Pid: ' + $p) --data-binary '@-'; exit 0`
    )
  })

  it('are exactly these on macOS and Linux', () => {
    const rc = "'/Users/dev/Library/Application Support/AgentDeck/hooks/codex.curlrc'"
    expect(codexCommand('Stop', MAC)).toBe(`/usr/bin/curl -sf --connect-timeout 0.3 -m 3 -K ${rc} --data-binary @-; exit 0`)
    expect(codexCommand('SessionStart', MAC)).toBe(`/usr/bin/curl -sf --connect-timeout 0.3 -m 3 -K ${rc} -H "X-AgentDeck-Pid: $PPID" --data-binary @-; exit 0`)
    expect(codexCommand('Stop', { ...MAC, platform: 'linux' })).toBe(`curl -sf --connect-timeout 0.3 -m 3 -K ${rc} --data-binary @-; exit 0`)
  })

  it('never hold the port or the token, and never a double quote on Windows', () => {
    for (const e of CODEX_EVENTS) {
      const c = codexCommand(e, WIN)
      expect(c).not.toContain('47821')
      expect(c).not.toContain('"')
      expect(c.endsWith('; exit 0')).toBe(true)
    }
  })

  it('quote a path with a space and an apostrophe for PowerShell and for sh, and still read as ours', () => {
    const win = codexCommand('Stop', { curlrc: "C:\\Users\\Ann O'Neil\\AppData\\Roaming\\AgentDeck\\hooks\\codex.curlrc", platform: 'win32' })
    expect(win).toContain(" -K 'C:/Users/Ann O''Neil/AppData/Roaming/AgentDeck/hooks/codex.curlrc' ")
    const sh = codexCommand('SessionStart', { curlrc: "/home/ann o'neil/.config/AgentDeck/hooks/codex.curlrc", platform: 'linux' })
    expect(sh).toContain(" -K '/home/ann o'\\''neil/.config/AgentDeck/hooks/codex.curlrc' ")
    for (const command of [win, sh]) expect(isOurCodex({ type: 'command', command })).toBe(true)
  })

  it('run async except PermissionRequest (held later) and SessionEnd (Codex runs it sync); SessionEnd and Interrupt get 3 s', () => {
    const group = (e: string) => CODEX.group(e, WIN).hooks as Record<string, unknown>[]
    expect(group('PermissionRequest')).toEqual([{ type: 'command', command: codexCommand('PermissionRequest', WIN), timeout: 5 }])
    expect(group('SessionEnd')).toEqual([{ type: 'command', command: codexCommand('SessionEnd', WIN), timeout: 3 }])
    expect(group('Interrupt')[0]).toMatchObject({ timeout: 3, async: true })
    expect(group('Stop')[0]).toMatchObject({ timeout: 5, async: true })
    expect(CODEX.group('Stop', WIN)).not.toHaveProperty('matcher')
  })
})

describe('isOurCodex', () => {
  it('never takes a foreign command for ours', () => {
    const foreign = [
      { type: 'command', command: 'python3 ~/.codex/hooks/guard.py' },
      { type: 'command', command: 'curl -sf -K ~/.curlrc --data-binary @- https://example.com' },
      { type: 'command', command: "curl -K '/x/hooks/codex.curlrc.bak' --data-binary @-" },
      { type: 'command', command: "curl -K '/x/myhooks/codex.curlrc' --data-binary @-" },
      { type: 'command', command: 'cat /x/hooks/codex.curlrc; exit 0' },
      { type: 'command', command: "curl --config '/x/hooks/codex.curlrc' --data-binary @-" },
      { type: 'prompt', command: codexCommand('Stop', { curlrc: '/x/hooks/codex.curlrc', platform: 'linux' }) },
      { type: 'http', url: 'http://127.0.0.1:47821/hooks', headers: { 'X-AgentDeck-Token': 'x' } },
      { type: 'command' },
      null,
      'x'
    ]
    for (const entry of foreign) expect(isOurCodex(entry)).toBe(false)
    expect(isOurCodex({ type: 'command', command: codexCommand('Stop', { curlrc: '/x/hooks/codex.curlrc', platform: 'linux' }) })).toBe(true)
  })
})

describe('curlrc', () => {
  it('names the collector and the token, and nothing else', () => {
    expect(curlrcText(47821, 'ab12')).toBe('url = "http://127.0.0.1:47821/hooks/codex"\nheader = "X-AgentDeck-Token: ab12"\nheader = "Content-Type: application/json"\n')
  })
  it('is parked on quit: no token, a port nothing listens on, and only when it exists', async () => {
    const p = setup()
    parkCurlrc(p.curlrc)
    expect(existsSync(p.curlrc)).toBe(false) // never installed: nothing to park
    await installCodex(p, target(p), ENDPOINT)
    parkCurlrc(p.curlrc)
    expect(readFileSync(p.curlrc, 'utf8')).toBe(PARKED)
    expect(PARKED).not.toContain('Token')
  })
})

describe('install and uninstall (acceptance: foreign hooks stay byte for byte)', () => {
  it.each([
    ['LF', FOREIGN.join('\n') + '\n'],
    ['CRLF, no trailing newline', FOREIGN.join('\r\n')],
    ['BOM and CRLF', `\uFEFF${FOREIGN.join('\r\n')}\r\n`]
  ])('%s: install → installed → uninstall restores the exact bytes, with the curlrc written and then deleted', async (_, original) => {
    const p = setup(original)
    expect(codexState(p, target(p))).toEqual({ state: 'missing', error: null, home: p.home })

    expect(await installCodex(p, target(p), ENDPOINT)).toEqual({ ok: true })
    const after = readFileSync(p.settings, 'utf8')
    expect(codexState(p, target(p)).state).toBe('installed')
    expect(readFileSync(p.curlrc, 'utf8')).toBe(curlrcText(ENDPOINT.port, ENDPOINT.token))
    if (process.platform !== 'win32') expect(statSync(p.curlrc).mode & 0o777).toBe(0o600)
    expect(after.startsWith('\uFEFF')).toBe(original.startsWith('\uFEFF'))
    expect(foreignUnchanged(original, after, CODEX)).toBe(true)
    expect(after).not.toContain(ENDPOINT.token)
    const hooks = groups(after)
    expect(Object.keys(hooks)).toEqual(['PreToolUse', 'PermissionRequest', 'Stop', ...CODEX_EVENTS.filter((e) => !['PreToolUse', 'PermissionRequest', 'Stop'].includes(e))])
    expect(hooks.PermissionRequest).toHaveLength(2) // the user's group first, ours after it

    expect(await installCodex(p, target(p), ENDPOINT)).toEqual({ ok: true }) // idempotent
    expect(readFileSync(p.settings, 'utf8')).toBe(after)

    expect(uninstallCodex(p)).toEqual({ ok: true })
    expect(readFileSync(p.settings, 'utf8')).toBe(original)
    expect(existsSync(p.curlrc)).toBe(false)
    expect(codexState(p, target(p)).state).toBe('missing')
  })

  it('creates hooks.json in an existing Codex folder; uninstall leaves `{}` and the curlrc gone', async () => {
    const p = setup()
    expect(await installCodex(p, target(p), ENDPOINT)).toEqual({ ok: true })
    expect(Object.keys(groups(readFileSync(p.settings, 'utf8')))).toEqual(CODEX_EVENTS)
    expect(uninstallCodex(p)).toEqual({ ok: true })
    expect(readFileSync(p.settings, 'utf8')).toBe('{}\n')
  })

  it('reads as installed when a group was added after ours, and as missing when ours point at another curlrc', () => {
    const p = setup()
    const t = target(p)
    const installed = (planInstall(FOREIGN.join('\n'), t, CODEX) as { after: string }).after
    const later = JSON.parse(installed) as { hooks: Record<string, unknown[]> }
    later.hooks.Stop!.push({ hooks: [{ type: 'command', command: 'echo later' }] })
    expect(inspect(JSON.stringify(later), t, CODEX)).toMatchObject({ installed: true })
    expect(inspect(installed, { ...t, curlrc: join(p.home, 'elsewhere', 'hooks', 'codex.curlrc') }, CODEX)).toMatchObject({ installed: false })
    expect(inspect(installed, { ...t, platform: 'linux' }, CODEX)).toMatchObject({ installed: false })
    expect((planUninstall(installed, CODEX) as { after: string }).after).toBe(FOREIGN.join('\n'))
  })

  it('without a Codex folder: says so, previews and installs nothing, and the uninstaller step changes nothing', async () => {
    const p = setup(undefined, false)
    expect(codexState(p, target(p))).toEqual({ state: 'absent', error: null, home: p.home })
    expect(previewCodex(p, true, target(p))).toMatchObject({ ok: false, error: expect.stringContaining('no Codex CLI folder') })
    expect(await installCodex(p, target(p), ENDPOINT)).toMatchObject({ ok: false })
    expect(uninstallCodex(p)).toEqual({ ok: true })
    expect(existsSync(p.home)).toBe(false)
    expect(existsSync(p.curlrc)).toBe(false)
  })

  it('a broken hooks.json is an error state naming hooks.json, and is left alone', async () => {
    const p = setup('{ "hooks": ')
    expect(codexState(p, target(p))).toMatchObject({ state: 'error', error: expect.stringContaining('hooks.json is not valid JSON') })
    expect(await installCodex(p, target(p), ENDPOINT)).toMatchObject({ ok: false })
    expect(uninstallCodex(p)).toMatchObject({ ok: false })
    expect(readFileSync(p.settings, 'utf8')).toBe('{ "hooks": ')
    expect(existsSync(p.curlrc)).toBe(false) // our commands then post nothing
  })
})

describe('preview', () => {
  it('names hooks.json, shows our commands, hides every foreign value, and writes nothing', () => {
    const p = setup(FOREIGN.join('\n'))
    const pre = previewCodex(p, true, target(p))
    if (!pre.ok) throw new Error(pre.error)
    expect(pre).toMatchObject({ changed: true, path: p.settings, backups: p.backups })
    expect(pre.diff.split('\n').slice(0, 2)).toEqual(['--- hooks.json', '+++ hooks.json (after)'])
    expect(pre.diff).toContain(JSON.stringify(codexCommand('Stop', target(p))))
    expect(pre.diff).toContain('"type": "command"')
    expect(pre.diff).not.toContain('guard.py')
    expect(pre.diff).not.toContain('my hooks')
    expect(readFileSync(p.settings, 'utf8')).toBe(FOREIGN.join('\n'))
    expect(previewCodex(p, false, target(p))).toMatchObject({ ok: true, changed: false, diff: '' })
  })
})

describe('backups', () => {
  it("keep their own names, so Codex's and Claude's 20 never evict each other", async () => {
    const p = setup(FOREIGN.join('\n'))
    mkdirSync(p.backups, { recursive: true })
    for (let i = 0; i < 20; i++) writeFileSync(join(p.backups, `settings-20200101-000000-${String(i).padStart(3, '0')}.json`), '{}')
    expect(await installCodex(p, target(p), ENDPOINT)).toEqual({ ok: true })
    const names = readdirSync(p.backups)
    expect(names.filter((n) => n.startsWith('settings-'))).toHaveLength(20)
    expect(names.filter((n) => /^codex-hooks-\d{8}-\d{6}-\d{3}\.json$/.test(n))).toHaveLength(1)

    const settings = join(p.home, '..', 'settings.json')
    writeFileSync(settings, '{ "model": "opus" }')
    expect(installClaude({ settings, backups: p.backups }, { port: 47821, token: 't' })).toEqual({ ok: true })
    expect(readdirSync(p.backups).filter((n) => n.startsWith('codex-hooks-'))).toHaveLength(1)
  })
})
