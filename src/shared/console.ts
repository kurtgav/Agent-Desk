import type { Effort } from './bridge'

/**
 * The Console: conversations with Claude Code that AgentDeck starts itself, like Claude Desktop or the CLI, through
 * `claude -p --input-format stream-json --output-format stream-json`. AgentDeck makes no model calls: the user's own signed-in
 * Claude Code does, so these use the user's own subscription. Message text lives in memory only (never stored), and
 * AgentDeck never reads transcript files (ADR-0009).
 */

/**
 * `--permission-mode`. `default` asks before edits and commands (and, in `-p`, a call nobody approves is denied).
 * `bypassPermissions` runs every tool without asking: it is only ever sent when the user picks it for a conversation, never by default.
 */
export const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]

/** An image pasted into a message: sent to Claude Code as a base64 `image` content block. Memory only, like all message text. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export type ImageType = (typeof IMAGE_TYPES)[number]
export interface ConsoleImage {
  mediaType: ImageType
  /** Base64, no `data:` prefix. */
  data: string
}
export const IMAGES_MAX = 5
/** The API takes 5 MB per image; this caps the base64 text (about 3.75 MB of picture), which also bounds the IPC message. */
export const IMAGE_BASE64_MAX = 5 * 1024 * 1024

/**
 * `claude --model` aliases on the supported version (2.1.323): `--help` names fable, opus and sonnet; the CLI's own model list
 * (the `initialize` control response) also offers haiku. Any other full model id goes in as a custom model (MODEL_PATTERN).
 */
export const MODEL_ALIASES = ['opus', 'sonnet', 'haiku', 'fable'] as const

/** An alias or a full model name (`claude-sonnet-5-5`, `claude-opus-4-5[1m]`). Starts with a letter or digit, so it can never read as an option. */
export const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._[\]-]{0,63}$/
/** `--fallback-model`: up to three models, comma-separated, each one a MODEL_PATTERN. */
export const FALLBACK_MODELS_MAX = 3
export const isFallbackModels = (s: string): boolean => {
  const parts = s.split(',')
  return parts.length <= FALLBACK_MODELS_MAX && parts.every((p) => MODEL_PATTERN.test(p))
}

/**
 * One permission rule for `--allowedTools` / `--disallowedTools` / the live allow list: a tool name (`Read`, `mcp__server`,
 * `mcp__server__tool`, `mcp__server__*`) or `Tool(specifier)` (`Bash(git status:*)`, `Read(./src/**)`). It starts with a letter and the
 * specifier allows no quote, backtick, `$`, `;`, `&`, `|`, `<`, `>`, `%`, `^`, `!`, comma or line break, so it can neither read as an
 * option nor mean anything to a shell (there is none) or to cmd.exe behind an npm shim.
 */
export const TOOL_RULE = /^[A-Za-z][A-Za-z0-9_.-]{0,79}\*?(?:\([A-Za-z0-9 _./:*@=+~\\-]{1,200}\))?$/
export const TOOL_RULES_MAX = 20
export const APPEND_PROMPT_MAX = 2_000
export const ADD_DIRS_MAX = 5
export const BUDGET_USD_MAX = 100
/** The name of the session a fork came from, as shown in its title and header. */
export const FORK_NAME_MAX = 60
/** A Claude Code session id (a UUID) or a session name; starts with a letter or digit for the same reason. */
export const RESUME_PATTERN = /^[A-Za-z0-9][\w.-]{0,127}$/
/** AgentDeck's own id for a conversation (`c_` and 8 hex digits). */
export const CONVERSATION_ID = /^c_[0-9a-f]{8}$/

/** The prompt goes through stdin, so the command-line cap of the Composer (PROMPT_MAX) does not apply; this is a sanity limit. */
export const CONSOLE_PROMPT_MAX = 32_000
/** Live `claude` processes at once; a seventh start is refused with a reason. */
export const CONSOLE_MAX_LIVE = 6

