import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RoleSummary } from '@shared/roles'
import {
  DEFINITIONS_MAX_BYTES, DELEGATION_TOOL, NO_ROLE, SHIM_SAFE, definition, helperLine, mentionPrompt, planRole, removeRoleFile, sweepRoleFiles, type Definition
} from './console-roles'
import type { RolesService, SpawnRole } from './roles'

let tmp: string
beforeEach(() => void (tmp = mkdtempSync(join(tmpdir(), 'agentdeck-roleplan-'))))
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

const role = (id: string, over: Partial<SpawnRole> = {}): SpawnRole => ({
  id, name: id.toUpperCase(), emoji: '🤖', description: `${id} does things.`, source: 'agency', agentName: null, prompt: `You are ${id}.`, tools: null, ...over
})
const summary = (r: SpawnRole): RoleSummary => ({
  id: r.id, name: r.name, division: 'x', divisionLabel: 'X', emoji: r.emoji, color: '#000000', vibe: '', description: r.description, source: r.source,
  installed: r.agentName !== null, agentName: r.agentName, promptChars: r.prompt.length
})
const service = (rs: SpawnRole[]): RolesService => ({
  roleForSpawn: async (id) => rs.find((r) => r.id === id) ?? null,
  summary: async (id) => (rs.find((r) => r.id === id) ? summary(rs.find((r) => r.id === id)!) : null),
  list: async () => rs.map(summary)
})
const plan = (req: Parameters<typeof planRole>[0], rs: SpawnRole[], viaCmd = false) => planRole(req, { roles: service(rs), tmpDir: join(tmp, 'tmp'), viaCmd })
const defsOf = (file: string | null): Record<string, Definition> => JSON.parse(readFileSync(file!, 'utf8')) as Record<string, Definition>
const planned = async (req: Parameters<typeof planRole>[0], rs: SpawnRole[], viaCmd = false) => {
  const r = await plan(req, rs, viaCmd)
  if (!r.ok) throw new Error(r.error)
  return r.plan
}

describe('planRole: no role', () => {
  it('is no arguments at all without a role', async () => {
    expect(await plan({}, [])).toEqual({ ok: true, plan: NO_ROLE })
    expect(await plan({ role: null }, [])).toEqual({ ok: true, plan: NO_ROLE })
  })

  it('refuses helpers without a lead', async () => {
    expect(await plan({ helpers: ['qa'] }, [role('qa')])).toEqual({ ok: false, error: 'Pick a lead role first: helpers answer to it.' })
  })
})

describe('planRole: the lead', () => {
  it('uses --agent <installed name> for a role Claude Code has, and writes no file', async () => {
    const p = await planned({ role: 'frontend-developer' }, [role('frontend-developer', { name: 'Frontend Developer', agentName: 'Frontend Developer' })])
    expect(p.args).toEqual(['--agent', 'Frontend Developer'])
    expect(p.file).toBeNull()
    expect(p.expect).toBe('Frontend Developer')
    expect(p.lead).toEqual({ id: 'frontend-developer', name: 'Frontend Developer', emoji: '🤖' })
    expect(p.opening).toBeNull()
    expect(readdirSync(tmp)).toEqual([])
  })

  it('hands a role Claude Code does not have over as a definition keyed by its id, in a private file', async () => {
    const p = await planned({ role: 'cto' }, [role('cto', { source: 'builtin', prompt: 'You are the CTO.' })])
    expect(p.args).toEqual(['--agents', p.file, '--agent', 'cto'])
    expect(defsOf(p.file)).toEqual({ cto: { description: 'cto does things.', prompt: 'You are the CTO.' } })
    expect(p.expect).toBe('cto')
    if (process.platform !== 'win32') expect(statSync(p.file!).mode & 0o777).toBe(0o600)
    expect(p.file!.startsWith(join(tmp, 'tmp'))).toBe(true)
  })

  it('keeps the tools its front matter limits it to', async () => {
    const p = await planned({ role: 'reader' }, [role('reader', { tools: ['Read', 'Grep'] })])
    expect(defsOf(p.file).reader!.tools).toEqual(['Read', 'Grep'])
  })

  it('refuses a role the catalog does not have, and says to reload', async () => {
    expect(await plan({ role: 'ghost' }, [])).toEqual({ ok: false, error: expect.stringContaining('Reload the roles') })
    expect(readdirSync(tmp)).toEqual([])
  })

  it('says so before the roles are read at all', async () => {
    const r = await planRole({ role: 'cto' }, { roles: null, tmpDir: tmp, viaCmd: false })
    expect(r).toEqual({ ok: false, error: expect.stringContaining('still reading its roles') })
  })

  it('never passes an installed name through a .cmd shim when it is unsafe there; the definition goes in a file instead', async () => {
    const unsafe = role('ai-eng', { name: 'AI & ML', agentName: 'AI & ML' })
    expect(SHIM_SAFE.test('AI & ML')).toBe(false)
    expect(SHIM_SAFE.test('Frontend Developer')).toBe(true)
    expect((await planned({ role: 'ai-eng' }, [unsafe], false)).args).toEqual(['--agent', 'AI & ML'])
    const viaShim = await planned({ role: 'ai-eng' }, [unsafe], true)
    expect(viaShim.args).toEqual(['--agents', viaShim.file, '--agent', 'ai-eng'])
  })
})

