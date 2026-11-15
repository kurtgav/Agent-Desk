import { TOOL_RULE, type ConsoleBody, type ConsoleProblem } from '@shared/console'
import { cap, maskSecrets } from '../collector/redact'

/** Text handling for the Console's child process: lines, masking, one-line summaries, plain-words problems. Pure; no Node. */

/** One stdout line (a result with a huge usage block is a few KB; a line past this is dropped, not buffered). */
export const LINE_MAX = 16 * 1024 * 1024
/** maskSecrets scans at most 16,384 characters at a time, so longer text is masked in pieces. */
const MASK_CHUNK = 12_000
const MASK_CHUNK_KEY = 15_000

/** Splits stdout into lines across chunk boundaries (a JSON line can arrive in pieces). */
export class LineSplitter {
  private buf = ''
  private skipping = false
  /** Lines dropped for being longer than `max`. */
  dropped = 0

  constructor(private readonly max = LINE_MAX) {}

  push(chunk: string): string[] {
    const lines: string[] = []
    let start = 0
    for (;;) {
      const nl = chunk.indexOf('\n', start)
      if (nl < 0) break
      const piece = chunk.slice(start, nl)
      start = nl + 1
      if (this.skipping) {
        this.skipping = false
        this.buf = ''
        continue
      }
      const line = (this.buf + piece).replace(/\r$/, '')
      this.buf = ''
      if (line.trim()) lines.push(line)
    }
    if (!this.skipping) {
      this.buf += chunk.slice(start)
      if (this.buf.length > this.max) {
        this.buf = ''
        this.skipping = true
        this.dropped++
      }
    }
    return lines
  }

  /** A last line the child never ended with a newline. */
  flush(): string[] {
    const line = this.skipping ? '' : this.buf.replace(/\r$/, '')
    this.buf = ''
    this.skipping = false
    return line.trim() ? [line] : []
  }
}

/** maskSecrets for text of any length: pieces end at a line break, and a private-key block is kept whole. */
export function maskText(s: string): string {
  if (s.length <= MASK_CHUNK) return maskSecrets(s)
  const out: string[] = []
  let i = 0
  while (i < s.length) {
    let end = Math.min(i + MASK_CHUNK, s.length)
    if (end < s.length) {
      const nl = s.lastIndexOf('\n', end)
      if (nl > i) end = nl + 1
      const chunk = s.slice(i, end)
      const begin = chunk.lastIndexOf('-----BEGIN ')
      if (begin >= 0 && chunk.indexOf('PRIVATE KEY-----', begin) >= 0 && chunk.indexOf('-----END', begin) < 0) {
        // shortcut: a key block longer than MASK_CHUNK_KEY is masked to the end of its piece only, upgrade if one ever shows up.
        const close = s.indexOf('-----END', end)
        const stop = close < 0 ? s.length : s.indexOf('\n', close) + 1 || s.length
        if (stop - i <= MASK_CHUNK_KEY) end = stop
      }
    }
    out.push(maskSecrets(s.slice(i, end)))
    i = end
  }
  return out.join('')
}

export const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
export const rec = (v: unknown): Record<string, unknown> => (isRec(v) ? v : {})
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
export const str = (v: unknown): string => (typeof v === 'string' ? v : '')
export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** `D:\proj\src\a.ts` in `D:\proj` is `src/a.ts`; a path elsewhere stays as it is. */
function rel(p: string, cwd: string): string {
  const a = p.replace(/\\/g, '/')
  const c = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  return c && a.toLowerCase().startsWith(`${c.toLowerCase()}/`) ? a.slice(c.length + 1) : p
}

export const oneLine = (s: string, max: number): string => cap(s.replace(/\s+/g, ' ').trim(), max)

/** `mcp__claude_ai_Figma__whoami` is the tool `whoami` of the server `claude_ai_Figma` (Claude Code turns every other character of a server name into `_`). */
export function parseMcpTool(name: string): { server: string; tool: string } | null {
  const m = /^mcp__(.+?)__(.+)$/.exec(name)
  return m ? { server: m[1]!, tool: m[2]! } : null
}

/** `claude_ai_Google_Drive` → `Google Drive`; `plugin_ui-color-palette_ui-color-palette` → `ui-color-palette`. */
export function mcpServerLabel(server: string): string {
  const s = server.replace(/^claude_ai_/, '').replace(/^plugin_/, '')
  const mid = s.length % 2 === 1 ? (s.length - 1) / 2 : -1
  const doubled = mid > 0 && s[mid] === '_' && s.slice(0, mid) === s.slice(mid + 1)
  return (doubled ? s.slice(0, mid) : s).replace(/_/g, ' ')
}

