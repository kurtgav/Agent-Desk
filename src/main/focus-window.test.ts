import { describe, expect, it, vi } from 'vitest'
import type { run } from '../collector/cli'
import { focusWindowOf, macAppOf, parseFocus } from './focus-window'

type Run = typeof run
const ran = (stdout: string, code = 0): Run => vi.fn(async () => ({ code, stdout, stderr: '' })) as unknown as Run

describe('parseFocus', () => {
  it('reads what the script said, and nothing else', () => {
    expect(parseFocus('OK WindowsTerminal\r\n')).toEqual({ ok: true, app: 'WindowsTerminal' })
    expect(parseFocus('FOUND warp')).toEqual({ ok: true, app: 'warp' })
    expect(parseFocus('NOWINDOW\n')).toEqual({ ok: false, reason: 'no-window' })
    expect(parseFocus('')).toEqual({ ok: false, reason: 'failed' })
    expect(parseFocus('Exception calling "Add-Type"')).toEqual({ ok: false, reason: 'failed' })
  })
})

describe('focusWindowOf', () => {
  it('passes the pid as an integer in the environment, never inside the script', async () => {
    const exec = ran('OK Code')
    expect(await focusWindowOf(4242, exec, false, 'win32')).toEqual({ ok: true, app: 'Code' })
    const [file, args, timeout, env] = (exec as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string[], number, NodeJS.ProcessEnv]
    expect(file.toLowerCase()).toContain('powershell.exe')
    expect(args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy'])
    expect(args.join(' ')).not.toContain('4242')
    expect(env.AGENTDECK_PID).toBe('4242')
    expect(env.AGENTDECK_FOCUS_DRY).toBeUndefined()
    expect(timeout).toBeGreaterThan(0)
  })

  it('a dry run only finds the window', async () => {
    const exec = ran('FOUND warp')
    expect(await focusWindowOf(7, exec, true, 'win32')).toEqual({ ok: true, app: 'warp' })
    expect(((exec as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string[], number, NodeJS.ProcessEnv])[3].AGENTDECK_FOCUS_DRY).toBe('1')
  })

  it('refuses a pid that is not a positive whole number without starting anything', async () => {
    const exec = ran('OK x')
    for (const bad of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) expect(await focusWindowOf(bad, exec)).toEqual({ ok: false, reason: 'failed' })
    expect(exec).not.toHaveBeenCalled()
  })

  it('says no window when the script found none', async () => {
    expect(await focusWindowOf(9, ran('NOWINDOW', 3), false, 'win32')).toEqual({ ok: false, reason: 'no-window' })
  })
})

describe('macOS (ps + open -a)', () => {
  // pid ppid comm, as `ps -axo pid=,ppid=,comm=` prints it.
  const PS = [
    '    1     0 /sbin/launchd',
    '  500     1 /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal',
    '  510   500 /usr/bin/login',
    '  511   510 -zsh',
    '  520   511 /Users/me/.local/bin/claude',
    '  600     1 /Applications/Visual Studio Code.app/Contents/MacOS/Electron',
    '  610   600 /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)',
    '  620   610 /Users/me/.vscode/extensions/anthropic.claude-code-2.1.0-darwin-arm64/resources/native-binary/claude',
    '  700     1 /usr/sbin/sshd',
    '  710   700 /Users/me/.local/bin/claude'
  ].join('\n')

  it('walks up to the app the session runs under, the outermost bundle', () => {
    expect(macAppOf(PS, 520)).toBe('/System/Applications/Utilities/Terminal.app')
    expect(macAppOf(PS, 620)).toBe('/Applications/Visual Studio Code.app')
  })

  it('finds none under ssh, or for a pid ps does not list', () => {
    expect(macAppOf(PS, 710)).toBeNull()
    expect(macAppOf(PS, 999)).toBeNull()
  })

  it('stops on a parent loop instead of spinning', () => {
    expect(macAppOf('  5   6 /bin/a\n  6   5 /bin/b\n', 5)).toBeNull()
  })

  it('activates that app with open -a, the bundle path as one argument', async () => {
    const exec = vi.fn(async (file: string) => ({ code: 0, stdout: file === '/bin/ps' ? PS : '', stderr: '' })) as unknown as Run
    expect(await focusWindowOf(520, exec, false, 'darwin')).toEqual({ ok: true, app: 'Terminal' })
    const calls = (exec as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => [c[0], c[1]])
    expect(calls).toEqual([['/bin/ps', ['-axo', 'pid=,ppid=,comm=']], ['/usr/bin/open', ['-a', '/System/Applications/Utilities/Terminal.app']]])
  })

  it('a dry run only names the app; no app, or a failed ps or open, is said as such', async () => {
    const exec = vi.fn(async () => ({ code: 0, stdout: PS, stderr: '' })) as unknown as Run
    expect(await focusWindowOf(620, exec, true, 'darwin')).toEqual({ ok: true, app: 'Visual Studio Code' })
    expect(exec).toHaveBeenCalledTimes(1)
    expect(await focusWindowOf(710, exec, false, 'darwin')).toEqual({ ok: false, reason: 'no-window' })
    expect(await focusWindowOf(520, ran('', 1), false, 'darwin')).toEqual({ ok: false, reason: 'failed' })
    const openFails = vi.fn(async (file: string) => ({ code: file === '/bin/ps' ? 0 : 1, stdout: PS, stderr: '' })) as unknown as Run
    expect(await focusWindowOf(520, openFails, false, 'darwin')).toEqual({ ok: false, reason: 'failed' })
  })
})
