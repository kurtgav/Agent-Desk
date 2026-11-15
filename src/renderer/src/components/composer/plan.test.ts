import { describe, expect, it } from 'vitest'
import { parseMentions } from './mentions'
import { overLimit, planBackground, planSend } from './plan'
import type { RoleLookup } from './types'

const NAMES: Record<string, string> = { cto: 'CTO', qa: 'QA', 'frontend-developer': 'Frontend Developer', 'seo-specialist': 'SEO Specialist', a: 'A', b: 'B', c: 'C', d: 'D', e: 'E', f: 'F' }
const AGENTS: Record<string, string> = { cto: 'CTO', 'frontend-developer': 'Frontend Developer' }
const roles: RoleLookup = { name: (id) => NAMES[id] ?? id, agent: (id) => AGENTS[id] ?? null }
const spansOf = (text: string) => parseMentions(text, (id) => id in NAMES)

describe('a new session', () => {
  it('runs as the first mention, with the others as helpers, and sends the message with names', () => {
    const text = '@cto @qa plan the launch'
    expect(planSend('new-session', text, spansOf(text), roles)).toEqual({ ok: true, kind: 'new-session', prompt: '@CTO @QA plan the launch', role: 'cto', helpers: ['qa'] })
  })

  it('has no role when nobody is mentioned', () => {
    expect(planSend('new-session', 'fix the bug', [], roles)).toEqual({ ok: true, kind: 'new-session', prompt: 'fix the bug', role: null, helpers: [] })
  })

  it('counts a repeated mention once', () => {
    const text = '@cto fix it, then ask @qa and @cto again'
    expect(planSend('new-session', text, spansOf(text), roles)).toMatchObject({ role: 'cto', helpers: ['qa'] })
  })

  it('takes a lead and four helpers, and says what to take out beyond that', () => {
    const four = '@a @b @c @d @e go'
    expect(planSend('new-session', four, spansOf(four), roles)).toMatchObject({ ok: true, role: 'a', helpers: ['b', 'c', 'd', 'e'] })
    const five = '@a @b @c @d @e @f go'
    expect(planSend('new-session', five, spansOf(five), roles)).toEqual({ ok: false, reason: 'One lead and 4 helpers at most. Take out 1 mention' })
  })

  it('does not send a mention with nothing to say, nor an empty box', () => {
    expect(planSend('new-session', '', [], roles)).toEqual({ ok: false, reason: 'Type a message first' })
    expect(planSend('new-session', '@cto ', spansOf('@cto '), roles)).toEqual({ ok: false, reason: 'Say what you want from @CTO' })
  })
})

describe('the limit on agents', () => {
  it('is a lead and four helpers for a session or a reply, and one agent for a task', () => {
    expect(overLimit('new-session', 5)).toBeNull()
    expect(overLimit('new-session', 7)).toBe('One lead and 4 helpers at most. Take out 2 mentions')
    expect(overLimit('reply', 6)).toBe('One lead and 4 helpers at most. Take out 1 mention')
    expect(overLimit('task', 1)).toBeNull()
    expect(overLimit('task', 3)).toBe('A task has one agent. Take out 2 mentions')
  })

  it('is said even when the mentions are all there is to the message', () => {
    const text = '@a @b @c @d @e @f'
    expect(planSend('new-session', text, spansOf(text), roles)).toEqual({ ok: false, reason: 'Say what you want from @A' })
    expect(overLimit('new-session', 6)).not.toBeNull()
  })
})

describe('a reply', () => {
  it('addresses the agents mentioned for this one message', () => {
    const text = '@qa review this'
    expect(planSend('reply', text, spansOf(text), roles)).toEqual({ ok: true, kind: 'reply', text: '@QA review this', mentions: ['qa'] })
  })

  it('addresses nobody when nobody is mentioned', () => {
    expect(planSend('reply', 'thanks', [], roles)).toEqual({ ok: true, kind: 'reply', text: 'thanks', mentions: [] })
  })
})

describe('a task', () => {
  it('keeps its agent apart from its title', () => {
    const text = '@seo-specialist audit the pricing page'
    expect(planSend('task', text, spansOf(text), roles)).toEqual({ ok: true, kind: 'task', title: 'audit the pricing page', role: 'seo-specialist' })
  })

  it('takes the mention from the middle of the sentence too', () => {
    const text = 'ask @qa about  the build'
    expect(planSend('task', text, spansOf(text), roles)).toMatchObject({ title: 'ask about the build', role: 'qa' })
  })

  it('has one agent at most, and a title', () => {
    expect(planSend('task', '@cto @qa plan', spansOf('@cto @qa plan'), roles)).toEqual({ ok: false, reason: 'A task has one agent. Take out 1 mention' })
    expect(planSend('task', '  ', [], roles)).toEqual({ ok: false, reason: 'Type a task first' })
    expect(planSend('task', 'x'.repeat(201), [], roles)).toEqual({ ok: false, reason: 'Keep the task to 200 characters' })
  })
})

describe('Run in the background', () => {
  it('runs the lead as --agent when it is installed, without its mention in the prompt', () => {
    const text = '@cto plan the launch'
    expect(planBackground(text, spansOf(text), roles)).toEqual({ ok: true, prompt: 'plan the launch', agent: 'CTO' })
  })

  it('calls an installed helper by its agent name, and one that is not by its name', () => {
    const text = '@cto ask @frontend-developer and @qa'
    expect(planBackground(text, spansOf(text), roles)).toEqual({ ok: true, prompt: 'ask @agent-Frontend Developer and @QA', agent: 'CTO' })
  })

  it('says why a lead that is not installed can not run there', () => {
    const text = '@qa test it'
    const r = planBackground(text, spansOf(text), roles)
    expect(r.ok).toBe(false)
    expect(r.ok ? '' : r.reason).toContain('QA is not installed in Claude Code')
  })

  it('says so before the click when the task is longer than a command line takes', () => {
    const r = planBackground('x'.repeat(8_001), [], roles)
    expect(r.ok).toBe(false)
    expect(r.ok ? '' : r.reason).toContain('at most 8,000 characters')
    expect(planBackground('x'.repeat(8_000), [], roles).ok).toBe(true)
  })

  it('runs with no agent when nobody is mentioned', () => {
    expect(planBackground('tidy the repo', [], roles)).toEqual({ ok: true, prompt: 'tidy the repo', agent: null })
    expect(planBackground('', [], roles)).toEqual({ ok: false, reason: 'Type a task first' })
  })
})
