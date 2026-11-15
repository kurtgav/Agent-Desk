import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFrontMatter, roleMeta } from '@shared/role-parse'
import { ROLE_DESCRIPTION_MAX, ROLE_NAME_MAX, ROLE_PROMPT_MAX, isEmojiLike, isSafeAgentName } from '@shared/roles'

/**
 * The leadership roles AgentDeck ships (resources/roles). Written for AgentDeck, not taken from agency-agents. These checks are
 * structural: every role has the six sections, the front matter a card needs, a text within the limits, and the conventions
 * every one of them keeps. They do not pin any wording.
 */
const DIR = join(process.cwd(), 'resources', 'roles')
const EXPECTED = ['CTO', 'Founding Engineer', 'Head of Design', 'Head of Marketing', 'Head of Product', 'Principal Engineer', 'VP of Engineering']
const SECTIONS = ['Identity and memory', 'Mission', 'Operating rules', 'Deliverables', 'How you communicate', 'What you will not do']

const files = readdirSync(DIR).filter((f) => f.endsWith('.md'))
const roles = files.map((f) => {
  const text = readFileSync(join(DIR, f), 'utf8')
  const fm = parseFrontMatter(text)!
  return { file: f, text, fm, meta: roleMeta(fm.fields)!, body: fm.body.trim() }
})

describe('built-in leadership roles', () => {
  it('are the seven the product promises', () => {
    expect(roles.map((r) => r.meta.name).sort()).toEqual([...EXPECTED].sort())
  })

  it.each(roles.map((r) => [r.meta.name, r] as const))('%s: front matter a card and --agent can use', (_name, r) => {
    expect(r.fm).toBeTruthy()
    expect(r.meta.name.length).toBeLessThanOrEqual(ROLE_NAME_MAX)
    expect(isSafeAgentName(r.meta.name)).toBe(true)
    expect(isEmojiLike(r.meta.emoji)).toBe(true)
    expect(r.meta.description.length).toBeGreaterThan(40)
    expect(r.meta.description.length).toBeLessThanOrEqual(ROLE_DESCRIPTION_MAX)
    expect(r.fm.fields.vibe?.length ?? 0).toBeGreaterThan(20)
    expect(r.fm.fields.vibe!.length).toBeLessThanOrEqual(140)
  })

  it.each(roles.map((r) => [r.meta.name, r] as const))('%s: has every section, in order', (_name, r) => {
    const headings = [...r.body.matchAll(/^## (.+)$/gm)].map((m) => m[1])
    expect(headings).toEqual(SECTIONS)
    expect(r.body.startsWith(`# ${r.meta.name}`)).toBe(true)
  })

  it.each(roles.map((r) => [r.meta.name, r] as const))('%s: 500 to 900 words and within the 64 KB limit', (_name, r) => {
    const words = r.body.match(/[A-Za-z][A-Za-z'’-]*/g)?.length ?? 0
    expect(words).toBeGreaterThanOrEqual(500)
    expect(words).toBeLessThanOrEqual(900)
    expect(Buffer.byteLength(r.body)).toBeLessThanOrEqual(ROLE_PROMPT_MAX)
  })

  it.each(roles.map((r) => [r.meta.name, r] as const))('%s: keeps the shared conventions', (_name, r) => {
    const t = r.body.toLowerCase()
    expect(t).toMatch(/assum/) // states assumptions
    expect(t).toMatch(/trade-?off/) // names trade-offs
    expect(t).toMatch(/smallest/) // the smallest change that fully solves it
    expect(t).toMatch(/irreversible|destructive/) // asks before irreversible or destructive actions
    expect(t).toMatch(/explicit/) // and waits for a yes
    expect(t).toMatch(/next (step|action|move)|next actions/) // gives a next step
  })

  it('carry no markup that could run and no secrets', () => {
    for (const r of roles) {
      expect(r.text).not.toMatch(/<script|<iframe|javascript:/i)
      expect(r.text).not.toMatch(/sk-[A-Za-z0-9]{10,}|api[_-]?key\s*[:=]/i)
    }
  })

  it('each have their own voice: no two share a one-liner or an opening paragraph', () => {
    // body: "# Name", "## Identity and memory", then the opening paragraph.
    const openings = roles.map((r) => r.body.split('\n\n')[2])
    expect(new Set(openings).size).toBe(roles.length)
    expect(new Set(roles.map((r) => r.fm.fields.vibe)).size).toBe(roles.length)
  })
})
