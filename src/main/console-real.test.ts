import { writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { NO_OPTIONS, type ConsoleEvent } from '@shared/console'
import { cleanEnv, resolveClaude } from '../collector/cli'
import { ConsoleHub } from './console-hub'

/**
 * A REAL check against the signed-in Claude Code on this machine, off unless AGENTDECK_REAL_CLAUDE=1. It makes two model turns in
 * one conversation (the first costs about $0.5 here: a 130K-token setup is read once; the second reads it from the cache):
 *   (a) a harmless, read-only skill typed as `/name` in a stream-json `-p` message, to see how it runs;
 *   (b) one read-only MCP tool call after allowing exactly that tool live (`apply_flag_settings`), to prove the permission path.
 * It prints nothing of what Claude said beyond a one-line result; AGENTDECK_REAL_OUT=<file> gets a JSON summary (no content, no account).
 * Needs AGENTDECK_REAL_SKILL (e.g. caveman:caveman-help) and AGENTDECK_REAL_MCP (e.g. mcp__claude_ai_Claude_Docs__guide).
 */
const ON = process.env.AGENTDECK_REAL_CLAUDE === '1'
const SKILL = process.env.AGENTDECK_REAL_SKILL ?? ''
const MCP_TOOL = process.env.AGENTDECK_REAL_MCP ?? ''
const events: ConsoleEvent[] = []
const hubs: ConsoleHub[] = []
const makeHub = async (): Promise<ConsoleHub> => {
  const file = await resolveClaude(undefined)
  expect(file, 'Claude Code was not found').toBeTruthy()
  const hub = new ConsoleHub({ command: async () => ({ file: file!, args: [] }), env: cleanEnv, emit: (e) => events.push(e), now: Date.now })
  hubs.push(hub)
  return hub
}

afterAll(async () => {
  for (const h of hubs) h.dispose()
  await new Promise((r) => setTimeout(r, 500))
})

const until = async (what: string, ok: () => boolean, ms: number): Promise<void> => {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}. Events: ${events.map((e) => e.kind).join(',')}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}
const idleCount = (): number => events.filter((e) => e.kind === 'state' && e.state === 'idle').length
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, 100)

