import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LIMITS_FILE, PREVIOUS_FILE, PREVIOUS_PS1, PREVIOUS_SH, scriptPath, statusLineCommand } from './claude-statusline'
import {
  inspectStatusLine, planStatusLineOff, planStatusLineOn, previewStatusLine, removeStatusLine, setStatusLine, statusLineState
} from './claude-statusline-install'
import type { HookPaths } from './hooks'
import { foreignUnchanged } from './hooks-install'

const PLATFORM = 'win32'
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
/** A temp config dir and a temp AgentDeck data folder: the real ~/.claude is never written by a test. */
function temp(settings?: string): { paths: HookPaths; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'agentdeck-statusline-install-'))
  dirs.push(root)
  const file = join(root, 'settings.json')
  if (settings !== undefined) writeFileSync(file, settings)
  return { paths: { settings: file, backups: join(root, 'backups') }, dir: join(root, 'Agent Deck', 'statusline') }
}
const read = (p: HookPaths): string => readFileSync(p.settings, 'utf8')
const after = (p: ReturnType<typeof planStatusLineOn>): string => {
  if (!p.ok) throw new Error(p.error)
  return p.after
}

const MINE = { type: 'command', command: 'bash ~/.claude/statusline.sh', padding: 2 }
const WITH_MINE = `{\n  "model": "opus",\n  "statusLine": {\n    "type": "command",\n    "command": "bash ~/.claude/statusline.sh",\n    "padding": 2\n  },\n  "theme": "dark"\n}\n`
const CMD = statusLineCommand('C:\\Users\\Kurt Gavin\\AppData\\Roaming\\AgentDeck\\statusline', PLATFORM)

describe('planning the status line (ADR-0009 amendment)', () => {
  it("adds ours at the end of the root when there is none, in the file's own style", () => {
    const text = '{\r\n    "model": "opus"\r\n}\r\n'
    const out = after(planStatusLineOn(text, CMD))
    expect(JSON.parse(out)).toEqual({ model: 'opus', statusLine: { type: 'command', command: CMD, refreshInterval: 60 } })
    expect(out).toContain('\r\n    "statusLine": {\r\n        "type": "command",')
    expect(out.replaceAll('\r\n', '')).not.toContain('\n')
    expect(after(planStatusLineOn(null, CMD))).toContain('"statusLine"')
  })

  it("replaces the user's own in place, keeping their keys, and puts it back exactly", () => {
    const on = after(planStatusLineOn(WITH_MINE, CMD))
    const root = JSON.parse(on) as Record<string, unknown>
    expect(Object.keys(root)).toEqual(['model', 'statusLine', 'theme'])
    expect(root.statusLine).toEqual({ type: 'command', command: CMD, padding: 2, refreshInterval: 60 })
    expect(after(planStatusLineOff(on, MINE))).toBe(WITH_MINE)
  })

  it('removes ours when the user had none, byte for byte', () => {
    const text = '{\n  "model": "opus"\n}\n'
    expect(after(planStatusLineOff(after(planStatusLineOn(text, CMD)), null))).toBe(text)
  })

  it('leaves a status line the user set since alone', () => {
    const p = planStatusLineOff(WITH_MINE, { type: 'command', command: 'old' })
    expect(p.ok && p.changed).toBe(false)
  })

  it('says when Claude Code would show no status line at all', () => {
    const p = planStatusLineOn('{ "disableAllHooks": true }', CMD)
    expect(p.ok && p.conflicts).toEqual([expect.stringMatching(/disableAllHooks/)])
  })

  it('reads the states', () => {
    const on = after(planStatusLineOn(WITH_MINE, CMD))
    expect(inspectStatusLine('{}', CMD, true)).toEqual({ ok: true, state: 'off' })
    expect(inspectStatusLine(WITH_MINE, CMD, true)).toEqual({ ok: true, state: 'elsewhere' })
    expect(inspectStatusLine(on, CMD, true)).toEqual({ ok: true, state: 'on' })
    expect(inspectStatusLine(on, CMD, false)).toEqual({ ok: true, state: 'stale' })
    expect(inspectStatusLine(on, statusLineCommand('D:\\elsewhere', PLATFORM), true)).toEqual({ ok: true, state: 'stale' })
    expect(inspectStatusLine('{ nope', CMD, true).ok).toBe(false)
  })
})

describe('the settings writer lets only our status line change', () => {
  it('accepts swapping the status line for ours and back, and nothing else', () => {
    const on = after(planStatusLineOn(WITH_MINE, CMD))
    expect(foreignUnchanged(WITH_MINE, on)).toBe(true)
    expect(foreignUnchanged(on, WITH_MINE)).toBe(true)
    expect(foreignUnchanged(WITH_MINE, on.replace('"dark"', '"light"'))).toBe(false)
    // Neither side ours: a changed status line is the user's, and a write that did it is caught.
    expect(foreignUnchanged(WITH_MINE, WITH_MINE.replace('padding": 2', 'padding": 3'))).toBe(false)
  })
})

