import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CAPABILITY_CAPS, TOOL_RULE, type ConsoleBody, type ConsoleCapabilities } from '@shared/console'
import { StreamMapper } from './console-parse'
import { allowRuleFor, mcpServerKey, mcpServerLabel, parseMcpTool, summarizeTool } from './console-text'

// test/fixtures/console/init-real.jsonl: the real Claude Code 2.1.323 init, commands_changed, a local /mcp command, /clear (a
// conversation_reset and a second init), with names made generic and paths removed.
const lines = readFileSync(fileURLToPath(new URL('../../test/fixtures/console/init-real.jsonl', import.meta.url)), 'utf8').split('\n').filter(Boolean)

const caps = (drafts: ConsoleBody[]): ConsoleCapabilities[] => drafts.flatMap((d) => (d.kind === 'capabilities' ? [d.capabilities] : []))

function run(input: string[] = lines) {
  const m = new StreamMapper('C:\\work\\demo-app', false)
  const mapped = input.map((l) => m.map(l))
  return { mapped, drafts: mapped.flatMap((x) => x.drafts) }
}

describe('what a conversation can use (the real init)', () => {
  const { mapped, drafts } = run()
  const [first, withDescriptions, afterClear] = caps(drafts)

  it('reports the model in use and the version, and keeps the protocol flags apart', () => {
    expect(first).toMatchObject({ model: 'claude-sonnet-5-5', claudeVersion: '2.1.323', outputStyle: 'Proactive' })
    expect(mapped[0]?.init).toMatchObject({ sessionId: '00000000-0000-4000-8000-0000000000a1', model: 'claude-sonnet-5-5', protocol: expect.arrayContaining(['interrupt_cancel_queued_v1']) })
  })

  it('lists MCP servers with their status and how many tools each offers (counted from the tool list)', () => {
    expect(first!.mcpServers).toEqual([
      { name: 'claude.ai Docs', status: 'connected', tools: 4 }, { name: 'claude.ai Mail', status: 'connected', tools: 3 }, { name: 'claude.ai Chat', status: 'pending', tools: 0 },
      { name: 'plugin:demo:demo', status: 'needs-auth', tools: 0 }, { name: 'plugin:demo:palette', status: 'connected', tools: 2 }, { name: 'notes', status: 'failed', tools: 0 },
      { name: 'local-tools', status: 'connected', tools: 2 }
    ])
  })

  it('marks skills among the commands, and sets the interactive-only ones apart', () => {
    const kind = (n: string) => first!.commands.find((c) => c.name === n)?.kind
    expect(kind('demo-help')).toBe('skill')
    expect(kind('aside')).toBe('skill')
    expect(kind('compact')).toBe('command')
    expect(kind('plugin-a:review-pr')).toBe('skill')
    expect(first!.terminalOnly).toEqual(['doctor', 'color', 'focus', 'reload-plugins'])
    expect(first!.commands.map((c) => c.name)).not.toContain('doctor')
  })

  it('names agents and plugins and drops their paths and sources', () => {
    expect(first!.agents.map((a) => a.name)).toEqual(['Explore', 'Plan', 'code-reviewer'])
    expect(first!.plugins).toEqual([{ name: 'plugin-a', version: '1.4.0' }])
    expect(JSON.stringify(first)).not.toMatch(/someone|plugins\\\\|plugin-a@market/)
  })

  it('puts the built-in tools before the MCP tools', () => {
    const t = first!.tools
    expect(t.findIndex((x) => x.startsWith('mcp__'))).toBeGreaterThan(t.findLastIndex((x) => !x.startsWith('mcp__')) - 1)
    expect(t).toContain('mcp__claude_ai_Docs__tool_1')
  })

  it('adds descriptions and argument hints when commands_changed arrives, without losing the skill marks', () => {
    expect(first!.commands.find((c) => c.name === 'compact')?.description).toBe('')
    const review = withDescriptions!.commands.find((c) => c.name === 'plugin-a:review-pr')
    expect(review).toMatchObject({ kind: 'skill', description: 'Review a pull request.', hint: '[pr-number]' })
    expect(withDescriptions!.commands.map((c) => c.name)).toContain('plugin-a:release-notes')
  })

  it('shows a local command as a normal message, free, and /clear as a notice with a new session', () => {
    expect(drafts.find((d) => d.kind === 'assistant-text')).toMatchObject({ text: expect.stringContaining('7 MCP server(s)'), final: true })
    expect(drafts.find((d) => d.kind === 'turn-end')).toMatchObject({ costUsd: 0, totalCostUsd: 0, error: null })
    expect(drafts.find((d) => d.kind === 'notice')).toMatchObject({ level: 'info', text: expect.stringContaining('Conversation cleared') })
    expect(mapped.at(-1)?.init?.sessionId).toBe('00000000-0000-4000-8000-0000000000a2')
    expect(afterClear).toBeDefined()
  })
})

