import { mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@shared/snapshot'
import { launch, run, which } from '../collector/cli'
import { act, logs, openFile, runClaudeIn, runnable, stripAnsi, type ActionDeps } from './actions'

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
  return { claude: vi.fn(async () => claude), copy: (t) => copied.push(t), copied }
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
    expect(file).toMatch(/\\WindowsPowerShell\\v1\.0\\powershell\.exe$/)
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
    expect(await openFile('D:\\no\\such\\file.ts')).toMatchObject({ ok: false, error: expect.stringMatching(/no longer there/) })
  })
})

describe('runnable', () => {
  it('skips the extensionless shell script `where code` lists first', () => {
    expect(runnable(['D:\\VS Code\\bin\\code', 'D:\\VS Code\\bin\\code.cmd'])).toBe('D:\\VS Code\\bin\\code.cmd')
    expect(runnable(['D:\\VS Code\\bin\\code'])).toBeUndefined()
  })
})

describe('stripAnsi', () => {
  it('turns the TUI screen claude logs prints into plain text (S7)', () => {
    expect(stripAnsi('\x1b[1mDo you want to proceed?\x1b[22m\r\n\x1b]0;title\x07\x1b(B\x1b[32m1. Yes\x1b[39m\r\n')).toBe('Do you want to proceed?\n1. Yes\n')
  })
})
