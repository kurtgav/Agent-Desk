import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DispatchRequest } from '@shared/bridge'
import type { RoleSummary } from '@shared/roles'
import { bgKey, nameKey } from '@shared/session-meta'
import { INLINE_AGENTS_MAX, dispatchArgs, dispatchRole, refusal, startDispatch, type TaskDeps } from './dispatch'
import type { RolesService, SpawnRole } from './roles'

const HERE = process.cwd()
const req = (over: Partial<DispatchRequest> = {}): DispatchRequest => ({ prompt: 'Fix the flaky login test', cwd: HERE, agent: null, effort: 'high', ...over })
const role = (id: string, over: Partial<SpawnRole> = {}): SpawnRole => ({ id, name: id.toUpperCase(), emoji: '🤖', description: `${id} does things.`, source: 'agency', agentName: null, prompt: `You are ${id}.`, tools: null, ...over })
const summary = (r: SpawnRole): RoleSummary => ({
  id: r.id, name: r.name, division: 'x', divisionLabel: 'X', emoji: r.emoji, color: '#000000', vibe: '', description: r.description, source: r.source, installed: r.agentName !== null, agentName: r.agentName, promptChars: r.prompt.length
})
const service = (rs: SpawnRole[]): RolesService => ({
  roleForSpawn: async (id) => rs.find((r) => r.id === id) ?? null,
  summary: async (id) => (rs.find((r) => r.id === id) ? summary(rs.find((r) => r.id === id)!) : null),
  list: async () => rs.map(summary)
})

describe('dispatchArgs with a role', () => {
  it('lets the role replace --agent, keeping the order of the other flags', () => {
    expect(dispatchArgs(req({ model: 'opus' }), 'n-1', false, ['--agent', 'Frontend Developer'])).toEqual([
      '--bg', '--name', 'n-1', '--agent', 'Frontend Developer', '--model', 'opus', '--effort', 'high', 'Fix the flaky login test'
    ])
    expect(dispatchArgs(req(), 'n-1', false, ['--agents', '{"cto":{}}', '--agent', 'cto'])).toEqual([
      '--bg', '--name', 'n-1', '--agents', '{"cto":{}}', '--agent', 'cto', '--effort', 'high', 'Fix the flaky login test'
    ])
  })

  it('is what it was with no role', () => {
    expect(dispatchArgs(req({ agent: 'code-reviewer' }), 'n-1', false)).toEqual(['--bg', '--name', 'n-1', '--agent', 'code-reviewer', '--effort', 'high', 'Fix the flaky login test'])
    expect(dispatchArgs(req(), 'n-1', false, [])).not.toContain('--agent')
  })
})

describe('refusal', () => {
  it('does not take a role and a subagent together', async () => {
    expect(await refusal(req({ role: 'cto', agent: 'code-reviewer' }), [HERE], async () => [])).toBe('Pick a role or a subagent, not both.')
    expect(await refusal(req({ role: 'cto' }), [HERE], async () => [])).toBeNull()
  })
})

describe('dispatchRole', () => {
  it('uses the installed name when Claude Code has the role', async () => {
    const roles = service([role('fe', { name: 'Frontend Developer', agentName: 'Frontend Developer' })])
    expect(await dispatchRole('fe', { roles, viaCmd: false })).toEqual({ ok: true, role: { id: 'fe', name: 'Frontend Developer', emoji: '🤖' }, args: ['--agent', 'Frontend Developer'] })
    // Through the npm shim too, as long as the name is plain.
    expect(await dispatchRole('fe', { roles, viaCmd: true })).toMatchObject({ ok: true, args: ['--agent', 'Frontend Developer'] })
  })

  it('hands a role Claude Code does not have over inline, keyed by its id', async () => {
    const out = await dispatchRole('cto', { roles: service([role('cto', { prompt: 'You are "the" CTO & more. 100%' })]), viaCmd: false })
    if (!out.ok) throw new Error(out.error)
    expect(out.args.slice(0, 1)).toEqual(['--agents'])
    expect(out.args.slice(2)).toEqual(['--agent', 'cto'])
    expect(JSON.parse(out.args[1]!)).toEqual({ cto: { description: 'cto does things.', prompt: 'You are "the" CTO & more. 100%' } })
  })

  it('carries the tools a role is limited to', async () => {
    const out = await dispatchRole('r', { roles: service([role('r', { tools: ['Read', 'Grep'] })]), viaCmd: false })
    expect(out.ok && (JSON.parse(out.args[1]!) as Record<string, { tools: string[] }>).r!.tools).toEqual(['Read', 'Grep'])
  })

  it('refuses, in words, what the npm shim can not carry', async () => {
    const roles = service([role('cto'), role('ai', { name: 'AI & ML', agentName: 'AI & ML' })])
    expect(await dispatchRole('cto', { roles, viaCmd: true })).toEqual({ ok: false, error: expect.stringContaining('npm claude.cmd shim') })
    expect(await dispatchRole('ai', { roles, viaCmd: true })).toEqual({ ok: false, error: expect.stringContaining('npm claude.cmd shim') })
    // The native build takes the unusual name as it is.
    expect(await dispatchRole('ai', { roles, viaCmd: false })).toMatchObject({ ok: true, args: ['--agent', 'AI & ML'] })
  })

  it('refuses a role that is too long for a command line', async () => {
    const out = await dispatchRole('big', { roles: service([role('big', { prompt: 'x'.repeat(INLINE_AGENTS_MAX) })]), viaCmd: false })
    expect(out).toEqual({ ok: false, error: expect.stringContaining('20 KB') })
  })

  it('refuses a role the catalog does not have, and a catalog that is not there yet', async () => {
    expect(await dispatchRole('ghost', { roles: service([]), viaCmd: false })).toEqual({ ok: false, error: expect.stringContaining('Reload the roles') })
    expect(await dispatchRole('cto', { roles: null, viaCmd: false })).toEqual({ ok: false, error: expect.stringContaining('still reading its roles') })
  })
})