describe('capabilities are read defensively and kept small', () => {
  it('survives an init with nothing, odd types and hostile strings', () => {
    const m = new StreamMapper('C:\\p', false)
    const out = m.map(JSON.stringify({
      type: 'system', subtype: 'init', session_id: 's', tools: [1, null, 'Read', 'mcp__a__b'], mcp_servers: [null, { name: 5 }, { name: 'a', status: 'weird' }, { name: 'sk-ant-api03-ABCDEFGHIJKLMNOP', status: 'connected' }],
      slash_commands: 'nope', skills: [{}], agents: [''], plugins: ['x', { name: 'p' }]
    }))
    const c = caps(out.drafts)[0]!
    expect(c.tools).toEqual(['Read', 'mcp__a__b'])
    expect(c.mcpServers).toEqual([{ name: 'a', status: 'unknown', tools: 1 }, { name: '•••', status: 'connected', tools: 0 }])
    expect(c.commands).toEqual([])
    expect(c.plugins).toEqual([{ name: 'p', version: null }])
  })

  it('caps every list and clips every string', () => {
    const many = (n: number, f: (i: number) => unknown) => Array.from({ length: n }, (_, i) => f(i))
    const m = new StreamMapper('C:\\p', false)
    const out = m.map(JSON.stringify({
      type: 'system', subtype: 'init', session_id: 's', tools: many(5_000, (i) => `mcp__s__t${i}`), mcp_servers: many(500, (i) => ({ name: `s${i}`, status: 'connected' })),
      slash_commands: many(5_000, (i) => `c${i}`), skills: [], agents: many(5_000, (i) => `a${i}`), plugins: many(500, (i) => ({ name: `p${i}` }))
    }))
    const c = caps(out.drafts)[0]!
    expect(c.tools).toHaveLength(CAPABILITY_CAPS.tools)
    expect(c.mcpServers).toHaveLength(CAPABILITY_CAPS.mcpServers)
    expect(c.commands).toHaveLength(CAPABILITY_CAPS.commands)
    expect(c.agents).toHaveLength(CAPABILITY_CAPS.agents)
    expect(c.plugins).toHaveLength(CAPABILITY_CAPS.plugins)
    const long = m.map(JSON.stringify({ type: 'system', subtype: 'commands_changed', commands: [{ name: 'x'.repeat(500), description: 'd'.repeat(5_000), argumentHint: 'h'.repeat(500) }] }))
    const cmd = caps(long.drafts)[0]!.commands[0]!
    expect(cmd.name.length).toBeLessThanOrEqual(CAPABILITY_CAPS.name + 1)
    expect(cmd.description.length).toBeLessThanOrEqual(CAPABILITY_CAPS.description + 1)
  })

  it('applies descriptions that arrive before init once init comes', () => {
    const m = new StreamMapper('C:\\p', false)
    expect(m.map(JSON.stringify({ type: 'system', subtype: 'commands_changed', commands: [{ name: 'aside', description: 'Side question', argumentHint: '<q>' }] })).drafts).toEqual([])
    const c = caps(m.map(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's', slash_commands: ['aside', 'other'], skills: ['aside'] })).drafts)[0]!
    expect(c.commands).toEqual([{ name: 'aside', kind: 'skill', description: 'Side question', hint: '<q>' }])
  })
})

