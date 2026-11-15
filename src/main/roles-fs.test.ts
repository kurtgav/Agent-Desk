import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HEAD_BYTES, ROLE_FILE_MAX, inside, readCapped, readHead, readInside, realDir, walkMarkdown, writeAtomic } from './roles-fs'

let root: string
let outside: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agentdeck-roles-fs-'))
  outside = mkdtempSync(join(tmpdir(), 'agentdeck-roles-out-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

const put = (rel: string, text = '---\nname: X\n---\nbody'): string => {
  const file = join(root, rel)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, text)
  return file
}

/** A link that may not be creatable (file links need a privilege on Windows); the test is skipped by the caller when it is not. */
function tryLink(target: string, link: string, type: 'file' | 'junction'): boolean {
  try {
    symlinkSync(target, link, type)
    return true
  } catch {
    return false
  }
}

describe('inside', () => {
  it('is true for the root and below, false for a sibling, a parent and a prefix lookalike', () => {
    expect(inside('C:\\a\\b', 'C:\\a\\b')).toBe(true)
    expect(inside('C:\\a\\b', 'C:\\a\\b\\c\\d.md')).toBe(true)
    expect(inside('C:\\a\\b', 'C:\\a\\bc')).toBe(false)
    expect(inside('C:\\a\\b', 'C:\\a')).toBe(false)
    expect(inside('C:\\a\\b', 'C:\\a\\b\\..\\x')).toBe(false)
  })
})

describe('walkMarkdown', () => {
  it('finds .md files, skipping hidden folders, README-like files and the named top folders, but not role files that start with such a word', async () => {
    put('engineering/engineering-a.md')
    put('security/security-architect.md')
    put('security/SECURITY.md')
    put('engineering/README.md')
    put('engineering/notes.txt')
    put('.github/workflows/x.md')
    put('integrations/claude-code/y.md')
    put('strategy/playbook.md')
    put('CONTRIBUTING.md')
    const { files } = await walkMarkdown(root, { maxDepth: 3, skipTop: new Set(['integrations', 'strategy']) })
    expect(files.map((f) => f.rel).sort()).toEqual(['engineering/engineering-a.md', 'security/security-architect.md'])
  })

  it('stops at the depth limit', async () => {
    put('a/b/c/d/deep.md')
    put('a/b/ok.md')
    const { files } = await walkMarkdown(root, { maxDepth: 2 })
    expect(files.map((f) => f.rel)).toEqual(['a/b/ok.md'])
  })

  it('does not follow a directory link (a junction) out of the root', async () => {
    writeFileSync(join(outside, 'secret.md'), '---\nname: Secret\n---\n')
    mkdirSync(join(root, 'engineering'))
    put('engineering/ok.md')
    if (!tryLink(outside, join(root, 'engineering', 'linked'), 'junction')) return
    const { files } = await walkMarkdown(root, { maxDepth: 3 })
    expect(files.map((f) => f.rel)).toEqual(['engineering/ok.md'])
  })

  it('refuses a file link that leads outside the root, and counts it', async () => {
    const target = join(outside, 'secret.md')
    writeFileSync(target, '---\nname: Secret\n---\n')
    put('engineering/ok.md')
    if (!tryLink(target, join(root, 'engineering', 'evil.md'), 'file')) return
    const { files, refused } = await walkMarkdown(root, { maxDepth: 3 })
    expect(files.map((f) => f.rel)).toEqual(['engineering/ok.md'])
    expect(refused).toBe(1)
  })
})

describe('realDir', () => {
  it('answers for a folder, not for a file or a missing path', async () => {
    const file = put('a.md')
    expect(await realDir(root)).toBeTruthy()
    expect(await realDir(file)).toBeNull()
    expect(await realDir(join(root, 'nope'))).toBeNull()
  })
})

describe('readHead and readCapped', () => {
  it('reads only the first HEAD_BYTES of a big file, and reports its whole size', async () => {
    const file = put('big.md', `---\nname: Big\n---\n${'x'.repeat(HEAD_BYTES * 4)}`)
    const head = await readHead(file)
    expect(head?.text.length).toBe(HEAD_BYTES)
    expect(head?.size).toBeGreaterThan(HEAD_BYTES * 4)
    expect(head?.mtimeMs).toBeGreaterThan(0)
  })

  it('answers null for a missing file, a folder, and a file over the cap', async () => {
    expect(await readHead(join(root, 'nope.md'))).toBeNull()
    expect(await readHead(root)).toBeNull()
    expect(await readCapped(root)).toBeNull()
    const big = put('huge.md', 'x'.repeat(ROLE_FILE_MAX + 1))
    expect(await readCapped(big)).toBeNull()
    expect(await readCapped(put('fine.md', 'hello'))).toBe('hello')
  })

  it('readInside refuses a file reached through a directory link that leads outside the root', async () => {
    writeFileSync(join(outside, 'secret.md'), 'outside')
    if (!tryLink(outside, join(root, 'junction'), 'junction')) return
    expect(await readInside(root, join(root, 'junction', 'secret.md'))).toBeNull()
  })

  it('readInside reads a file in the root and refuses a link that now points elsewhere', async () => {
    const ok = put('a.md', 'inside')
    expect(await readInside(root, ok)).toBe('inside')
    const target = join(outside, 'x.md')
    writeFileSync(target, 'outside')
    const link = join(root, 'swapped.md')
    if (!tryLink(target, link, 'file')) return
    expect(await readInside(root, link)).toBeNull()
  })
})

describe('writeAtomic', () => {
  it('writes the file, replaces it, and leaves no temp file behind', async () => {
    const file = join(root, 'role.md')
    await writeAtomic(file, 'one')
    await writeAtomic(file, 'two')
    expect(readdirSync(root)).toEqual(['role.md'])
    expect(await readCapped(file)).toBe('two')
  })

  it('leaves the old file alone and cleans up when the write cannot happen', async () => {
    const file = put('keep.md', 'old')
    await expect(writeAtomic(join(root, 'no-such-dir', 'x.md'), 'new')).rejects.toThrow()
    expect(readdirSync(root).sort()).toEqual(['keep.md'])
    expect(await readCapped(file)).toBe('old')
  })
})
