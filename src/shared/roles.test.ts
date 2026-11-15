import { describe, expect, it } from 'vitest'
import { checkCustomRole, cleanLine, isEmojiLike, isSafeAgentName, slugify, ROLE_NAME_MAX, ROLE_PROMPT_MAX } from './roles'
import { goodFor } from './role-good-for'

describe('slugify', () => {
  it('makes a url-safe id', () => {
    expect(slugify('Frontend Developer')).toBe('frontend-developer')
    expect(slugify('FP&A Analyst')).toBe('fp-and-a-analyst')
    expect(slugify('  3D & Scene Developer! ')).toBe('3d-and-scene-developer')
    expect(slugify('Crème Brûlée')).toBe('creme-brulee')
    expect(slugify('SRE (Site Reliability Engineer)')).toBe('sre-site-reliability-engineer')
  })

  it('never returns a path or an empty id', () => {
    expect(slugify('../../etc/passwd')).toBe('etc-passwd')
    expect(slugify('C:\\Windows')).toBe('c-windows')
    expect(slugify('🧭🧭')).toBe('role')
    expect(slugify('')).toBe('role')
    expect(slugify('a'.repeat(300))).toHaveLength(64)
  })
})

describe('cleanLine', () => {
  it('removes control and bidi characters, keeps joiners, collapses whitespace', () => {
    const bidi = String.fromCharCode(0x202e)
    expect(cleanLine(`  a${bidi}\tb \n c  `)).toBe('a b c')
    expect(cleanLine('👩\u200d💻')).toBe('👩\u200d💻')
  })
})

describe('isSafeAgentName', () => {
  it('accepts the names agents really have', () => {
    for (const n of ['Frontend Developer', 'FP&A Analyst', '3D & Scene Developer', 'SRE (Site Reliability Engineer)', 'code-reviewer', 'Test: Quoted & Name']) expect(isSafeAgentName(n)).toBe(true)
  })

  it('refuses a name that could read as an option or mean something to a shell', () => {
    for (const n of ['--dangerous', '-x', '', ' lead', 'a"b', 'a%PATH%', 'a^b', 'a|b', 'a<b', 'a`b', 'a$b', 'a;b', 'a\\b', 'a!b', 'x'.repeat(81)]) expect(isSafeAgentName(n)).toBe(false)
  })
})

describe('isEmojiLike', () => {
  it('wants one or two pictures', () => {
    for (const e of ['🤖', '🛠️', '👩🏽‍💻', '🇳🇱', '🤖🧠']) expect(isEmojiLike(e)).toBe(true)
    for (const e of ['', 'a', 'ab', '123', '🤖🧠🧭', 'robot 🤖']) expect(isEmojiLike(e)).toBe(false)
  })
})

describe('checkCustomRole', () => {
  const ok = { name: 'Release Notes Writer', emoji: '🧾', description: 'Writes notes.', prompt: '# Role\nDo it.' }

  it('passes a good role', () => {
    expect(checkCustomRole(ok)).toEqual([])
  })

  it('names the field and says what to change', () => {
    const fields = (i: Partial<typeof ok> & { vibe?: string }): string[] => checkCustomRole({ ...ok, ...i }).map((p) => p.field)
    expect(fields({ name: ' ' })).toEqual(['name'])
    expect(fields({ name: 'x'.repeat(ROLE_NAME_MAX + 1) })).toEqual(['name'])
    expect(fields({ emoji: 'x' })).toEqual(['emoji'])
    expect(fields({ vibe: 'v'.repeat(141) })).toEqual(['vibe'])
    expect(fields({ description: '' })).toEqual(['description'])
    expect(fields({ description: 'd'.repeat(401) })).toEqual(['description'])
    expect(fields({ prompt: '' })).toEqual(['prompt'])
    expect(fields({ prompt: 'é'.repeat(ROLE_PROMPT_MAX / 2 + 1) })).toEqual(['prompt'])
  })

  it('counts the prompt in bytes, not characters', () => {
    expect(checkCustomRole({ ...ok, prompt: 'a'.repeat(ROLE_PROMPT_MAX) })).toEqual([])
  })
})

describe('goodFor', () => {
  it('takes the list after "specializing in"', () => {
    expect(goodFor('Expert frontend developer specializing in modern web technologies, React/Vue/Angular frameworks, UI implementation, and performance optimization')).toEqual([
      'Modern web technologies',
      'React/Vue/Angular frameworks',
      'UI implementation',
      'Performance optimization'
    ])
  })

  it('takes the sentence that lists duties and drops its verbs', () => {
    expect(
      goodFor('Expert content strategist and creator for multi-platform campaigns. Develops editorial calendars, creates compelling copy, manages brand storytelling, and optimizes content for engagement.')
    ).toEqual(['Editorial calendars', 'Compelling copy', 'Brand storytelling', 'Content for engagement'])
  })

  it('does not take the "build" in "build versus buy" for a lead-in', () => {
    const out = goodFor('Technology leader who turns business goals into engineering decisions. Weighs architecture, build versus buy, hiring, risk and cost, and tells you which choices are cheap to reverse.')
    expect(out.slice(0, 5)).toEqual(['Architecture', 'Build versus buy', 'Hiring', 'Risk', 'Cost'])
  })

  it('is empty for nothing and at most five for a lot', () => {
    expect(goodFor('')).toEqual([])
    expect(goodFor('Does a, b c d, e f g h, i j k l, m n o p, q r s t, u v w x').length).toBeLessThanOrEqual(5)
  })
})
