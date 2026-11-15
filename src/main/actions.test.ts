import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOT_DELETABLE } from '@shared/session-meta'
import type { Session } from '@shared/snapshot'
import { launch, run, which } from '../collector/cli'
import { act, codeCandidates, cursorCandidates, deleteBackground, findCursor, focusTerminal, localPathRe, logs, macTerminalArgs, openFile, runClaudeIn, runnable, shQuote, stripAnsi, type ActionDeps } from './actions'

// Nothing here starts a real program: launch, run and which are fakes; cleanEnv and system32 are the real ones.
vi.mock('../collector/cli', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../collector/cli')>()),
  which: vi.fn(async (): Promise<string[]> => []),
  launch: vi.fn(async (): Promise<string | null> => null),
  run: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }))
}))

const CLAUDE = 'C:\\Users\\me\\.local\\bin\\claude.exe'
const dir = mkdtempSync(join(tmpdir(), 'agentdeck-act-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
beforeEach(() => vi.clearAllMocks())

const session = (over: Partial<Session> = {}): Session => ({
  id: '0b6e0d55-7c2e-4a39-9d0a-5d6a1f2c3b4e',
  bgId: null,
  name: 'billing-api',
  cwd: 'D:\\no\\such\\folder',
  surface: 'cli',
  status: 'working',
  startedAt: 0,
  lastEventAt: 0,
  activity: 'Idle',
  plan: null,
  waitingSince: null,
  subagents: [],
  ...over
})

const deps = (claude: string | null = null): ActionDeps & { copied: string[] } => {
  const copied: string[] = []
  // The Windows launchers unless a test says otherwise, so these run the same on a Mac.
  return { claude: vi.fn(async () => claude), copy: (t) => copied.push(t), copied, platform: 'win32' }
}

describe('session actions (UI_MAP § Session drawer)', () => {
  it('copies the resume command for the session id', async () => {
    const d = deps()
    expect(await act('copy-resume', session(), d)).toEqual({ ok: true })
    expect(d.copied).toEqual(['claude --resume 0b6e0d55-7c2e-4a39-9d0a-5d6a1f2c3b4e'])
  })

  it('refuses Attach, Stop and logs for a session that is not a background one, without running anything', async () => {
    const d = deps(CLAUDE)
    expect(await act('attach', session(), d)).toMatchObject({ ok: false, error: expect.stringMatching(/background/) })
    expect(await act('stop', session(), d)).toMatchObject({ ok: false })
    expect(await logs(session(), d)).toMatchObject({ ok: false, error: expect.stringMatching(/background/) })
    // A background id that isn't plain is never put on a command line.
    expect(await act('attach', session({ bgId: 'a b;calc' }), d)).toMatchObject({ ok: false })
    expect(launch).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('says so when no Claude Code CLI was found', async () => {
    expect(await act('attach', session({ bgId: 'afc61673' }), deps(null))).toMatchObject({ ok: false, error: expect.stringMatching(/could not find/) })
  })

  it('does not open a folder that is gone', async () => {
    expect(await act('open-folder', session(), deps())).toMatchObject({ ok: false, error: expect.stringMatching(/no longer there/) })
  })

  it('attaches in Windows Terminal when wt.exe is there', async () => {
    vi.mocked(which).mockResolvedValueOnce(['C:\\wt.exe'])
    expect(await act('attach', session({ bgId: 'afc61673', cwd: dir }), deps(CLAUDE))).toEqual({ ok: true })
    expect(launch).toHaveBeenLastCalledWith('C:\\wt.exe', ['-d', dir, CLAUDE, 'attach', 'afc61673'], { hide: false })
  })

  it('otherwise attaches in a console window via Start-Process, the values in env vars only (D-095)', async () => {
    expect(await act('attach', session({ bgId: 'afc61673', cwd: dir }), deps(CLAUDE))).toEqual({ ok: true })
    const [file, args, opts] = vi.mocked(launch).mock.lastCall!
    expect(file).toMatch(/[\\/]WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/)
    expect(args.at(-1)).toBe('Start-Process -FilePath $env:AGENTDECK_FILE -WorkingDirectory $env:AGENTDECK_CWD -ArgumentList $env:AGENTDECK_ARGS')
    expect(opts).toMatchObject({ hide: true, env: { AGENTDECK_FILE: CLAUDE, AGENTDECK_CWD: dir, AGENTDECK_ARGS: 'attach afc61673' } })
  })

  it('attaches from the home folder when the session folder is gone, and passes a failed launch on', async () => {
    vi.mocked(launch).mockResolvedValueOnce('powershell.exe exited with 1.')
    expect(await act('attach', session({ bgId: 'afc61673' }), deps(CLAUDE))).toEqual({ ok: false, error: 'powershell.exe exited with 1.' })
    expect(vi.mocked(launch).mock.lastCall![2].env).toMatchObject({ AGENTDECK_CWD: homedir() })
  })

  it('opens a Desktop session with --desktop --resume <session id>', async () => {
    expect(await act('open-desktop', session({ surface: 'desktop', cwd: dir }), deps(CLAUDE))).toEqual({ ok: true })
    expect(launch).toHaveBeenLastCalledWith(CLAUDE, ['--desktop', '--resume', '0b6e0d55-7c2e-4a39-9d0a-5d6a1f2c3b4e'], { cwd: dir, hide: true })
  })

  it('stops with claude stop <id>, and reports a timeout or the CLI error', async () => {
    const bg = session({ bgId: 'afc61673' })
    expect(await act('stop', bg, deps(CLAUDE))).toEqual({ ok: true })
    expect(run).toHaveBeenLastCalledWith(CLAUDE, ['stop', 'afc61673'], 15_000)
    vi.mocked(run).mockResolvedValueOnce({ code: null, stdout: '', stderr: '' })
    expect(await act('stop', bg, deps(CLAUDE))).toEqual({ ok: false, error: 'claude stop did not answer in time.' })
    vi.mocked(run).mockResolvedValueOnce({ code: 1, stdout: '', stderr: '\x1b[31mNo session afc61673\x1b[39m\nmore' })
    expect(await act('stop', bg, deps(CLAUDE))).toEqual({ ok: false, error: 'No session afc61673' })
  })

  it('runs claude in a folder for its trust prompt, only in a folder that is there', async () => {
    expect(await runClaudeIn('D:\\no\\such\\folder', deps(CLAUDE))).toMatchObject({ ok: false })
    expect(await runClaudeIn(dir, deps(CLAUDE))).toEqual({ ok: true })
    expect(vi.mocked(launch).mock.lastCall![1].at(-1)).toBe('Start-Process -FilePath $env:AGENTDECK_FILE -WorkingDirectory $env:AGENTDECK_CWD')
  })
})

describe('openFile', () => {
  it.each(['src\\a.ts', '--install-extension=x', '-g', '\\\\host\\share\\a.ts', '//host/share/a.ts'])(
    'refuses %s: local absolute paths only, never an option or a network path',
    async (p) => {
      expect(await openFile(p)).toMatchObject({ ok: false })
    }
  )

  it('refuses a path that is gone', async () => {
    expect(await openFile(join(dir, 'gone.ts'))).toMatchObject({ ok: false, error: expect.stringMatching(/no longer there/) })
  })
})

describe('runnable', () => {
  it('skips the extensionless shell script `where code` lists first', () => {
    expect(runnable(['D:\\VS Code\\bin\\code', 'D:\\VS Code\\bin\\code.cmd'], 'win32')).toBe('D:\\VS Code\\bin\\code.cmd')
    expect(runnable(['D:\\VS Code\\bin\\code'], 'win32')).toBeUndefined()
  })

  it('takes the first match on macOS, where the extensionless script is the command', () => {
    expect(runnable(['/usr/local/bin/code', '/opt/homebrew/bin/code'], 'darwin')).toBe('/usr/local/bin/code')
    expect(runnable([], 'darwin')).toBeUndefined()
  })
})

describe('localPathRe', () => {
  it.each([
    ['win32', 'C:\\Reports', true],
    ['win32', 'd:/x', true],
    ['win32', '\\\\host\\share', false],
    ['win32', '/Users/me', false],
    ['darwin', '/Users/me/project', true],
    ['darwin', '//host/share', false],
    ['darwin', 'C:\\Reports', false],
    ['darwin', 'relative/path', false]
  ] as const)('%s: %s → %s', (platform, p, local) => expect(localPathRe(platform).test(p)).toBe(local))
})

describe('stripAnsi', () => {
  it('turns the TUI screen claude logs prints into plain text (S7)', () => {
    expect(stripAnsi('\x1b[1mDo you want to proceed?\x1b[22m\r\n\x1b]0;title\x07\x1b(B\x1b[32m1. Yes\x1b[39m\r\n')).toBe('Do you want to proceed?\n1. Yes\n')
  })
})

describe('focus-terminal ("Answer in terminal")', () => {
  it('goes to the window the session runs in, through its process id', async () => {
    const focus = vi.fn(async () => ({ ok: true as const, app: 'WindowsTerminal' }))
    expect(await act('focus-terminal', session({ pid: 4242 }), { ...deps(), focus })).toEqual({ ok: true })
    expect(focus).toHaveBeenCalledWith(4242)
  })

  it('never needs the Claude CLI or a folder that exists', async () => {
    const d = deps(null)
    const focus = vi.fn(async () => ({ ok: true as const, app: 'warp' }))
    expect(await act('focus-terminal', session({ pid: 9, cwd: 'D:/gone' }), { ...d, focus })).toEqual({ ok: true })
    expect(d.claude).not.toHaveBeenCalled()
  })

  it('is never a dead end: without a pid, or a window, it says where the session waits', async () => {
    const focus = vi.fn(async () => ({ ok: false as const, reason: 'no-window' as const }))
    const noPid = await focusTerminal(session({ name: 'erp-fc', cwd: 'D:/thirdcode/ERP-cortex' }), focus)
    expect(noPid).toMatchObject({ ok: false, error: expect.stringContaining('does not know which window erp-fc runs in') })
    expect((noPid as { error: string }).error).toContain('D:/thirdcode/ERP-cortex')
    expect(focus).not.toHaveBeenCalled()

    const noWindow = await focusTerminal(session({ pid: 77, name: 'erp-fc', cwd: 'D:/thirdcode/ERP-cortex' }), focus)
    expect(noWindow).toMatchObject({ ok: false, error: expect.stringContaining('could not find the window erp-fc runs in') })
    expect((noWindow as { error: string }).error).toContain('D:/thirdcode/ERP-cortex')

    const failed = await focusTerminal(session({ pid: 77 }), async () => ({ ok: false, reason: 'failed' }))
    expect(failed).toMatchObject({ ok: false, error: expect.stringContaining('could not bring the window forward') })
  })
})

describe('Open in (the session menu)', () => {
  const folder = session({ cwd: dir })

  it('Explorer: opens the folder through the file manager, and says why when it can not', async () => {
    const openFolder = vi.fn(async () => '')
    expect(await act('open-explorer', folder, { ...deps(), openFolder })).toEqual({ ok: true })
    expect(openFolder).toHaveBeenCalledWith(dir)
    expect(await act('open-explorer', folder, { ...deps(), openFolder: async () => 'Failed to open path' })).toEqual({ ok: false, error: 'Failed to open path' })
  })

  it.each(['open-explorer', 'open-cursor', 'open-terminal'] as const)('%s: a folder that is gone is refused without starting anything', async (action) => {
    const openFolder = vi.fn(async () => '')
    expect(await act(action, session(), { ...deps(), openFolder })).toEqual({ ok: false, error: 'The session folder is no longer there.' })
    expect(openFolder).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
  })

  it('Cursor: the .cmd shim, the folder as the one argument, no shell', async () => {
    vi.mocked(which).mockResolvedValueOnce(['D:\\cursor\\bin\\cursor', 'D:\\cursor\\bin\\cursor.cmd'])
    expect(await act('open-cursor', folder, deps())).toEqual({ ok: true })
    expect(launch).toHaveBeenLastCalledWith('D:\\cursor\\bin\\cursor.cmd', [dir], { hide: true })
  })

  it('Cursor: not on PATH and not where its installer puts it', async () => {
    vi.stubEnv('LOCALAPPDATA', dir)
    try {
      expect(await findCursor('win32')).toBeUndefined()
      expect(await act('open-cursor', folder, deps())).toMatchObject({ ok: false, error: expect.stringContaining('Cursor was not found') })
      expect(launch).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('Cursor: also found where the per-user installer puts it', () => {
    const local = 'C:\\Users\\me\\AppData\\Local'
    expect(cursorCandidates({ LOCALAPPDATA: local }, 'win32')).toEqual([join(local, 'Programs', 'cursor', 'resources', 'app', 'bin', 'cursor.cmd')])
    expect(cursorCandidates({}, 'win32')).toEqual([])
  })

  it('macOS: Cursor and VS Code are also found inside their app bundles, in /Applications or ~/Applications', () => {
    const bin = (root: string, app: string, tool: string): string => join(root, `${app}.app`, 'Contents', 'Resources', 'app', 'bin', tool)
    expect(cursorCandidates({ HOME: '/Users/me' }, 'darwin')).toEqual([bin('/Applications', 'Cursor', 'cursor'), bin(join('/Users/me', 'Applications'), 'Cursor', 'cursor')])
    expect(codeCandidates({}, 'darwin')).toEqual([bin('/Applications', 'Visual Studio Code', 'code')])
    expect(codeCandidates({ HOME: '/Users/me' }, 'win32')).toEqual([])
  })

  it('Terminal here: Windows Terminal with -d <folder> when it is there', async () => {
    vi.mocked(which).mockResolvedValueOnce(['C:\\wt.exe'])
    expect(await act('open-terminal', folder, deps())).toEqual({ ok: true })
    expect(launch).toHaveBeenLastCalledWith('C:\\wt.exe', ['-d', dir], { hide: false })
  })

  it('Terminal here: otherwise a PowerShell console window in the folder, the values in env vars only', async () => {
    expect(await act('open-terminal', folder, deps())).toEqual({ ok: true })
    const [file, args, opts] = vi.mocked(launch).mock.lastCall!
    expect(file).toMatch(/[\\/]WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/)
    expect(args.at(-1)).toBe('Start-Process -FilePath $env:AGENTDECK_FILE -WorkingDirectory $env:AGENTDECK_CWD')
    expect(opts).toMatchObject({ hide: true, env: { AGENTDECK_CWD: dir, AGENTDECK_FILE: expect.stringMatching(/powershell\.exe$/) } })
  })

  it('Terminal here: a folder with a ; skips Windows Terminal, which would split its command line there (D-111)', async () => {
    const odd = join(dir, 'a;b')
    mkdirSync(odd)
    vi.mocked(which).mockResolvedValueOnce(['C:\\wt.exe'])
    expect(await act('open-terminal', session({ cwd: odd }), deps())).toEqual({ ok: true })
    expect(vi.mocked(launch).mock.lastCall![0]).toMatch(/powershell\.exe$/)
  })

  it('passes a launch failure on', async () => {
    vi.mocked(launch).mockResolvedValueOnce('cursor.cmd exited with 1.')
    vi.mocked(which).mockResolvedValueOnce(['D:\\cursor\\bin\\cursor.cmd'])
    expect(await act('open-cursor', folder, deps())).toEqual({ ok: false, error: 'cursor.cmd exited with 1.' })
  })
})

describe('Delete (background sessions only; claude rm)', () => {
  const bg = (over: Partial<Session> = {}): Session => session({ bgId: 'afc61673', ...over })
  const calls = (): string[][] => vi.mocked(run).mock.calls.map((c) => [...c[1]])

  it('refuses every session that is not a background one, with the sentence the menu shows, and runs nothing', async () => {
    const d = deps(CLAUDE)
    for (const s of [session(), session({ surface: 'desktop' }), session({ surface: 'vscode' }), bg({ bgId: null })]) {
      expect(await act('delete-background', s, d)).toEqual({ ok: false, error: NOT_DELETABLE })
    }
    expect(NOT_DELETABLE).toBe("Claude Code keeps this session's history. AgentDeck can archive it, but it never deletes Claude Code's files.")
    expect(run).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
    expect(d.claude).not.toHaveBeenCalled()
  })

  it.each(['a b;calc', '-rf', '..\\x', '', 'x'.repeat(65)])('refuses the background id %j: it is never put on a command line', async (bgId) => {
    expect(await deleteBackground(bg({ bgId }), deps(CLAUDE))).toEqual({ ok: false, error: NOT_DELETABLE })
    expect(run).not.toHaveBeenCalled()
  })

  it('runs claude rm with the id as its own argument, and nothing that discards work', async () => {
    expect(await act('delete-background', bg({ status: 'done' }), deps(CLAUDE))).toEqual({ ok: true })
    expect(calls()).toEqual([['rm', 'afc61673']])
    expect(run).toHaveBeenLastCalledWith(CLAUDE, ['rm', 'afc61673'], 30_000)
  })

  it.each(['working', 'needs_you', 'idle'] as const)('a %s session is stopped first, then removed', async (status) => {
    expect(await act('delete-background', bg({ status }), deps(CLAUDE))).toEqual({ ok: true })
    expect(calls()).toEqual([['stop', 'afc61673'], ['rm', 'afc61673']])
  })

  it('a session that already failed is not stopped', async () => {
    await act('delete-background', bg({ status: 'failed' }), deps(CLAUDE))
    expect(calls()).toEqual([['rm', 'afc61673']])
  })

  it('a stop that fails is not fatal, since rm says what is wrong; a rm that fails is reported in the CLI words', async () => {
    vi.mocked(run).mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'not running' })
    vi.mocked(run).mockResolvedValueOnce({ code: 1, stdout: '', stderr: '\x1b[31mUnpushed commits in the worktree\x1b[39m\nmore' })
    expect(await act('delete-background', bg(), deps(CLAUDE))).toEqual({ ok: false, error: 'Unpushed commits in the worktree' })
    expect(calls()).toEqual([['stop', 'afc61673'], ['rm', 'afc61673']])
  })

  it('reports a timeout, and a missing CLI', async () => {
    vi.mocked(run).mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
    vi.mocked(run).mockResolvedValueOnce({ code: null, stdout: '', stderr: '' })
    expect(await act('delete-background', bg(), deps(CLAUDE))).toEqual({ ok: false, error: 'claude rm did not answer in time.' })
    expect(await act('delete-background', bg(), deps(null))).toMatchObject({ ok: false, error: expect.stringContaining('could not find') })
  })

  it('never reads or removes a file itself: the only thing it runs is the CLI', async () => {
    await act('delete-background', bg({ status: 'done', cwd: dir }), deps(CLAUDE))
    expect(vi.mocked(run).mock.calls.every(([file]) => file === CLAUDE)).toBe(true)
    expect(launch).not.toHaveBeenCalled()
  })
})

describe('macOS terminals (osascript)', () => {
  const MAC_CLAUDE = '/Users/me/.local/bin/claude'
  const mac = (claude: string | null = MAC_CLAUDE): ActionDeps => ({ ...deps(claude), platform: 'darwin' })
  const command = (): string => vi.mocked(launch).mock.lastCall![1].at(-1)!

  it('quotes one shell word, a quote inside included', () => {
    expect(shQuote('/Users/me/my project')).toBe("'/Users/me/my project'")
    expect(shQuote("it's; rm -rf ~")).toBe(String.raw`'it'\''s; rm -rf ~'`)
  })

  it('passes the command to the script as its argument, never inside the script text', () => {
    const evil = `cd '/x' && echo "end tell" & do shell script "boom"`
    for (const app of ['Terminal', 'iTerm'] as const) {
      const args = macTerminalArgs(evil, app)
      expect(args.at(-1)).toBe(evil)
      const script = args.slice(0, -1)
      expect(script.filter((_, i) => i % 2 === 0).every((a) => a === '-e')).toBe(true)
      expect(script[1]).toBe('on run argv')
      expect(script.at(-1)).toBe('end run')
      expect(script.join('\n')).not.toContain(evil)
      expect(script.join('\n')).toContain(`tell application "${app}"`)
    }
  })

  it('attaches in a new terminal window: cd into the folder, then claude attach, every word quoted', async () => {
    expect(await act('attach', session({ bgId: 'afc61673', cwd: dir }), mac())).toEqual({ ok: true })
    expect(vi.mocked(launch).mock.lastCall![0]).toBe('/usr/bin/osascript')
    expect(vi.mocked(launch).mock.lastCall![2]).toEqual({ hide: false })
    expect(command()).toBe(`cd ${shQuote(dir)} && '${MAC_CLAUDE}' 'attach' 'afc61673'`)
    expect(which).not.toHaveBeenCalledWith('wt.exe', expect.anything())
  })

  it('Terminal here: a new window in the folder, a folder with a quote kept whole', async () => {
    const odd = join(dir, "it's here")
    mkdirSync(odd)
    expect(await act('open-terminal', session({ cwd: odd }), mac())).toEqual({ ok: true })
    expect(command()).toBe(`cd ${shQuote(odd)}`)
  })

  it('runs claude in a folder for its trust prompt the same way', async () => {
    expect(await runClaudeIn(dir, mac())).toEqual({ ok: true })
    expect(command()).toBe(`cd ${shQuote(dir)} && '${MAC_CLAUDE}'`)
  })

  it('says where to allow it when osascript fails, which is what a refused Automation prompt looks like', async () => {
    vi.mocked(launch).mockResolvedValueOnce('osascript exited with 1.')
    expect(await act('open-terminal', session({ cwd: dir }), mac())).toEqual({ ok: false, error: expect.stringMatching(/^osascript exited with 1\. .*Privacy & Security > Automation/) })
  })

  it('opens a folder in VS Code with the `code` on PATH', async () => {
    vi.mocked(which).mockResolvedValueOnce(['/usr/local/bin/code'])
    expect(await act('open-folder', session({ cwd: dir }), mac())).toEqual({ ok: true })
    expect(launch).toHaveBeenLastCalledWith('/usr/local/bin/code', [dir], { hide: true })
  })
})