describe('control answers', () => {
  it('maps the response to a control request, ok or not, and ignores one without an id', () => {
    const m = new StreamMapper('C:\\p', false)
    expect(m.map(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'ad_1' } })).control).toEqual({ requestId: 'ad_1', ok: true })
    expect(m.map(JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: 'ad_2', error: 'no' } })).control).toEqual({ requestId: 'ad_2', ok: false })
    expect(m.map(JSON.stringify({ type: 'control_response', response: { subtype: 'success' } })).control).toBeUndefined()
  })
})

describe('MCP tools in a conversation', () => {
  it.each([
    ['mcp__claude_ai_Figma__whoami', { server: 'claude_ai_Figma', tool: 'whoami' }],
    ['mcp__plugin_ui-color-palette_ui-color-palette__get_palette', { server: 'plugin_ui-color-palette_ui-color-palette', tool: 'get_palette' }],
    ['mcp__caveman__caveman_stats', { server: 'caveman', tool: 'caveman_stats' }],
    ['Read', null], ['mcp__', null], ['mcp__only', null]
  ])('parses %s', (name, parsed) => {
    expect(parseMcpTool(name)).toEqual(parsed)
  })

  it.each([
    ['claude_ai_Figma', 'Figma'], ['claude_ai_Google_Drive', 'Google Drive'], ['plugin_ui-color-palette_ui-color-palette', 'ui-color-palette'], ['caveman', 'caveman'], ['my_notes', 'my notes']
  ])('labels the server %s as %s', (server, label) => {
    expect(mcpServerLabel(server)).toBe(label)
  })

  it('matches a server name to the prefix of its tools', () => {
    expect(mcpServerKey('claude.ai Figma')).toBe('claude_ai_Figma')
    expect(mcpServerKey('plugin:ui-color-palette:ui-color-palette')).toBe('plugin_ui-color-palette_ui-color-palette')
  })

  it('summarises a call as the server and the tool', () => {
    expect(summarizeTool('mcp__claude_ai_Figma__whoami', {}, 'C:\\p')).toBe('Figma · whoami')
    expect(summarizeTool('mcp__caveman__caveman_stats', {}, 'C:\\p')).toBe('caveman · caveman_stats')
  })

  it('offers a rule for what was denied, when a safe one exists', () => {
    expect(allowRuleFor('mcp__claude_ai_Figma__whoami', {})).toBe('mcp__claude_ai_Figma__whoami')
    expect(allowRuleFor('Edit', { file_path: 'a' })).toBe('Edit')
    expect(allowRuleFor('Bash', { command: 'npm test' })).toBe('Bash(npm test)')
    expect(allowRuleFor('Bash', { command: 'npm test -- --run' })).toBe('Bash(npm test -- --run)')
    for (const unsafe of ['rm -rf / && echo', 'echo "x"', 'cat a | grep b', 'echo $HOME', 'a; b', 'x'.repeat(300), '']) expect(allowRuleFor('Bash', { command: unsafe }), unsafe).toBeNull()
    expect(allowRuleFor('Bash', undefined)).toBeNull()
    expect(allowRuleFor('Weird Tool', {})).toBeNull()
  })

  it('puts that rule on the denied event, from the result’s own list of denials', () => {
    const m = new StreamMapper('C:\\p', false)
    const end = m.map(JSON.stringify({ type: 'result', subtype: 'success', permission_denials: [
      { tool_name: 'mcp__claude_ai_Figma__whoami', tool_use_id: 't1', tool_input: {} }, { tool_name: 'Bash', tool_use_id: 't2', tool_input: { command: 'npm test' } }, { tool_name: 'Bash', tool_use_id: 't3', tool_input: { command: 'a && b' } }
    ] }))
    expect(end.drafts.filter((d) => d.kind === 'permission-denied').map((d) => [d.kind === 'permission-denied' && d.summary, d.kind === 'permission-denied' && d.rule])).toEqual([
      ['Figma · whoami', 'mcp__claude_ai_Figma__whoami'], ['Run: npm test', 'Bash(npm test)'], ['Run: a && b', null]
    ])
    for (const d of end.drafts) if (d.kind === 'permission-denied' && d.rule) expect(TOOL_RULE.test(d.rule)).toBe(true)
  })
})
