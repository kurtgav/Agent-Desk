import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { AgentDef, DispatchRequest } from '@shared/bridge'
import { NOT_KNOWN, NOT_LOCAL, dispatchArgs, dispatchResult, knownFolder, refusal, sessionName } from './dispatch'

const req = (over: Partial<DispatchRequest> = {}): DispatchRequest => ({ prompt: 'Fix the flaky login test', cwd: 'D:\\p', agent: null, effort: 'high', ...over })

describe('sessionName', () => {
  it('slugs the first four words and adds a suffix', () => {
    expect(sessionName('Fix the flaky login test, please', 'a1b2')).toBe('fix-the-flaky-login-a1b2')
    expect(sessionName('  ¿Qué? ', 'a1b2')).toBe('qu-a1b2')
    expect(sessionName('!!!', 'a1b2')).toBe('task-a1b2')
    expect(sessionName('supercalifragilisticexpialidocious-and-more words', 'a1b2')).toMatch(/^[a-z-]{1,32}-a1b2$/)
    expect(sessionName('x')).toMatch(/^x-[0-9a-f]{4}$/)
  })
})

describe('dispatchArgs (brief § Composer)', () => {
  it('builds the argument array: no shell, the prompt as one argument', () => {
    expect(dispatchArgs(req({ agent: 'code-reviewer', effort: 'max' }), 'n-1', false)).toEqual([
      '--bg', '--name', 'n-1', '--agent', 'code-reviewer', '--effort', 'max', 'Fix the flaky login test'
    ])
    expect(dispatchArgs(req(), 'n-1', false)).not.toContain('--agent')
  })

  it('never lets the prompt read as an option', () => {
    expect(dispatchArgs(req({ prompt: '--dangerously-skip-permissions' }), 'n', false).at(-1)).toBe(' --dangerously-skip-permissions')
  })

  it('keeps newlines for claude.exe and folds them for a .cmd shim', () => {
    expect(dispatchArgs(req({ prompt: 'a\nb' }), 'n', false).at(-1)).toBe('a\nb')
    expect(dispatchArgs(req({ prompt: 'a \r\n\n  b' }), 'n', true).at(-1)).toBe('a b')
  })
})

describe('dispatchResult (S6, S7)', () => {
  it('reads the background id from `backgrounded · <id>`', () => {
    expect(dispatchResult({ code: 0, stdout: '\x1b[32mbackgrounded · afc61673\x1b[39m\n', stderr: '' }, 'n')).toEqual({ ok: true, name: 'n', bgId: 'afc61673' })
    expect(dispatchResult({ code: 0, stdout: '', stderr: '' }, 'n')).toEqual({ ok: true, name: 'n', bgId: null })
  })

  it('flags an untrusted folder, with the CLI wording', () => {
    const r = dispatchResult({ code: 1, stdout: '', stderr: 'Workspace not trusted. Run `claude` in D:\\p once and accept the trust prompt, then retry.\n' }, 'n')
    expect(r).toEqual({ ok: false, untrusted: true, error: 'Workspace not trusted. Run `claude` in D:\\p once and accept the trust prompt, then retry.' })
  })

  it('reports a timeout and other failures', () => {
    expect(dispatchResult({ code: null, stdout: '', stderr: '' }, 'n')).toMatchObject({ ok: false, untrusted: false, error: /in time/ })
    expect(dispatchResult({ code: 2, stdout: '', stderr: '' }, 'n')).toMatchObject({ ok: false, untrusted: false, error: 'claude --bg exited with 2.' })
  })
})

describe('knownFolder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentdeck-dispatch-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('accepts a folder AgentDeck knows, in any case or slash style, while it exists', async () => {
    expect(await knownFolder(dir, [dir.toUpperCase().replace(/\\/g, '/') + '/'])).toBe(true)
  })

  it('refuses unknown, missing and network folders', async () => {
    expect(await knownFolder(dir, ['D:\\other'])).toBe(false)
    expect(await knownFolder('D:\\no\\such\\folder', ['D:\\no\\such\\folder'])).toBe(false)
    expect(await knownFolder('\\\\host\\share', ['\\\\host\\share'])).toBe(false)
  })
})

describe('refusal (ADR-0010: main checks what the page sends)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentdeck-refusal-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const agents = async (): Promise<AgentDef[]> => [{ name: 'code-reviewer', description: '', model: null, scope: 'user' }]

  it('runs only in a known local folder, with a subagent defined for it', async () => {
    expect(await refusal(req({ cwd: dir, agent: 'code-reviewer' }), [dir], agents)).toBeNull()
    expect(await refusal(req({ cwd: '\\\\host\\share' }), ['\\\\host\\share'], agents)).toBe(NOT_LOCAL)
    expect(await refusal(req({ cwd: dir }), ['D:\\other'], agents)).toBe(NOT_KNOWN)
    expect(await refusal(req({ cwd: dir, agent: 'made-up' }), [dir], agents)).toMatch(/no subagent named made-up/)
  })
})

describe('dispatchResult on a spawn failure', () => {
  it("shows the reason run() reported instead of a timeout", () => {
    expect(dispatchResult({ code: null, stdout: '', stderr: 'spawn ENAMETOOLONG' }, 'n')).toMatchObject({ ok: false, error: 'spawn ENAMETOOLONG' })
  })
})
