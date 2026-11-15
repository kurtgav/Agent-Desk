import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseFrontMatter, roleMeta } from '@shared/role-parse'
import { copyName, deleteCustomRole, saveCustomRole, serializeRole, type SaveContext } from './roles-custom'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentdeck-roles-custom-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const input = { name: 'Release Notes Writer', emoji: '🧾', vibe: 'Turns a diff into notes.', description: 'Writes release notes.', prompt: '# Release Notes Writer\n\nYou write notes.\n' }
const ctx = (over: Partial<SaveContext> = {}): SaveContext => ({ dir, editing: null, otherIds: new Set(), stems: new Set(), ...over })

describe('serializeRole', () => {
  it('writes a file the front matter reader reads back exactly, whatever the text holds', () => {
    const tricky = { ...input, name: 'He said "hi": a <b> & c', vibe: 'line one\nline two', description: "It's: fine #1", emoji: '👩🏽‍💻' }
    const text = serializeRole(tricky)
    const fm = parseFrontMatter(text)!
    const meta = roleMeta(fm.fields)!
    expect(meta).toMatchObject({ name: 'He said "hi": a <b> & c', vibe: 'line one line two', description: "It's: fine #1", emoji: '👩🏽‍💻' })
    expect(fm.body.trim()).toBe(tricky.prompt.trim())
  })

  it('normalizes line endings and ends with a newline', () => {
    const text = serializeRole({ ...input, prompt: 'a\r\nb\rc' })
    expect(text).not.toContain('\r')
    expect(text.endsWith('\n')).toBe(true)
  })

  it('leaves out an empty one-liner', () => {
    expect(serializeRole({ ...input, vibe: '' })).not.toContain('vibe:')
  })
})

describe('saveCustomRole', () => {
  it('creates <slug>.md atomically and leaves nothing else in the folder', async () => {
    const r = await saveCustomRole(input, ctx())
    expect(r).toEqual({ ok: true, stem: 'release-notes-writer' })
    expect(readdirSync(dir)).toEqual(['release-notes-writer.md'])
    expect(readFileSync(join(dir, 'release-notes-writer.md'), 'utf8')).toContain('name: "Release Notes Writer"')
  })

  it('creates the folder when it is not there yet', async () => {
    const nested = join(dir, 'a', 'roles')
    expect((await saveCustomRole(input, ctx({ dir: nested }))).ok).toBe(true)
    expect(existsSync(join(nested, 'release-notes-writer.md'))).toBe(true)
  })

  it('refuses a name that another role already uses, from any source', async () => {
    const r = await saveCustomRole(input, ctx({ otherIds: new Set(['release-notes-writer']) }))
    expect(r).toMatchObject({ ok: false, field: 'name' })
    expect(readdirSync(dir)).toEqual([])
  })

  it('edits in place: the file name stays when the name changes, and its own slug is not a clash', async () => {
    await saveCustomRole(input, ctx())
    const same = await saveCustomRole({ ...input, description: 'Changed.' }, ctx({ editing: 'release-notes-writer', stems: new Set(['release-notes-writer']) }))
    expect(same).toEqual({ ok: true, stem: 'release-notes-writer' })
    const renamed = await saveCustomRole({ ...input, name: 'Changelog Writer' }, ctx({ editing: 'release-notes-writer', stems: new Set(['release-notes-writer']) }))
    expect(renamed).toEqual({ ok: true, stem: 'release-notes-writer' })
    expect(readdirSync(dir)).toEqual(['release-notes-writer.md'])
    expect(readFileSync(join(dir, 'release-notes-writer.md'), 'utf8')).toContain('Changelog Writer')
  })

  it('does not let a rename land on another role\'s name', async () => {
    const r = await saveCustomRole({ ...input, name: 'Taken' }, ctx({ editing: 'release-notes-writer', otherIds: new Set(['taken']) }))
    expect(r).toMatchObject({ ok: false, field: 'name' })
  })

  it('validates with the same rules as the form, naming the field', async () => {
    expect(await saveCustomRole({ ...input, name: '' }, ctx())).toMatchObject({ ok: false, field: 'name' })
    expect(await saveCustomRole({ ...input, prompt: ' ' }, ctx())).toMatchObject({ ok: false, field: 'prompt' })
    expect(await saveCustomRole({ ...input, emoji: 'x' }, ctx())).toMatchObject({ ok: false, field: 'emoji' })
    expect(readdirSync(dir)).toEqual([])
  })

  it('never builds a path from the name: a hostile name becomes a plain slug inside the folder', async () => {
    const r = await saveCustomRole({ ...input, name: '../../Windows/evil' }, ctx())
    expect(r).toEqual({ ok: true, stem: 'windows-evil' })
    expect(readdirSync(dir)).toEqual(['windows-evil.md'])
  })

  it('reports a folder it cannot write to instead of throwing', async () => {
    const file = join(dir, 'a-file')
    writeFileSync(file, 'x')
    const r = await saveCustomRole(input, ctx({ dir: join(file, 'sub') }))
    expect(r).toMatchObject({ ok: false })
  })
})

describe('deleteCustomRole', () => {
  it('removes the role\'s file', async () => {
    await saveCustomRole(input, ctx())
    expect(await deleteCustomRole(dir, 'release-notes-writer')).toEqual({ ok: true })
    expect(readdirSync(dir)).toEqual([])
  })

  it('refuses anything that is not a plain file stem, and says so when the file is gone', async () => {
    for (const stem of ['../x', '..\\x', 'a/b', '', 'UPPER', '.hidden']) expect(await deleteCustomRole(dir, stem)).toMatchObject({ ok: false })
    expect(await deleteCustomRole(dir, 'not-there')).toMatchObject({ ok: false })
  })
})

describe('copyName', () => {
  it('adds (copy), then (copy 2), and keeps the whole name within the limit', () => {
    expect(copyName('Frontend Developer', () => false)).toBe('Frontend Developer (copy)')
    expect(copyName('Frontend Developer', (n) => n === 'Frontend Developer (copy)')).toBe('Frontend Developer (copy 2)')
    const long = copyName('x'.repeat(80), () => false)
    expect(long.length).toBeLessThanOrEqual(60)
    expect(long.endsWith(' (copy)')).toBe(true)
  })
})