describe.skipIf(!ON)('the real Claude Code: a skill and an MCP tool from the Console', () => {
  it('runs a skill typed as /name, and an allowed MCP tool', async () => {
    const hub = await makeHub()
    const started = await hub.start({ cwd: process.cwd(), prompt: `/${SKILL}`, model: null, effort: 'low', permissionMode: 'default', resume: null, options: NO_OPTIONS })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    await until('the skill turn to finish', () => idleCount() >= 1, 150_000)

    const caps = events.filter((e) => e.kind === 'capabilities').at(-1)
    const c = caps?.kind === 'capabilities' ? caps.capabilities : null
    const skillTurn = events.filter((e) => e.kind === 'turn-end')[0]
    const skillText = events.filter((e) => e.kind === 'assistant-text' && e.final).at(-1)
    const summary: Record<string, unknown> = {
      model: c?.model, claudeVersion: c?.claudeVersion,
      servers: c?.mcpServers.map((s) => `${s.status}:${s.tools}`).sort().join(' '),
      counts: { skills: c?.commands.filter((x) => x.kind === 'skill').length, commands: c?.commands.filter((x) => x.kind === 'command').length, agents: c?.agents.length, plugins: c?.plugins.length, tools: c?.tools.length, terminalOnly: c?.terminalOnly },
      describedCommands: c?.commands.filter((x) => x.description).length,
      skillListed: c?.commands.find((x) => x.name === SKILL)?.kind ?? null,
      skill: {
        turnEnd: skillTurn?.kind === 'turn-end' ? { cost: skillTurn.costUsd, total: skillTurn.totalCostUsd, ms: skillTurn.durationMs, error: skillTurn.error } : null,
        toolCalls: events.filter((e) => e.kind === 'tool-use').map((e) => (e.kind === 'tool-use' ? e.summary : '')),
        ranAsModelTurn: skillTurn?.kind === 'turn-end' && (skillTurn.outputTokens ?? 0) > 0,
        firstLine: skillText?.kind === 'assistant-text' ? oneLine(skillText.text) : null
      }
    }
    expect(c?.commands.some((x) => x.name === SKILL && x.kind === 'skill')).toBe(true)

    summary.mcpToolListed = c?.tools.includes(MCP_TOOL) ?? false
    if (MCP_TOOL) {
      // Allowed live, with no restart: apply_flag_settings, then the call.
      const before = events.length
      const allowed = await hub.allow(started.id, MCP_TOOL)
      summary.allow = allowed.ok ? { ok: true } : { ok: false, error: allowed.error, restart: allowed.restart }
      expect(allowed.ok).toBe(true)
      hub.send(started.id, `Call the tool ${MCP_TOOL} once, with items ["topic.index"]. If the tool is not loaded yet, load it first with ToolSearch. Then reply with one short line saying whether the call worked. Do not call any other tool.`)
      await until('the MCP turn to finish', () => idleCount() >= 2, 150_000)
      const mine = events.slice(before)
      const use = mine.find((e) => e.kind === 'tool-use' && e.name === MCP_TOOL)
      const result = mine.find((e) => e.kind === 'tool-result' && use?.kind === 'tool-use' && e.toolUseId === use.toolUseId)
      const end = mine.filter((e) => e.kind === 'turn-end').at(-1)
      const text = mine.filter((e) => e.kind === 'assistant-text' && e.final).at(-1)
      summary.mcp = {
        called: use?.kind === 'tool-use' ? use.summary : null,
        resultOk: result?.kind === 'tool-result' ? result.ok : null,
        resultChars: result?.kind === 'tool-result' ? result.text.length : null,
        denied: mine.some((e) => e.kind === 'permission-denied'),
        turnEnd: end?.kind === 'turn-end' ? { cost: end.costUsd, total: end.totalCostUsd, ms: end.durationMs } : null,
        firstLine: text?.kind === 'assistant-text' ? oneLine(text.text) : null
      }
    }
    if (process.env.AGENTDECK_REAL_OUT) writeFileSync(process.env.AGENTDECK_REAL_OUT, JSON.stringify(summary, null, 2))
    expect(events.some((e) => e.kind === 'state' && e.state === 'failed')).toBe(false)
  }, 400_000)

  // Costs nothing: /context answers locally. Proves the real CLI takes --resume <id> --fork-session together, and reports a new id.
  it('forks a session on the real command line', async () => {
    const hub = await makeHub()
    const idle = (from: number): boolean => events.slice(from).some((e) => e.kind === 'state' && (e.state === 'idle' || e.state === 'failed'))
    const firstAt = events.length
    const a = await hub.start({ cwd: process.cwd(), prompt: '/context', model: null, effort: 'low', permissionMode: 'default', resume: null, options: NO_OPTIONS })
    expect(a.ok).toBe(true)
    if (!a.ok) return
    await until('the first local command', () => idle(firstAt), 90_000)
    const original = hub.list().find((c) => c.id === a.id)?.sessionId ?? null
    const forkAt = events.length
    const b = await hub.start({ cwd: process.cwd(), prompt: '/context', model: null, effort: 'low', permissionMode: 'default', resume: original, fork: true, forkOf: 'original', options: NO_OPTIONS })
    expect(b.ok).toBe(true)
    if (!b.ok) return
    await until('the forked local command', () => idle(forkAt), 90_000)
    const copy = hub.list().find((c) => c.id === b.id)
    const failed = events.slice(forkAt).find((e) => e.kind === 'state' && e.state === 'failed')
    if (process.env.AGENTDECK_REAL_OUT) {
      writeFileSync(`${process.env.AGENTDECK_REAL_OUT}.fork.json`, JSON.stringify({
        originalKnown: original !== null, forkKnown: copy?.sessionId != null, newId: original !== null && copy?.sessionId != null && copy.sessionId !== original,
        title: copy?.title, fork: copy?.fork ? { name: copy.fork.name } : null, state: copy?.state, error: failed?.kind === 'state' ? failed.error : null
      }, null, 2))
    }
  }, 240_000)

  // Costs nothing: /context answers locally. Proves the real CLI takes our --allowedTools / --add-dir / --append-system-prompt arguments.
  it('starts with the Advanced options on the real command line', async () => {
    const hub = await makeHub()
    const before = events.length
    const options = { ...NO_OPTIONS, allowedTools: MCP_TOOL ? [MCP_TOOL, 'Read'] : ['Read'], appendSystemPrompt: 'Be brief.' }
    const r = await hub.start({ cwd: process.cwd(), prompt: '/context', model: null, effort: 'low', permissionMode: 'default', resume: null, options })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    await until('the local command to finish', () => events.slice(before).some((e) => e.kind === 'state' && (e.state === 'idle' || e.state === 'failed')), 90_000)
    const mine = events.slice(before)
    const end = mine.find((e) => e.kind === 'turn-end')
    const failed = mine.find((e) => e.kind === 'state' && e.state === 'failed')
    if (process.env.AGENTDECK_REAL_OUT) writeFileSync(`${process.env.AGENTDECK_REAL_OUT}.options.json`, JSON.stringify({ failed: failed?.kind === 'state' ? failed.error : null, cost: end?.kind === 'turn-end' ? end.costUsd : null, allowedEvent: mine.some((e) => e.kind === 'allowed') }, null, 2))
    expect(failed).toBeUndefined()
    expect(end?.kind === 'turn-end' ? end.costUsd : null).toBe(0)
  }, 120_000)
})
