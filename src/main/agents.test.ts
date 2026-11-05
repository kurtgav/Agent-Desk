import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { agentList, parseAgent } from './agents'

const md = (front: string, body = 'You review code.'): string => `---\n${front}\n---\n${body}\n`

describe('parseAgent (sub-agents § file format)', () => {
  it('reads name, description and model, quoted or not, with CRLF and a BOM', () => {
    expect(parseAgent('\uFEFF---\r\nname: code-reviewer\r\ndescription: "Reviews code."\r\nmodel: sonnet\r\n---\r\nbody', 'user')).toEqual({
      name: 'code-reviewer', description: 'Reviews code.', model: 'sonnet', scope: 'user'
    })
    expect(parseAgent(md("name: 'my-plugin:auditor'"), 'project')).toEqual({ name: 'my-plugin:auditor', description: '', model: null, scope: 'project' })
  })

  it('offers no name that could read as an option or hold spaces', () => {
    for (const name of ['--help', '-x', 'two words', '', 'a'.repeat(65)]) expect(parseAgent(md(`name: ${name}`), 'user')).toBeNull()
    expect(parseAgent('no frontmatter here', 'user')).toBeNull()
  })

  it('caps the description and skips block scalars', () => {
    expect(parseAgent(md(`name: a\ndescription: ${'x'.repeat(400)}`), 'user')!.description).toHaveLength(300)
    expect(parseAgent(md('name: a\ndescription: >\n  folded text'), 'user')!.description).toBe('')
  })
})

describe('agentList', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentdeck-agents-'))
  const user = join(root, 'user')
  const project = join(root, 'project')
  mkdirSync(user)
  mkdirSync(project)
  writeFileSync(join(user, 'b.md'), md('name: beta\ndescription: user beta'))
  writeFileSync(join(user, 'r.md'), md('name: reviewer\ndescription: user reviewer'))
  writeFileSync(join(user, 'notes.txt'), md('name: ignored'))
  writeFileSync(join(project, 'r.md'), md('name: reviewer\ndescription: project reviewer'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('lets a project definition win over a user one of the same name, sorted by name', () => {
    expect(agentList(user, project).map((a) => [a.name, a.description, a.scope])).toEqual([
      ['beta', 'user beta', 'user'],
      ['reviewer', 'project reviewer', 'project']
    ])
  })

  it('treats a missing folder as empty', () => {
    expect(agentList(join(root, 'nope'), null)).toEqual([])
  })
})
