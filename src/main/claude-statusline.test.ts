import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LIMITS_FILE, PREVIOUS_PS1, PREVIOUS_SH, isOurStatusLine, ourStatusLine, powershellScript, previousCommand, scriptPath, shQuote, shScript, statusLineCommand,
  statusLineScript
} from './claude-statusline'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
/** A temp folder whose name has a space and an apostrophe, like C:\Users\O'Brien\AppData\Roaming\Agent Deck. */
function temp(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'agentdeck-statusline-')), "Agent Deck's data")
  dirs.push(join(dir, '..'))
  mkdirSync(dir, { recursive: true })
  return dir
}

const INPUT = JSON.stringify({
  session_id: 'abc',
  cwd: 'D:\\work',
  model: { id: 'claude-opus-5-5', display_name: 'Opus' },
  rate_limits: { five_hour: { used_percentage: 16, resets_at: 1_763_215_800 }, seven_day: { used_percentage: 23, resets_at: 1_763_665_200 } }
})

describe('the status line command (ADR-0009 amendment)', () => {
  it('runs our PowerShell script on Windows, forward slashes, quoted for Git Bash and PowerShell alike', () => {
    expect(statusLineCommand('C:\\Users\\Kurt Gavin\\AppData\\Roaming\\AgentDeck\\statusline', 'win32')).toBe(
      'powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Users/Kurt Gavin/AppData/Roaming/AgentDeck/statusline/agentdeck-statusline.ps1"'
    )
    // An apostrophe is fine inside double quotes in both shells.
    expect(statusLineCommand("C:\\Users\\O'Brien\\AgentDeck", 'win32')).toContain(`-File "C:/Users/O'Brien/AgentDeck/agentdeck-statusline.ps1"`)
    // `$` and a backtick are special inside double quotes in both, so single quotes.
    expect(statusLineCommand('C:\\Users\\a$b\\AgentDeck', 'win32')).toContain(`-File 'C:/Users/a$b/AgentDeck/agentdeck-statusline.ps1'`)
    expect(() => statusLineCommand("C:\\Users\\a$b'c\\AgentDeck", 'win32')).toThrow(/cannot quote/)
  })

  it('runs our sh script on macOS and Linux, single-quoted', () => {
    expect(statusLineCommand('/Users/kurt/Library/Application Support/AgentDeck/statusline', 'darwin')).toBe(
      "sh '/Users/kurt/Library/Application Support/AgentDeck/statusline/agentdeck-statusline.sh'"
    )
    expect(shQuote("it's")).toBe(`'it'\\''s'`)
  })

  it('knows its own entry by the script name, wherever the folder is', () => {
    expect(isOurStatusLine({ type: 'command', command: statusLineCommand('D:\\x', 'win32') })).toBe(true)
    expect(isOurStatusLine({ type: 'command', command: statusLineCommand('/x', 'linux') })).toBe(true)
    expect(isOurStatusLine({ type: 'command', command: 'bash ~/.claude/statusline.sh' })).toBe(false)
    expect(isOurStatusLine({ type: 'other', command: statusLineCommand('/x', 'linux') })).toBe(false)
    expect(isOurStatusLine(undefined)).toBe(false)
  })

  it("keeps the user's own keys, and a shorter refresh interval than ours", () => {
    expect(ourStatusLine({ type: 'command', command: 'mine', padding: 2, hideVimModeIndicator: true }, 'ours')).toEqual({
      type: 'command',
      command: 'ours',
      padding: 2,
      hideVimModeIndicator: true,
      refreshInterval: 60
    })
    expect(ourStatusLine({ type: 'command', command: 'mine', refreshInterval: 5 }, 'ours').refreshInterval).toBe(5)
    expect(ourStatusLine({ type: 'command', command: 'mine', refreshInterval: 300 }, 'ours').refreshInterval).toBe(60)
    expect(ourStatusLine(undefined, 'ours')).toEqual({ type: 'command', command: 'ours', refreshInterval: 60 })
  })

  it("runs the user's previous command only when there was one", () => {
    expect(previousCommand({ type: 'command', command: 'bash ~/x.sh' })).toBe('bash ~/x.sh')
    expect(previousCommand({ type: 'command', command: '  ' })).toBeNull()
    expect(previousCommand(null)).toBeNull()
  })
})