describe('startDispatch', () => {
  let dir: string
  let log: string
  let remembered: [string[], string][]
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentdeck-dispatch-role-'))
    log = join(dir, 'fake.log')
    remembered = []
    vi.stubEnv('FAKE_CLAUDE_LOG', log)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  const deps = (over: Partial<TaskDeps> = {}, claude: string | null = resolve('test/fixtures/fake-claude.cmd')): TaskDeps => ({
    known: () => [HERE],
    agentsIn: async () => [],
    actions: { claude: async () => claude, copy: () => undefined },
    roles: () => service([role('fe', { name: 'Frontend Developer', agentName: 'Frontend Developer' }), role('cto')]),
    remember: (keys, id) => void remembered.push([keys, id]),
    ...over
  })
  const argv = (): string[] => JSON.parse(readFileSync(log, 'utf8').split('\n').find((l) => l.startsWith('ARGV '))!.slice(5)) as string[]

  it('refuses before running anything, and keeps the refusal in words', async () => {
    expect(await startDispatch(req({ role: 'cto', agent: 'x' }), deps())).toEqual({ ok: false, error: 'Pick a role or a subagent, not both.', untrusted: false })
    expect(await startDispatch(req({ role: 'cto' }), deps({}, null))).toMatchObject({ ok: false, untrusted: false })
    expect(remembered).toEqual([])
  })

  it('says why a role can not be used and notes nothing', async () => {
    // The fixture is a .cmd, like an npm install: a role Claude Code does not have is refused there.
    const out = await startDispatch(req({ role: 'cto' }), deps())
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining('npm claude.cmd shim') })
    expect(await startDispatch(req({ role: 'ghost' }), deps())).toMatchObject({ ok: false, error: expect.stringContaining('Reload the roles') })
    expect(remembered).toEqual([])
  })

  it.skipIf(process.platform !== 'win32')('starts as an installed role, and notes the role under the name AgentDeck gave and the id claude printed', async () => {
    const out = await startDispatch(req({ role: 'fe' }), deps())
    if (!out.ok) throw new Error(out.error)
    expect(out.bgId).toBe('fakebg1')
    const args = argv()
    expect(args.slice(0, 2)).toEqual(['--bg', '--name'])
    expect(args.slice(args.indexOf('--agent'), args.indexOf('--agent') + 2)).toEqual(['--agent', 'Frontend Developer'])
    expect(remembered).toEqual([[[nameKey(out.name), bgKey('fakebg1')], 'fe']])
  })

  it.skipIf(process.platform !== 'win32')('does not report a started session as failed because the note could not be kept', async () => {
    const out = await startDispatch(
      req({ role: 'fe' }),
      deps({
        remember: () => {
          throw new Error('disk full')
        }
      })
    )
    expect(out.ok).toBe(true)
  })

  it.skipIf(process.platform !== 'win32')('without a role, runs as it always did and notes nothing', async () => {
    const out = await startDispatch(req(), deps())
    expect(out.ok).toBe(true)
    expect(argv()).not.toContain('--agent')
    expect(remembered).toEqual([])
  })
})
