import { describe, expect, it } from 'vitest'
import type { ConsoleBody, ConsoleEvent } from '@shared/console'
import { demoCapabilities, demoConversations, demoMcpList } from './demo'
import { applyHistory, applyLive, emptyThread, type Thread } from './thread'

let n = 0
const ev = (body: ConsoleBody): ConsoleEvent => ({ id: `c_1:${++n}`, conversation: 'c_00000001', seq: n, ts: n, ...body }) as ConsoleEvent
const run = (...bodies: ConsoleBody[]): Thread => bodies.map(ev).reduce(applyLive, emptyThread)

describe('capabilities and allowed tools in the thread', () => {
  it('holds the latest capabilities and the latest allow list (each replaces the last)', () => {
    n = 0
    const first = demoCapabilities()
    const t = run(
      { kind: 'capabilities', capabilities: { ...first, model: 'old' } },
      { kind: 'capabilities', capabilities: first },
      { kind: 'allowed', tools: ['Read'] },
      { kind: 'allowed', tools: ['Read', 'mcp__a__b'] }
    )
    expect(t.capabilities).toBe(first)
    expect(t.allowed).toEqual(['Read', 'mcp__a__b'])
    expect(t.items).toEqual([])
  })

  it('keeps the rule on a denied tool, whichever of the call and the denial comes first', () => {
    n = 0
    const denied: ConsoleBody = { kind: 'permission-denied', toolUseId: 't1', name: 'mcp__s__t', summary: 's · t', rule: 'mcp__s__t' }
    const use: ConsoleBody = { kind: 'tool-use', toolUseId: 't1', name: 'mcp__s__t', summary: 's · t', input: '{}' }
    expect(run(use, denied).items[0]).toMatchObject({ status: 'denied', rule: 'mcp__s__t' })
    n = 0
    expect(run(denied).items[0]).toMatchObject({ status: 'denied', rule: 'mcp__s__t' })
    n = 0
    expect(run(use).items[0]).toMatchObject({ rule: null })
  })
})

describe('the demo conversations show what v1.1 adds', () => {
  const NOW = Date.UTC(2026, 10, 5, 14, 0)
  const threads = Object.fromEntries(demoConversations(NOW).map((c) => [c.info.id, applyHistory(c.events)]))

  it('every conversation reports what it can use, with servers in several states', () => {
    for (const t of Object.values(threads)) expect(t.capabilities?.mcpServers.length).toBeGreaterThan(3)
    const states = new Set(threads['demo-refactor']!.capabilities!.mcpServers.map((s) => s.status))
    expect([...states].sort()).toEqual(['connected', 'failed', 'needs-auth', 'pending'])
    expect(threads['demo-refactor']!.allowed).toEqual(['Bash(npm test:*)'])
  })

  it('has a denied MCP tool with a rule to allow, named as server and tool', () => {
    const tool = threads['demo-mail']!.items.find((i) => i.kind === 'tool')
    expect(tool).toMatchObject({ summary: 'Gmail · list_labels', status: 'denied', rule: 'mcp__claude_ai_Gmail__list_labels' })
  })

  it('has skills, commands and agents for the menus, and a server list for the drawer', () => {
    const caps = demoCapabilities()
    expect(caps.commands.filter((c) => c.kind === 'skill').length).toBeGreaterThan(3)
    expect(caps.commands.filter((c) => c.kind === 'command').map((c) => c.name)).toEqual(expect.arrayContaining(['compact', 'clear', 'context']))
    expect(caps.agents.length).toBeGreaterThan(3)
    const list = demoMcpList()
    expect(list.servers.map((s) => s.name)).toEqual(caps.mcpServers.map((s) => s.name))
    expect(JSON.stringify(list)).not.toMatch(/https?:|token|=/i)
  })
})