/** What the Advanced section sets (all off by default). Every one is a documented `claude --help` flag, passed as an argument, never in a shell. */
export interface ConsoleOptions {
  /** `--allowedTools`: tools that run without asking. */
  allowedTools: string[]
  /** `--disallowedTools`: tools Claude may not use at all. */
  disallowedTools: string[]
  /** `--add-dir`: more folders Claude may read and edit; each passes the working folder's known-or-picked rule. */
  addDirs: string[]
  /** `--append-system-prompt`: standing instructions, shown in the header so they are never invisible. */
  appendSystemPrompt: string | null
  /** `--fallback-model`: models to switch to when the main one is overloaded (comma-separated). */
  fallbackModel: string | null
  /** `--max-budget-usd`: stop when this much is estimated to be spent. (`--max-turns` is not on this version's `--help`.) */
  maxBudgetUsd: number | null
}

export const NO_OPTIONS: ConsoleOptions = { allowedTools: [], disallowedTools: [], addDirs: [], appendSystemPrompt: null, fallbackModel: null, maxBudgetUsd: null }

export interface ConsoleStart {
  cwd: string
  prompt: string
  /** `claude --model` alias or id; null = Claude Code's default. */
  model: string | null
  effort: Effort
  permissionMode: PermissionMode
  /** A Claude Code session id to continue (`--resume`), or null for a new conversation. */
  resume: string | null
  /** With `resume`: continue as a copy under a NEW session id (`--fork-session`); the original session is left as it is. */
  fork?: boolean
  /** With `fork`: the name of the session being copied, for the conversation's title and header. */
  forkOf?: string
  /** The role (Roles catalog id) this session RUNS AS (`--agent`), picked with the first @mention. Null or absent = plain Claude Code. */
  role?: string | null
  /** More roles mentioned with it: available to the lead as subagents for this session (at most 4), and the opening message asks it to consult them. */
  helpers?: string[]
  /** Images pasted into the first message. */
  images?: ConsoleImage[]
  options: ConsoleOptions
}

/** Where a forked conversation came from. */
export interface ConsoleFork {
  /** The Claude Code session that was copied (still the original; the fork has its own id in `sessionId`). */
  sessionId: string
  name: string
}

/** The result of allowing one more tool in a running conversation. `restart`: this Claude Code can not take it live; resume with it instead. */
export type ConsoleAllowResult = { ok: true; allowed: string[] } | { ok: false; error: string; restart: boolean }

/** What an MCP server is doing, in the words Claude Code uses. */
export type McpStatus = 'connected' | 'pending' | 'needs-auth' | 'failed' | 'disabled' | 'unknown'

export interface McpServerInfo {
  name: string
  status: McpStatus
  /** Tools it offers this conversation (counted from the tool list). */
  tools: number
}

/** A slash command or skill: `/name args`. `kind` skill = a SKILL.md Claude Code found; command = a built-in or a custom/plugin command. */
export interface CommandInfo {
  name: string
  kind: 'skill' | 'command'
  description: string
  hint: string
}

/**
 * What a conversation can use, from the stream-json `system/init` message (2.1.323: model, tools, mcp_servers, slash_commands,
 * skills, agents, plugins, terminal_slash_commands, output_style) and `system/commands_changed` (descriptions). Names only: no paths,
 * no account, no config. Capped, and masked like all text.
 */
export interface ConsoleCapabilities {
  /** The model actually in use (init), which can differ from the one asked for. */
  model: string | null
  claudeVersion: string | null
  outputStyle: string | null
  mcpServers: McpServerInfo[]
  /** Skills and commands that run in a conversation like this one; the interactive-only ones are in `terminalOnly`. */
  commands: CommandInfo[]
  agents: { name: string; description: string }[]
  plugins: { name: string; version: string | null }[]
  /** Built-in tools (Read, Edit, Bash, …) and, after them, the MCP tools, as `mcp__server__tool`. */
  tools: string[]
  terminalOnly: string[]
}

export const CAPABILITY_CAPS = { commands: 800, agents: 800, plugins: 100, mcpServers: 100, tools: 1_000, name: 120, description: 200 } as const

/** One server from `claude mcp list`, reduced to what is safe to show: its name and how it is doing. Never its command, URL, env or headers. */
export interface McpListed {
  name: string
  status: McpStatus
}

export type McpListResult = { ok: true; servers: McpListed[]; at: number; cached: boolean } | { ok: false; error: string }

/** One model as Claude Code's own picker lists it (the `initialize` answer). `value` is what `--model` takes; `default` means none. */
export interface ModelInfo {
  value: string
  label: string
  description: string
  /** The effort levels it takes, empty when it takes none. */
  efforts: string[]
}

export type ModelListResult = { ok: true; models: ModelInfo[]; at: number } | { ok: false; error: string }