describe('planRole: helpers', () => {
  const lead = role('cto', { source: 'builtin' })
  const qa = role('qa', { name: 'QA Engineer' })
  const fe = role('frontend-developer', { name: 'Frontend Developer', agentName: 'Frontend Developer' })

  it('lists an installed helper by its installed name with no definition, and a file-defined helper by its safe name', async () => {
    const p = await planned({ role: 'cto', helpers: ['qa', 'frontend-developer'] }, [lead, qa, fe])
    expect(p.helpers).toEqual([
      { id: 'qa', name: 'QA Engineer', emoji: '🤖', subagent: 'QA Engineer' },
      { id: 'frontend-developer', name: 'Frontend Developer', emoji: '🤖', subagent: 'Frontend Developer' }
    ])
    expect(Object.keys(defsOf(p.file))).toEqual(['cto', 'QA Engineer'])
    expect(p.opening).toBe('Available to consult: QA Engineer, Frontend Developer. Use them when their expertise applies.')
  })

  it('adds the Agent tool to a lead that is limited to a few tools, which forces the file route', async () => {
    const limited = role('reviewer', { agentName: 'reviewer', tools: ['Read', 'Grep'] })
    const p = await planned({ role: 'reviewer', helpers: ['qa'] }, [limited, qa])
    expect(p.args).toEqual(['--agents', p.file, '--agent', 'reviewer'])
    expect(defsOf(p.file).reviewer!.tools).toEqual(['Read', 'Grep', DELEGATION_TOOL])
    // Without helpers it stays the installed agent.
    expect((await planned({ role: 'reviewer' }, [limited])).args).toEqual(['--agent', 'reviewer'])
    // A lead that already has the tool is left as installed.
    const has = role('lead', { agentName: 'lead', tools: ['Read', 'Agent'] })
    expect((await planned({ role: 'lead', helpers: ['qa'] }, [has, qa])).args).toEqual(['--agents', expect.any(String), '--agent', 'lead'])
  })

  it('gives a file-defined helper its id when its name would collide with an installed agent', async () => {
    const clash = role('qa', { name: 'Frontend Developer' })
    const p = await planned({ role: 'cto', helpers: ['qa'] }, [lead, clash, fe])
    expect(p.helpers[0]!.subagent).toBe('qa')
    expect(Object.keys(defsOf(p.file))).toEqual(['cto', 'qa'])
  })

  it('gives a helper whose name is not a safe agent name its id', async () => {
    const odd = role('odd', { name: '100% Odd' })
    const p = await planned({ role: 'cto', helpers: ['odd'] }, [lead, odd])
    expect(p.helpers[0]!.subagent).toBe('odd')
  })

  it('drops the lead and repeats from the helpers, and refuses more than four', async () => {
    const p = await planned({ role: 'cto', helpers: ['qa', 'qa', 'cto'] }, [lead, qa])
    expect(p.helpers.map((h) => h.id)).toEqual(['qa'])
    const five = ['a', 'b', 'c', 'd', 'e'].map((x) => role(x))
    expect(await plan({ role: 'cto', helpers: five.map((r) => r.id) }, [lead, ...five])).toEqual({ ok: false, error: 'A conversation can have up to 4 helper roles.' })
    expect(readdirSync(join(tmp, 'tmp'))).toHaveLength(1) // the first plan's file only
  })

  it('refuses an unknown helper before writing anything', async () => {
    expect(await plan({ role: 'cto', helpers: ['ghost'] }, [lead])).toEqual({ ok: false, error: expect.stringContaining('“ghost”') })
    expect(readdirSync(tmp)).toEqual([])
  })

  it('gives the second of two helpers with the same name its id, so both can be asked for', async () => {
    const a = role('a', { name: 'Same' })
    const b = role('b', { name: 'Same' })
    const p = await planned({ role: 'cto', helpers: ['a', 'b'] }, [lead, a, b])
    expect(p.helpers.map((h) => h.subagent)).toEqual(['Same', 'b'])
  })

  it('refuses role text over 256 KB in all, before writing', async () => {
    const big = role('big', { prompt: 'x'.repeat(DEFINITIONS_MAX_BYTES) })
    expect(await plan({ role: 'big' }, [big])).toEqual({ ok: false, error: expect.stringContaining('256 KB') })
    expect(readdirSync(tmp)).toEqual([])
  })

  it('says so when the temporary folder can not be written', async () => {
    writeFileSync(join(tmp, 'blocked'), 'a file where a folder should be')
    const r = await planRole({ role: 'cto' }, { roles: service([lead]), tmpDir: join(tmp, 'blocked', 'tmp'), viaCmd: false })
    expect(r).toEqual({ ok: false, error: 'AgentDeck could not write the role to its temporary folder.' })
  })
})

