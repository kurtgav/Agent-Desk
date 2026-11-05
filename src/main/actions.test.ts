import { describe, expect, it, vi } from 'vitest'
import type { Session } from '@shared/snapshot'
import { act, logs, openFile, stripAnsi, type ActionDeps } from './actions'

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
    const d = deps('C:\\claude.exe')
    expect(await act('attach', session(), d)).toMatchObject({ ok: false, error: expect.stringMatching(/background/) })
    expect(await act('stop', session(), d)).toMatchObject({ ok: false })
    expect(await logs(session(), d)).toMatchObject({ ok: false, error: expect.stringMatching(/background/) })
  })

  it('says so when no Claude Code CLI was found', async () => {
    expect(await act('attach', session({ bgId: 'afc61673' }), deps(null))).toMatchObject({ ok: false, error: expect.stringMatching(/could not find/) })
  })

  it('does not open a folder that is gone', async () => {
    expect(await act('open-folder', session(), deps())).toMatchObject({ ok: false, error: expect.stringMatching(/no longer there/) })
  })
})

describe('openFile', () => {
  it.each(['src\\a.ts', '--install-extension=x', '-g'])('refuses %s: only absolute paths, never an option', async (p) => {
    expect(await openFile(p)).toMatchObject({ ok: false })
  })

  it('refuses a path that is gone', async () => {
    expect(await openFile('D:\\no\\such\\file.ts')).toMatchObject({ ok: false, error: expect.stringMatching(/no longer there/) })
  })
})

describe('stripAnsi', () => {
  it('turns the TUI screen claude logs prints into plain text (S7)', () => {
    expect(stripAnsi('\x1b[1mDo you want to proceed?\x1b[22m\r\n\x1b]0;title\x07\x1b[32m1. Yes\x1b[39m\r\n')).toBe('Do you want to proceed?\n1. Yes\n')
  })
})
