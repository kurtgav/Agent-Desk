import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseFrontMatter } from '@shared/role-parse'
import { skillName } from '@shared/roles'
import { SKILL_MARK, installedSkillIds, removeSkill, skillMarkdown, writeSkill } from './roles-skills'

const role = { id: 'frontend-developer', name: 'Frontend Developer', description: 'Expert frontend developer: "React", Vue & CSS.', vibe: 'Pixels with purpose.' }
const TEXT = '# Frontend Developer\r\n\r\nYou are **Frontend Developer**.\r\n'

describe('skill text', () => {
  it('names the skill agency-<id>, cut to 64 characters with no trailing hyphen', () => {
    expect(skillName('frontend-developer')).toBe('agency-frontend-developer')
    const long = skillName(`${'a'.repeat(56)}-bcdefghij`)
    expect(long.length).toBeLessThanOrEqual(64)
    expect(long.endsWith('-')).toBe(false)
  })
  it('writes front matter Claude Code reads, the mark, then the role text with LF line ends', () => {
    const md = skillMarkdown(role, TEXT)
    const fm = parseFrontMatter(md)!
    expect(fm.fields.name).toBe('agency-frontend-developer')
    expect(fm.fields.description).toBe('Expert frontend developer: "React", Vue & CSS. Use when the task calls for a Frontend Developer.')
    expect(fm.body).toContain(SKILL_MARK)
    expect(fm.body).toContain('You are **Frontend Developer**.')
    expect(md).not.toContain('\r')
  })
  it('keeps the description within 1,024 characters and falls back to the vibe', () => {
    expect(parseFrontMatter(skillMarkdown({ ...role, description: 'x'.repeat(3_000) }, TEXT))!.fields.description!.length).toBeLessThanOrEqual(1_024)
    expect(parseFrontMatter(skillMarkdown({ ...role, description: '' }, TEXT))!.fields.description).toMatch(/^Pixels with purpose\./)
  })
})

describe('skills folder', () => {
  let root = ''
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agentdeck-skills-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('reads a missing folder as no skills', async () => {
    expect(await installedSkillIds(join(root, 'nope'))).toEqual(new Set())
  })
  it('installs, lists and removes a role skill, folder and all', async () => {
    expect(await writeSkill(root, role, TEXT)).toEqual({ ok: true })
    const file = join(root, 'agency-frontend-developer', 'SKILL.md')
    expect(readFileSync(file, 'utf8')).toContain(SKILL_MARK)
    expect(await installedSkillIds(root)).toEqual(new Set(['frontend-developer']))
    // Installing again replaces its own file.
    expect(await writeSkill(root, { ...role, description: 'Changed.' }, TEXT)).toEqual({ ok: true })
    expect(readFileSync(file, 'utf8')).toContain('Changed.')
    expect(await removeSkill(root, 'frontend-developer')).toEqual({ ok: true })
    expect(existsSync(join(root, 'agency-frontend-developer'))).toBe(false)
    expect(await removeSkill(root, 'frontend-developer')).toEqual({ ok: true }) // already gone
  })
  it('never replaces, lists or removes a skill AgentDeck did not write', async () => {
    const dir = join(root, 'agency-frontend-developer')
    mkdirSync(dir)
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: agency-frontend-developer\ndescription: mine\n---\nhand made\n')
    expect((await writeSkill(root, role, TEXT)).ok).toBe(false)
    expect(await installedSkillIds(root)).toEqual(new Set())
    expect((await removeSkill(root, 'frontend-developer')).ok).toBe(false)
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toContain('hand made')
  })
  it('keeps the folder when something else is in it', async () => {
    await writeSkill(root, role, TEXT)
    writeFileSync(join(root, 'agency-frontend-developer', 'notes.md'), 'keep me')
    expect(await removeSkill(root, 'frontend-developer')).toEqual({ ok: true })
    expect(existsSync(join(root, 'agency-frontend-developer', 'notes.md'))).toBe(true)
  })
  it('refuses an id that is not a role id, and a role with no text', async () => {
    expect((await writeSkill(root, { ...role, id: '../evil' }, TEXT)).ok).toBe(false)
    expect((await removeSkill(root, '../evil')).ok).toBe(false)
    expect((await writeSkill(root, role, '  \n')).ok).toBe(false)
  })
})