describe('turning it on and off on disk', () => {
  it("saves the user's status line, writes our script and their command, then restores it all", () => {
    const { paths, dir } = temp(WITH_MINE)
    expect(statusLineState(paths, dir, PLATFORM)).toBe('elsewhere')
    const preview = previewStatusLine(paths, dir, true, PLATFORM)
    expect(preview.ok && preview.changed).toBe(true)
    expect(preview.ok && preview.diff).toContain('"type": "command"')
    expect(read(paths)).toBe(WITH_MINE) // a preview writes nothing

    expect(setStatusLine(paths, dir, true, PLATFORM)).toEqual({ ok: true })
    expect(statusLineState(paths, dir, PLATFORM)).toBe('on')
    expect(JSON.parse(read(paths)).statusLine.command).toBe(statusLineCommand(dir, PLATFORM))
    expect(JSON.parse(readFileSync(join(dir, PREVIOUS_FILE), 'utf8'))).toEqual({ statusLine: MINE })
    expect(readFileSync(join(dir, PREVIOUS_SH), 'utf8')).toBe('bash ~/.claude/statusline.sh\n')
    expect(readFileSync(join(dir, PREVIOUS_PS1), 'utf8')).toBe('\uFEFFbash ~/.claude/statusline.sh\r\n')
    expect(readFileSync(scriptPath(dir, PLATFORM), 'utf8')).toContain('rate_limits')

    // On again (or repairing a stale one) keeps the user's saved status line, not ours.
    rmSync(scriptPath(dir, PLATFORM))
    expect(statusLineState(paths, dir, PLATFORM)).toBe('stale')
    expect(setStatusLine(paths, dir, true, PLATFORM)).toEqual({ ok: true })
    expect(statusLineState(paths, dir, PLATFORM)).toBe('on')
    expect(JSON.parse(readFileSync(join(dir, PREVIOUS_FILE), 'utf8'))).toEqual({ statusLine: MINE })

    writeFileSync(join(dir, LIMITS_FILE), '{}')
    expect(setStatusLine(paths, dir, false, PLATFORM)).toEqual({ ok: true })
    expect(read(paths)).toBe(WITH_MINE)
    expect(existsSync(join(dir, LIMITS_FILE))).toBe(false)
    expect(statusLineState(paths, dir, PLATFORM)).toBe('elsewhere')
  })

  it('with no status line before: none after, and no previous command to run', () => {
    const text = '{\n  "model": "opus"\n}\n'
    const { paths, dir } = temp(text)
    expect(setStatusLine(paths, dir, true, PLATFORM)).toEqual({ ok: true })
    expect(existsSync(join(dir, PREVIOUS_SH))).toBe(false)
    expect(JSON.parse(readFileSync(join(dir, PREVIOUS_FILE), 'utf8'))).toEqual({ statusLine: null })
    expect(removeStatusLine(paths, dir)).toEqual({ ok: true })
    expect(read(paths)).toBe(text)
  })

  it('turning off after the user replaced ours changes nothing and keeps theirs', () => {
    const { paths, dir } = temp('{}')
    expect(setStatusLine(paths, dir, true, PLATFORM)).toEqual({ ok: true })
    writeFileSync(paths.settings, WITH_MINE)
    const preview = previewStatusLine(paths, dir, false, PLATFORM)
    expect(preview.ok && preview.changed).toBe(false)
    expect(setStatusLine(paths, dir, false, PLATFORM)).toEqual({ ok: true })
    expect(read(paths)).toBe(WITH_MINE)
  })

  it('refuses a settings.json it cannot read, and a previous.json it did not write, without touching anything', () => {
    const broken = temp('{ "statusLine": ')
    expect(setStatusLine(broken.paths, broken.dir, true, PLATFORM).ok).toBe(false)
    expect(read(broken.paths)).toBe('{ "statusLine": ')
    expect(statusLineState(broken.paths, broken.dir, PLATFORM)).toBe('off')

    const { paths, dir } = temp('{}')
    expect(setStatusLine(paths, dir, true, PLATFORM)).toEqual({ ok: true })
    const on = read(paths)
    writeFileSync(join(dir, PREVIOUS_FILE), '[1]')
    expect(setStatusLine(paths, dir, false, PLATFORM)).toEqual({ ok: false, error: expect.stringMatching(/not what AgentDeck wrote/) })
    expect(read(paths)).toBe(on)
  })

  it('the uninstaller step is a no-op without a settings file', () => {
    const { paths, dir } = temp()
    expect(removeStatusLine(paths, dir)).toEqual({ ok: true })
    expect(existsSync(paths.settings)).toBe(false)
  })
})
