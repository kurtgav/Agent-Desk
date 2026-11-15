import { CAPABILITY_CAPS, type CommandInfo, type ConsoleCapabilities, type McpServerInfo, type McpStatus } from '@shared/console'
import { cap, maskSecrets } from '../collector/redact'
import { arr, isRec, mcpServerKey, str } from './console-text'

/**
 * What a conversation can use, read from `system/init` (Claude Code 2.1.323: `model`, `tools`, `mcp_servers` [{name, status, source}],
 * `slash_commands`, `skills`, `agents`, `plugins` [{name, path, source, version}], `terminal_slash_commands`, `output_style`,
 * `claude_code_version`) and `system/commands_changed` (`commands` [{name, description, argumentHint}]). Names only: plugin paths,
 * sources and config never leave this file. Everything is masked, clipped and capped.
 */

const clip = (s: string, max: number): string => cap(maskSecrets(s.trim().replace(/\s+/g, ' ')), max)
const strings = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === 'string' && x.length > 0)

const STATUS: Record<string, McpStatus> = {
  connected: 'connected',
  pending: 'pending',
  'needs-auth': 'needs-auth',
  failed: 'failed',
  disabled: 'disabled'
}
export const mcpStatus = (s: unknown): McpStatus => STATUS[str(s)] ?? 'unknown'

/** Descriptions by command name, from `commands_changed` (null when the message has none we can read). */
export function describedCommands(m: Record<string, unknown>): CommandInfo[] | null {
  const list = arr(m.commands)
  if (list.length === 0) return null
  return list
    .filter(isRec)
    .filter((c) => str(c.name))
    .slice(0, CAPABILITY_CAPS.commands)
    .map((c) => ({ name: clip(str(c.name), CAPABILITY_CAPS.name), kind: 'command' as const, description: clip(str(c.description), CAPABILITY_CAPS.description), hint: clip(str(c.argumentHint), 80) }))
}

/** The commands to show: Claude Code's own list with descriptions when it sent one, else the bare names from init; skills marked. */
function commandsOf(names: string[], skills: Set<string>, described: CommandInfo[] | null): CommandInfo[] {
  const base = described ?? names.slice(0, CAPABILITY_CAPS.commands).map((n): CommandInfo => ({ name: clip(n, CAPABILITY_CAPS.name), kind: 'command', description: '', hint: '' }))
  return base.map((c) => ({ ...c, kind: skills.has(c.name) ? 'skill' : 'command' }))
}

function serversOf(list: unknown, tools: string[]): McpServerInfo[] {
  return arr(list)
    .filter(isRec)
    .filter((s) => str(s.name))
    .slice(0, CAPABILITY_CAPS.mcpServers)
    .map((s) => {
      const prefix = `mcp__${mcpServerKey(str(s.name))}__`
      return { name: clip(str(s.name), CAPABILITY_CAPS.name), status: mcpStatus(s.status), tools: tools.filter((t) => t.startsWith(prefix)).length }
    })
}

/** Built-in tools first, then the MCP tools, so the capped list keeps the ones that matter most to a person. */
const orderedTools = (tools: string[]): string[] =>
  [...tools.filter((t) => !t.startsWith('mcp__')), ...tools.filter((t) => t.startsWith('mcp__'))].slice(0, CAPABILITY_CAPS.tools).map((t) => cap(t, CAPABILITY_CAPS.name))

export function capabilitiesFromInit(m: Record<string, unknown>, described: CommandInfo[] | null): ConsoleCapabilities {
  const tools = strings(m.tools)
  const skills = new Set(strings(m.skills))
  return {
    model: str(m.model) ? clip(str(m.model), 80) : null,
    claudeVersion: str(m.claude_code_version) ? clip(str(m.claude_code_version), 40) : null,
    outputStyle: str(m.output_style) ? clip(str(m.output_style), 60) : null,
    mcpServers: serversOf(m.mcp_servers, tools),
    commands: commandsOf(strings(m.slash_commands), skills, described),
    agents: strings(m.agents).slice(0, CAPABILITY_CAPS.agents).map((name) => ({ name: clip(name, CAPABILITY_CAPS.name), description: '' })),
    plugins: arr(m.plugins)
      .filter(isRec)
      .filter((p) => str(p.name))
      .slice(0, CAPABILITY_CAPS.plugins)
      .map((p) => ({ name: clip(str(p.name), CAPABILITY_CAPS.name), version: str(p.version) ? clip(str(p.version), 30) : null })),
    tools: orderedTools(tools),
    terminalOnly: strings(m.terminal_slash_commands).slice(0, 40).map((s) => clip(s, 60))
  }
}

/** `commands_changed` arrives after init with the descriptions (and sometimes more commands): fold them in. */
export function withDescriptions(caps: ConsoleCapabilities, described: CommandInfo[]): ConsoleCapabilities {
  const skills = new Set(caps.commands.filter((c) => c.kind === 'skill').map((c) => c.name))
  return { ...caps, commands: commandsOf([], skills, described) }
}