describe('definition', () => {
  it('flattens the description to one line, caps it, and falls back to the name', () => {
    expect(definition(role('x', { description: 'line one\nline two\u0000' })).description).toBe('line one line two')
    expect(definition(role('x', { description: 'y'.repeat(900) })).description).toHaveLength(400)
    expect(definition(role('x', { description: '' })).description).toBe('X')
  })

  it('adds a tool only to a limited role, once', () => {
    expect(definition(role('x'), ['Agent'])).not.toHaveProperty('tools')
    expect(definition(role('x', { tools: ['Read', 'Agent'] }), ['Agent']).tools).toEqual(['Read', 'Agent'])
  })
})

describe('the temporary files', () => {
  it('removeRoleFile deletes the file and forgives a missing one', async () => {
    const p = await planned({ role: 'cto' }, [role('cto')])
    await removeRoleFile(p.file)
    expect(readdirSync(join(tmp, 'tmp'))).toEqual([])
    await removeRoleFile(p.file)
    await removeRoleFile(null)
  })

  it('sweeps every definitions file at startup and nothing else', async () => {
    const dir = join(tmp, 'tmp')
    mkdirSync(dir)
    const mine = ['roles-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.json', 'roles-11111111-2222-4333-8444-555555555555.json']
    for (const f of [...mine, 'keep.json', 'roles-notauuid.json', 'roles-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.json.bak']) writeFileSync(join(dir, f), '{}')
    expect(await sweepRoleFiles(dir)).toBe(2)
    expect(readdirSync(dir).sort()).toEqual(['keep.json', 'roles-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.json.bak', 'roles-notauuid.json'])
    expect(await sweepRoleFiles(join(tmp, 'nothing-here'))).toBe(0)
  })
})

describe('helperLine and mentionPrompt', () => {
  it('names the helpers plainly', () => {
    expect(helperLine([{ subagent: 'A' }, { subagent: 'B C' }])).toBe('Available to consult: A, B C. Use them when their expertise applies.')
  })

  it('asks for a named subagent with the user words right after "for this:"', () => {
    expect(mentionPrompt('check the login form', [{ kind: 'named', name: 'QA Engineer', subagent: 'QA Engineer' }])).toBe('Use the QA Engineer subagent for this: check the login form')
    expect(
      mentionPrompt('ship it', [{ kind: 'named', name: 'A', subagent: 'A' }, { kind: 'named', name: 'B', subagent: 'B' }, { kind: 'named', name: 'C', subagent: 'C' }])
    ).toBe('Use the A subagent, the B subagent and the C subagent for this: ship it')
  })

  it('describes a role Claude Code was not given in the message itself', () => {
    const out = mentionPrompt('review the plan', [{ kind: 'inline', name: 'Security Lead', text: 'You guard the keys.' }])
    expect(out).toBe('Use a general-purpose subagent for this, briefed as the Security Lead with the role text below: review the plan\n\nRole of the Security Lead:\nYou guard the keys.')
  })

  it('mixes both without repeating the user text', () => {
    const out = mentionPrompt('go', [{ kind: 'named', name: 'A', subagent: 'A' }, { kind: 'inline', name: 'B', text: 'bee' }])
    expect(out.match(/go/g)).toHaveLength(1)
    expect(out).toContain('Use the A subagent for this: go')
    expect(out).toContain('Role of the B:\nbee')
  })

  it('is empty with no one named', () => {
    expect(mentionPrompt('hi', [])).toBe('')
  })
})