describe('the scripts', () => {
  it('embed the folder as a literal each shell reads back exactly', () => {
    const ps = powershellScript("C:\\Users\\O'Brien\u2019s\\Agent Deck")
    expect(ps.startsWith('\uFEFF')).toBe(true) // Windows PowerShell 5.1 reads a BOM-less script as ANSI
    expect(ps).toContain("$dir = 'C:\\Users\\O''Brien\u2019\u2019s\\Agent Deck'")
    expect(ps).toContain("'bin\\bash.exe'")
    expect(ps).toContain("-replace '\\\\', '/'")
    expect(ps).toContain('-join "`n"')
    expect(ps.trimEnd().endsWith('exit 0')).toBe(true)
    const sh = shScript("/Users/o'brien/Agent Deck")
    expect(sh).toContain(`dir='/Users/o'\\''brien/Agent Deck'`)
    expect(sh.trimEnd().endsWith('exit 0')).toBe(true)
    for (const text of [ps, sh]) expect(text).not.toMatch(/\$\{|undefined/)
  })

  // A real run where the shell exists: it saves the limits and prints the user's own status line.
  const hasSh = spawnSync('sh', ['-c', 'exit 0']).status === 0
  it.runIf(hasSh)('sh: saves the input that holds rate_limits, then prints what the previous command prints', () => {
    const dir = temp()
    writeFileSync(scriptPath(dir, 'linux'), statusLineScript(dir, 'linux'))
    writeFileSync(join(dir, PREVIOUS_SH), 'cat >/dev/null; printf "mine"\n')
    const r = spawnSync('sh', ['-c', statusLineCommand(dir, 'linux')], { input: INPUT, encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('mine')
    expect(JSON.parse(readFileSync(join(dir, LIMITS_FILE), 'utf8')).rate_limits.five_hour.used_percentage).toBe(16)
    // No rate_limits yet (a fresh session): the last figures stay; no previous command: it prints nothing and still exits 0.
    rmSync(join(dir, PREVIOUS_SH))
    const quiet = spawnSync('sh', ['-c', statusLineCommand(dir, 'linux')], { input: '{"session_id":"new"}', encoding: 'utf8' })
    expect([quiet.status, quiet.stdout]).toEqual([0, ''])
    expect(readFileSync(join(dir, LIMITS_FILE), 'utf8')).toContain('rate_limits')
  })

  it.runIf(process.platform === 'win32')(
    'PowerShell: saves rate_limits alone, then prints what the previous command prints, through the command Claude Code runs',
    () => {
      const dir = temp()
      writeFileSync(scriptPath(dir, 'win32'), statusLineScript(dir, 'win32'))
      // One line both Git Bash and PowerShell run the same way.
      writeFileSync(join(dir, PREVIOUS_SH), 'echo mine\n')
      writeFileSync(join(dir, PREVIOUS_PS1), '\uFEFFecho mine\r\n')
      const r = spawnSync('powershell', ['-NoProfile', '-Command', statusLineCommand(dir, 'win32')], { input: INPUT, encoding: 'utf8' })
      expect(r.status).toBe(0)
      expect(r.stdout.trim()).toBe('mine')
      expect(JSON.parse(readFileSync(join(dir, LIMITS_FILE), 'utf8'))).toEqual({
        five_hour: { used_percentage: 16, resets_at: 1_763_215_800 },
        seven_day: { used_percentage: 23, resets_at: 1_763_665_200 }
      })
      // Garbage in: no throw, no output, exit 0, the last figures stay.
      rmSync(join(dir, PREVIOUS_SH))
      const bad = spawnSync('powershell', ['-NoProfile', '-Command', statusLineCommand(dir, 'win32')], { input: 'not json', encoding: 'utf8' })
      expect([bad.status, bad.stdout]).toEqual([0, ''])
      expect(readFileSync(join(dir, LIMITS_FILE), 'utf8')).toContain('five_hour')
    },
    30_000
  )
})