/** What Claude Code calls a server in tool names: every character outside [a-zA-Z0-9_-] becomes `_`. */
export const mcpServerKey = (name: string): string => name.replace(/[^a-zA-Z0-9_-]/g, '_')

/**
 * The rule that would let this call through, for the "Allow" button: an MCP tool or a plain tool by name; a Bash command exactly
 * (`Bash(npm test)`). Null when no safe rule exists (a command with `&&`, quotes, …): the user then starts with Accept edits instead.
 */
export function allowRuleFor(name: string, input: unknown): string | null {
  const command = str(rec(input).command)
  const rule = name === 'Bash' || name === 'PowerShell' ? (command ? `${name}(${command.trim()})` : null) : name
  return rule !== null && TOOL_RULE.test(rule) ? rule : null
}

/** The one-line story of a tool call: `Edit src/App.tsx`, `Run: npm test`, `Figma · whoami`. */
export function summarizeTool(name: string, input: unknown, cwd: string): string {
  const mcp = parseMcpTool(name)
  if (mcp) return `${mcpServerLabel(mcp.server)} · ${mcp.tool}`
  const i = rec(input)
  const file = str(i.file_path) || str(i.notebook_path) || str(i.path)
  switch (name) {
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return file ? `${name === 'MultiEdit' ? 'Edit' : name} ${rel(file, cwd)}` : name
    case 'Bash':
    case 'PowerShell':
      return str(i.command) ? `Run: ${oneLine(str(i.command), 110)}` : name
    case 'Glob':
      return str(i.pattern) ? `Find files: ${oneLine(str(i.pattern), 80)}` : name
    case 'Grep':
      return str(i.pattern) ? `Search for "${oneLine(str(i.pattern), 80)}"` : name
    case 'LS':
      return file ? `List ${rel(file, cwd)}` : name
    case 'WebFetch': {
      const url = str(i.url)
      const host = /^https?:\/\/([^/\s?#]+)/i.exec(url)?.[1]
      return host ? `Fetch ${host}` : name
    }
    case 'WebSearch':
      return str(i.query) ? `Search the web: ${oneLine(str(i.query), 80)}` : name
    case 'Task':
    case 'Agent':
      return str(i.description) ? `Subagent: ${oneLine(str(i.description), 80)}` : str(i.subagent_type) ? `Subagent: ${str(i.subagent_type)}` : name
    case 'TodoWrite':
      return 'Update the to-do list'
    default:
      return name
  }
}

/** Plain words for the two problems the user fixes outside AgentDeck. */
export const PROBLEM_TEXT: Record<ConsoleProblem, string> = {
  'signed-out': 'Claude Code is not signed in. Open a terminal, run `claude`, sign in with /login, then start again.',
  untrusted: 'Claude Code does not trust this folder yet. Run `claude` there once, accept the trust prompt, then start again.',
  'no-cli': 'AgentDeck could not find the Claude Code CLI (claude), so it can not run this.'
}

export function classify(text: string): ConsoleProblem | null {
  if (/workspace not trusted|trust (?:this|the) folder/i.test(text)) return 'untrusted'
  if (/not logged in|please run \/login|invalid api key|authentication[_ ]failed|oauth token has expired|\bplease sign in\b/i.test(text)) return 'signed-out'
  return null
}


/** Everything string-shaped in a body, masked: the last thing main does before an event leaves for the page. */
export function redactBody(b: ConsoleBody): ConsoleBody {
  switch (b.kind) {
    case 'user':
    case 'notice':
      return { ...b, text: maskText(b.text) }
    case 'assistant-text':
    case 'thinking':
      return { ...b, text: maskText(b.text) }
    case 'tool-use':
      return { ...b, summary: maskSecrets(b.summary), input: maskText(b.input) }
    case 'tool-result':
      return { ...b, text: maskText(b.text) }
    case 'permission-denied':
      return { ...b, summary: maskSecrets(b.summary) }
    case 'capabilities':
    case 'allowed':
      return b
    case 'turn-end':
      return { ...b, error: b.error === null ? null : maskSecrets(b.error) }
    case 'state':
      return { ...b, error: b.error === null ? null : maskSecrets(b.error) }
  }
}
