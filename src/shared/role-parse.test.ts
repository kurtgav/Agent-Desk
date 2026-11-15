import { describe, expect, it } from 'vitest'
import { firstSentence, parseFrontMatter, roleMeta } from './role-parse'

const BIDI = String.fromCharCode(0x202e)
const ZWSP = String.fromCharCode(0x200b)

describe('parseFrontMatter', () => {
  it('reads the fields and the body', () => {
    const fm = parseFrontMatter('---\nname: Frontend Developer\ndescription: Builds web apps\nemoji: 🖥️\nvibe: Pixel-perfect.\ncolor: cyan\n---\n\n# Body\nhello')
    expect(fm?.fields).toMatchObject({ name: 'Frontend Developer', description: 'Builds web apps', emoji: '🖥️', vibe: 'Pixel-perfect.', color: 'cyan' })
    expect(fm?.body).toContain('# Body')
  })

  it('handles CRLF line endings and a BOM', () => {
    const fm = parseFrontMatter(`${String.fromCharCode(0xfeff)}---\r\nname: A\r\ndescription: B\r\n---\r\nbody`)
    expect(fm?.fields).toMatchObject({ name: 'A', description: 'B' })
    expect(fm?.body).toBe('body')
  })

  it('keeps colons inside a value', () => {
    expect(parseFrontMatter('---\nname: Test: Quoted & Name\ndescription: Use for: quick wins, big ones\n---\n')?.fields).toMatchObject({
      name: 'Test: Quoted & Name',
      description: 'Use for: quick wins, big ones'
    })
  })

  it('reads quoted values with their escapes', () => {
    const fm = parseFrontMatter(`---\nname: "agency-frontend-developer"\ndescription: 'It''s "fine"'\nvibe: "say \\"hi\\"\\nthen go"\n---\n`)
    expect(fm?.fields.name).toBe('agency-frontend-developer')
    expect(fm?.fields.description).toBe('It\'s "fine"')
    expect(fm?.fields.vibe).toBe('say "hi"\nthen go')
  })

  it('round-trips what JSON.stringify writes (the custom role format)', () => {
    const name = 'Name with "quotes", a colon: and an emoji 👩🏽‍💻'
    expect(parseFrontMatter(`---\nname: ${JSON.stringify(name)}\n---\n`)?.fields.name).toBe(name)
  })

  it('reads folded and literal blocks and plain continuation lines', () => {
    const fm = parseFrontMatter('---\nname: Folded\ndescription: >\n  one\n  two\n\n  three\nvibe: |\n  first\n  second\nother: starts here\n  and goes on\nlast: yes\n---\n')
    expect(fm?.fields.description).toBe('one two three')
    expect(fm?.fields.vibe).toBe('first\nsecond')
    expect(fm?.fields.other).toBe('starts here and goes on')
    expect(fm?.fields.last).toBe('yes')
  })

  it('reads a quoted value that continues on the next line', () => {
    expect(parseFrontMatter('---\ndescription: "one\n  two"\nname: X\n---\n')?.fields).toMatchObject({ description: 'one two', name: 'X' })
  })

  it('lets the first of a repeated key win, ignores unknown and list keys, and lower-cases keys', () => {
    const fm = parseFrontMatter('---\nName: First\nname: Second\ntools:\n  - Read\n  - Edit\nmodel: sonnet\n---\n')
    expect(fm?.fields.name).toBe('First')
    expect(fm?.fields.model).toBe('sonnet')
    expect(fm?.fields.tools).toBe('')
  })

  it('strips a trailing comment from a plain value', () => {
    expect(parseFrontMatter('---\nname: Role # a note\n---\n')?.fields.name).toBe('Role')
  })

  it('returns null without a front matter, without a closing line, or when it is absurdly long', () => {
    expect(parseFrontMatter('# just a heading\nname: x')).toBeNull()
    expect(parseFrontMatter('---\nname: x\nno closing')).toBeNull()
    expect(parseFrontMatter(`---\nname: x\n${'a: b\n'.repeat(20_000)}---\n`)).toBeNull()
  })

  it('does not choke on a huge file', () => {
    const t0 = Date.now()
    const fm = parseFrontMatter(`---\nname: Big\n---\n${'x'.repeat(5_000_000)}`)
    expect(fm?.fields.name).toBe('Big')
    expect(fm?.body.length).toBe(5_000_000)
    expect(Date.now() - t0).toBeLessThan(500)
  })

  it('never throws on garbage', () => {
    for (const s of ['', '---', '---\n', '---\n---', '---\n: no key\n---\n', '---\nname: "unclosed\n---\n', '\0\0\0', '---\nkey: \\u12\n---\n']) {
      expect(() => parseFrontMatter(s)).not.toThrow()
    }
  })

  it('reports where the body starts', () => {
    const text = '---\nname: A\n---\nbody here'
    const fm = parseFrontMatter(text)!
    expect(text.slice(fm.headLength)).toBe('body here')
  })
})

describe('roleMeta', () => {
  it('needs a name', () => {
    expect(roleMeta({ description: 'x' })).toBeNull()
    expect(roleMeta({ name: '   ' })).toBeNull()
    expect(roleMeta({ name: `${BIDI}${ZWSP}` })).toBeNull()
  })

  it('cleans the name of invisible and bidi characters and cuts it at 80', () => {
    expect(roleMeta({ name: `Frontend${BIDI}  ${ZWSP}Developer` })?.name).toBe('Frontend Developer')
    expect(roleMeta({ name: 'x'.repeat(200) })?.name).toHaveLength(80)
  })

  it('keeps hostile names as text: nothing here executes or resolves them', () => {
    for (const name of ['../../etc/passwd', '<script>alert(1)</script>', '--dangerously-skip-permissions', 'a\nb', 'C:\\Windows\\System32']) {
      expect(roleMeta({ name })?.name).toBe(name.replace(/\s+/g, ' '))
    }
  })

  it('falls back to the first sentence for the vibe and to a robot for the emoji', () => {
    const meta = roleMeta({ name: 'X', description: 'Expert in testing things carefully. Also does more of it.', emoji: 'not-an-emoji-at-all-too-long' })
    expect(meta?.vibe).toBe('Expert in testing things carefully.')
    expect(meta?.emoji).toBe('🤖')
    expect(roleMeta({ name: 'X', emoji: '🧭' })?.emoji).toBe('🧭')
  })
})

describe('firstSentence', () => {
  it('cuts at a sentence end and shortens a long one with an ellipsis', () => {
    expect(firstSentence('Short one that is long enough. Second.')).toBe('Short one that is long enough.')
    expect(firstSentence('word '.repeat(60), 40).endsWith('…')).toBe(true)
    expect(firstSentence('')).toBe('')
  })
})