/** `untrusted`: the folder needs `claude` run there once to accept the trust prompt (S6, R18). */
export type ConsoleStartResult = { ok: true; id: string } | { ok: false; error: string; untrusted: boolean }

/** `starting`: spawned, no answer yet. `working`: a turn is running or queued. `idle`: waiting for you. `ended`: closed normally. `failed`: it stopped for a reason. */
export type ConsoleState = 'starting' | 'working' | 'idle' | 'ended' | 'failed'

/** Why a conversation failed, when the fix is something the user does elsewhere. */
export type ConsoleProblem = 'untrusted' | 'signed-out' | 'no-cli'

/** A role as the pages show it: its catalog id, name and emoji. */
export interface RoleRef {
  id: string
  name: string
  emoji: string
}

/** At most this many helper roles with a lead (the first @mention leads, the rest are available to it). */
export const HELPERS_MAX = 4

export interface ConsoleSummary {
  /** AgentDeck's id for this conversation (not the Claude Code session id). */
  id: string
  title: string
  cwd: string
  startedAt: number
  state: ConsoleState
  /** Claude Code's session id once it has said it; what `resume` takes. */
  sessionId: string | null
  turns: number
  /** The conversation's running total, as Claude Code estimates it (a subscription is not billed per call). */
  costUsd: number
  /** The model asked for (null = Claude Code's default); the one actually in use is in `capabilities.model`. */
  model: string | null
  permissionMode: PermissionMode
  /** What the Advanced section set; `allowedTools` grows when a tool is allowed in the running conversation. */
  options: ConsoleOptions
  /** Set when this conversation is a copy of another session. */
  fork: ConsoleFork | null
  /** Plain words, when `failed` (or ended for a reason). */
  error: string | null
  problem: ConsoleProblem | null
  /** The role this conversation runs as (the lead), or absent/null for plain Claude Code. */
  role?: RoleRef | null
  /** The helper roles available to the lead as subagents. */
  helpers?: RoleRef[]
}

/** What happened, before main gives it an id, a number and a time. */
export type ConsoleBody =
  | { kind: 'state'; state: ConsoleState; sessionId: string | null; error: string | null; problem: ConsoleProblem | null }
  | { kind: 'user'; text: string }
  /** `text` is everything said so far in this message (replace, don't append); `final` once the message is complete. */
  | { kind: 'assistant-text'; messageId: string; text: string; final: boolean }
  | { kind: 'thinking'; messageId: string; text: string; final: boolean }
  /** `summary` is one line (`Edit src/App.tsx`, `Run: npm test`); `input` is the redacted, capped JSON. */
  | { kind: 'tool-use'; toolUseId: string; name: string; summary: string; input: string }
  | { kind: 'tool-result'; toolUseId: string; ok: boolean; text: string; truncated: boolean }
  /** The tool needed permission and nobody gave it (see Remote approvals, or start with Accept edits). */
  | { kind: 'permission-denied'; toolUseId: string; name: string; summary: string; /** The rule that would allow it (`mcp__server__tool`, `Bash(npm test)`), or null when none is safe. */ rule: string | null }
  | {
      kind: 'turn-end'
      /** This turn's share of the conversation's cost; null when unknown (the first turn of a resumed session). */
      costUsd: number | null
      totalCostUsd: number | null
      /** Everything the model read this turn, cached or not. */
      inputTokens: number | null
      outputTokens: number | null
      durationMs: number | null
      interrupted: boolean
      error: string | null
    }
  | { kind: 'notice'; level: 'info' | 'warn'; text: string }
  /** What this conversation can use; sent again when more is known (descriptions arrive after the names). Replaces the last one. */
  | { kind: 'capabilities'; capabilities: ConsoleCapabilities }
  /** The tools that now run without asking in this conversation (replace, don't append). */
  | { kind: 'allowed'; tools: string[] }

/** One thing that happened in a conversation. Text is redacted (EVENT_SCHEMA § Redaction) and capped before it leaves main. */
export type ConsoleEvent = { id: string; conversation: string; seq: number; ts: number } & ConsoleBody

/** What main keeps per conversation for a page opened later (in memory; gone when AgentDeck quits). */
export const HISTORY_MAX_EVENTS = 2_000
export const HISTORY_MAX_BYTES = 5 * 1024 * 1024
