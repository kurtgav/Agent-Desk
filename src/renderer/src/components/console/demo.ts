import { NO_OPTIONS, type CommandInfo, type ConsoleBody, type ConsoleCapabilities, type ConsoleEvent, type ConsoleSummary, type McpListResult, type ModelInfo } from '@shared/console'

/**
 * Demo data for the Console (ADR-0011): two believable conversations and a scripted reply. Nothing here runs `claude`; it is only
 * shown, labelled demo data like everything else in demo mode.
 */

const SEC = 1_000
const MIN = 60_000

type Info = Pick<ConsoleSummary, 'id' | 'title' | 'cwd' | 'startedAt' | 'model' | 'permissionMode' | 'options' | 'fork'>

export interface DemoConversation {
  info: Info
  events: ConsoleEvent[]
}

class Script {
  private seq = 0
  readonly events: ConsoleEvent[] = []
  constructor(
    readonly id: string,
    private t: number
  ) {}

  /** Adds an event `after` ms later than the one before it. */
  add(body: ConsoleBody, after = 900): this {
    this.t += after
    this.seq++
    this.events.push({ id: `${this.id}:${this.seq}`, conversation: this.id, seq: this.seq, ts: this.t, ...body } as ConsoleEvent)
    return this
  }
  say(text: string, after?: number): this {
    return this.add({ kind: 'assistant-text', messageId: `${this.id}:m${this.seq}`, text, final: true }, after)
  }
  tool(id: string, name: string, summary: string, input: unknown, result: { ok: boolean; text: string }, after?: number): this {
    this.add({ kind: 'tool-use', toolUseId: id, name, summary, input: JSON.stringify(input, null, 2) }, after)
    return this.add({ kind: 'tool-result', toolUseId: id, ok: result.ok, text: result.text, truncated: false }, 700)
  }
  end(total: number, share: number, tokens: [number, number], seconds: number): this {
    return this.add({ kind: 'turn-end', costUsd: share, totalCostUsd: total, inputTokens: tokens[0], outputTokens: tokens[1], durationMs: seconds * SEC, interrupted: false, error: null }, 600)
  }
}

const cmd = (name: string, description: string, hint = '', skill = false): CommandInfo => ({ name, kind: skill ? 'skill' : 'command', description, hint })

/** What a demo conversation can use: a believable setup (a few connected servers, one that needs signing in, one that failed). */
export const demoCapabilities = (model = 'claude-sonnet-5-5'): ConsoleCapabilities => ({
  model,
  claudeVersion: '2.1.323',
  outputStyle: 'Default',
  mcpServers: [
    { name: 'claude.ai Gmail', status: 'connected', tools: 31 }, { name: 'claude.ai Google Drive', status: 'connected', tools: 14 }, { name: 'claude.ai Slack', status: 'connected', tools: 27 },
    { name: 'claude.ai Figma', status: 'pending', tools: 0 }, { name: 'plugin:expo:expo', status: 'needs-auth', tools: 0 }, { name: 'github', status: 'connected', tools: 9 },
    { name: 'postgres', status: 'failed', tools: 0 }
  ],
  commands: [
    cmd('compact', 'Clear conversation history but keep a summary in context', '[instructions]'), cmd('clear', 'Clear conversation history and free up context'),
    cmd('context', 'Show current context usage'), cmd('mcp', 'Show MCP server status'), cmd('model', 'Set the AI model for Claude Code', '[model]'),
    cmd('config', 'Open config panel'), cmd('init', 'Initialize a CLAUDE.md file with codebase documentation'),
    cmd('review', 'Review a pull request', '[pr-number]', true), cmd('security-review', 'Complete a security review of the pending changes', '', true),
    cmd('aside', 'Answer a quick side question without interrupting the current task', '<question>', true), cmd('frontend-design', 'Create distinctive, production-grade interfaces', '', true),
    cmd('deploy-check', 'Check what would ship if you deployed now', '', true), cmd('release-notes', 'Draft release notes from the commits', '[since]', true)
  ],
  agents: [
    { name: 'Explore', description: 'Fast read-only search across a codebase' }, { name: 'Plan', description: 'Designs an implementation plan before any code is written' },
    { name: 'code-reviewer', description: 'Reviews code for quality, security and maintainability' }, { name: 'tdd-guide', description: 'Writes the tests first' },
    { name: 'security-reviewer', description: 'Looks for vulnerabilities in new code' }
  ],
  plugins: [{ name: 'frontend-design', version: '1.2.0' }, { name: 'deploy-tools', version: '0.9.4' }],
  tools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'WebFetch', 'mcp__claude_ai_Gmail__list_labels', 'mcp__claude_ai_Gmail__search_threads', 'mcp__claude_ai_Google_Drive__list_recent_files', 'mcp__github__list_pull_requests'],
  terminalOnly: ['doctor', 'color', 'focus']
})

/** The model list in demo mode: what Claude Code 2.1.325 listed for a Max account. */
export const demoModels = (): ModelInfo[] =>
  (
    [
      ['default', 'Default (recommended)', 'Opus 5.5 · Best for everyday, complex tasks'],
      ['opus', 'Opus 5.5', 'For complex work and everyday tasks'],
      ['fable', 'Fable 5.2', 'For your toughest challenges'],
      ['sonnet', 'Sonnet 5.5', 'Most efficient for simpler tasks'],
      ['haiku', 'Haiku 5.5', 'Fastest for quick answers'],
      ['claude-fable-5-1', 'Fable 5.1', 'Most capable for your hardest and longest-running tasks'],
      ['claude-haiku-4-5-20251001', 'Haiku 4.5', 'Fastest for quick answers'],
      ['claude-sonnet-5', 'Sonnet 5', 'Efficient for routine tasks'],
      ['claude-opus-5', 'Opus 5', 'Best for everyday, complex tasks'],
      ['claude-fable-5', 'Fable 5', 'Most capable for your hardest and longest-running tasks'],
      ['claude-opus-4-8', 'Opus 4.8', 'Best for everyday, complex tasks'],
      ['claude-opus-4-7', 'Opus 4.7', 'Best for everyday, complex tasks'],
      ['claude-opus-4-6', 'Opus 4.6', 'Best for everyday, complex tasks'],
      ['claude-sonnet-4-6', 'Sonnet 4.6', 'Efficient for routine tasks']
    ] as const
  ).map(([value, label, description]) => ({ value, label, description, efforts: value.includes('haiku') ? [] : ['low', 'medium', 'high', 'xhigh', 'max'] }))

/** The on-demand `claude mcp list` in demo mode: the same servers, names and status only. */
export const demoMcpList = (): Extract<McpListResult, { ok: true }> => ({
  ok: true,
  at: Date.now(),
  cached: false,
  servers: demoCapabilities().mcpServers.map((s) => ({ name: s.name, status: s.status === 'pending' ? 'connected' : s.status }))
})

const READ_RESULT = `export async function exportInvoices(accountId: string): Promise<string> {
  const rows = (await db.invoice.findMany({ where: { accountId } })).map(toCsvRow)
  return [HEADER, ...rows].join('\\n')
}`

const FAIL_RESULT = `FAIL  src/invoices/export.test.ts
  exportInvoices
    ✓ writes one row per invoice (12 ms)
    ✕ starts with the header row (4 ms)

  Expected: "number,customer,total"
  Received: "INV-1001,Northwind,120.00"

Tests: 1 failed, 1 passed, 2 total`

const PASS_RESULT = `PASS  src/invoices/export.test.ts
  exportInvoices
    ✓ writes one row per invoice (11 ms)
    ✓ starts with the header row (3 ms)

Tests: 2 passed, 2 total`

const FINAL = `The export now streams. Rows are read in batches of 500 and written as they arrive, so memory stays flat however many invoices an account has.

\`\`\`ts
export async function* exportInvoices(accountId: string): AsyncGenerator<string> {
  yield HEADER
  for await (const batch of invoiceBatches(accountId, BATCH_SIZE)) {
    for (const invoice of batch) yield toCsvRow(invoice)
  }
}
\`\`\`

What changed:

- \`exportInvoices\` is an async generator instead of returning one string.
- \`routes/export.ts\` pipes it into the response, so the download starts at once.
- The header test caught that the first batch was written before the header; it now comes first.

Both tests pass. Want me to add a test for an account with no invoices?`

function refactor(now: number): DemoConversation {
  const id = 'demo-refactor'
  const start = now - 14 * MIN
  const s = new Script(id, start)
  s.add({ kind: 'allowed', tools: ['Bash(npm test:*)'] }, 0)
  s.add({ kind: 'capabilities', capabilities: demoCapabilities() }, 10)
  s.add({ kind: 'state', state: 'working', sessionId: null, error: null, problem: null }, 0)
  s.add({ kind: 'user', text: 'Stream the invoice export instead of building the whole file in memory. Keep the CSV format the same.' }, 200)
  s.say("I'll read how the export works today.", 1_800)
  s.tool('toolu_d1', 'Read', 'Read src/invoices/export.ts', { file_path: 'D:\\thirdcode\\billing-api\\src\\invoices\\export.ts' }, { ok: true, text: READ_RESULT })
  s.say('Every invoice is mapped to a row and joined into one string before anything is sent, which is what exhausts memory on large accounts. I will turn it into a generator that yields rows in batches.', 1_100)
  s.tool(
    'toolu_d2', 'Edit', 'Edit src/invoices/export.ts',
    { file_path: 'D:\\thirdcode\\billing-api\\src\\invoices\\export.ts', old_string: 'export async function exportInvoices(accountId: string): Promise<string> {', new_string: 'export async function* exportInvoices(accountId: string): AsyncGenerator<string> {' },
    { ok: true, text: 'The file src/invoices/export.ts has been updated.' }, 1_400
  )
  s.tool('toolu_d3', 'Bash', 'Run: npm test -- export', { command: 'npm test -- export', description: 'Run the export tests' }, { ok: false, text: FAIL_RESULT }, 1_200)
  s.say('One test fails: it expects the header row first, and my change writes it after the first batch. I will move the header out of the loop.', 1_300)
  s.tool(
    'toolu_d4', 'Edit', 'Edit src/invoices/export.ts',
    { file_path: 'D:\\thirdcode\\billing-api\\src\\invoices\\export.ts', old_string: '  for await (const batch of', new_string: '  yield HEADER\n  for await (const batch of' },
    { ok: true, text: 'The file src/invoices/export.ts has been updated.' }, 1_100
  )
  s.tool('toolu_d5', 'Bash', 'Run: npm test -- export', { command: 'npm test -- export' }, { ok: true, text: PASS_RESULT }, 1_000)
  s.say(FINAL, 1_500)
  s.end(0.31, 0.31, [48_200, 1_460], 54)
  s.add({ kind: 'state', state: 'idle', sessionId: '6f2a1c3e-9b4d-4e1a-8c70-2d5b7e9a4f10', error: null, problem: null }, 50)
  s.add({ kind: 'user', text: 'Yes, add that test.' }, 4 * MIN)
  s.say('Added `returns only the header for an account with no invoices` to `export.test.ts`. It passes along with the other two.', 2_200)
  s.end(0.36, 0.05, [51_900, 210], 9)
  return { info: { id, title: 'Stream the invoice export instead of building the whole file in memory', cwd: 'D:\\thirdcode\\billing-api', startedAt: start, model: 'claude-sonnet-5-5', permissionMode: 'acceptEdits', options: { ...NO_OPTIONS, allowedTools: ['Bash(npm test:*)'] }, fork: null }, events: s.events }
}

const REVIEW = `I read the three changed files. The retry logic is sound; two things need attention before it merges.

| Finding | Where | Severity |
| --- | --- | --- |
| Retries are not capped | \`webhooks.ts:48\` | High |
| The backoff has no jitter | \`webhooks.ts:61\` | Medium |
| Failures are logged without the event id | \`webhooks.ts:77\` | Low |

The first one matters most: a permanently failing endpoint is retried forever. A cap of 8 attempts with the existing backoff would stop that.`

function review(now: number): DemoConversation {
  const id = 'demo-review'
  const start = now - 3 * 60 * MIN
  const s = new Script(id, start)
  s.add({ kind: 'capabilities', capabilities: demoCapabilities() }, 0)
  s.add({ kind: 'state', state: 'working', sessionId: null, error: null, problem: null }, 0)
  s.add({ kind: 'user', text: 'Review the open changes for webhook retries. Do not edit anything.' }, 200)
  s.tool('toolu_r1', 'Grep', 'Search for "retry"', { pattern: 'retry', path: 'D:\\thirdcode\\thirdcode-web\\src' }, { ok: true, text: 'src/routes/webhooks.ts\nsrc/lib/backoff.ts\nsrc/routes/webhooks.test.ts' }, 1_600)
  s.say(REVIEW, 2_000)
  s.end(0.12, 0.12, [22_400, 520], 21)
  s.add({ kind: 'state', state: 'ended', sessionId: '0b7d4e52-31a6-47c8-9f0e-6a8c2d1b5e37', error: null, problem: null }, 90 * SEC)
  return { info: { id, title: 'Review the open changes for webhook retries', cwd: 'D:\\thirdcode\\thirdcode-web', startedAt: start, model: null, permissionMode: 'plan', options: NO_OPTIONS, fork: null }, events: s.events }
}

function mail(now: number): DemoConversation {
  const id = 'demo-mail'
  const start = now - 40 * MIN
  const s = new Script(id, start)
  s.add({ kind: 'capabilities', capabilities: demoCapabilities('claude-opus-5-5') }, 0)
  s.add({ kind: 'state', state: 'working', sessionId: null, error: null, problem: null }, 0)
  s.add({ kind: 'user', text: 'List my Gmail labels and tell me which ones are empty.' }, 200)
  s.add({ kind: 'tool-use', toolUseId: 'toolu_m1', name: 'mcp__claude_ai_Gmail__list_labels', summary: 'Gmail · list_labels', input: '{}' }, 1_800)
  s.add({ kind: 'tool-result', toolUseId: 'toolu_m1', ok: false, text: "Claude requested permissions to use mcp__claude_ai_Gmail__list_labels, but you haven't granted it yet.", truncated: false }, 600)
  s.add({ kind: 'permission-denied', toolUseId: 'toolu_m1', name: 'mcp__claude_ai_Gmail__list_labels', summary: 'Gmail · list_labels', rule: 'mcp__claude_ai_Gmail__list_labels' }, 50)
  s.say('I could not read your labels: the Gmail connector needs your permission before Claude may call it. Allow it for this conversation and I will try again.', 900)
  s.end(0.09, 0.09, [24_800, 140], 11)
  s.add({ kind: 'state', state: 'idle', sessionId: '4c1d9a07-52e8-4b3f-a6d1-8f0e7b2c9a55', error: null, problem: null }, 50)
  return { info: { id, title: 'List my Gmail labels and tell me which ones are empty.', cwd: 'D:\\thirdcode\\billing-api', startedAt: start, model: 'opus', permissionMode: 'default', options: NO_OPTIONS, fork: null }, events: s.events }
}

export const demoConversations = (now: number): DemoConversation[] => [review(now), mail(now), refactor(now)]

/** What a demo conversation says back: plain, and it says nothing ran. Event numbers continue from `seq`. */
export function demoReply(id: string, seq: number, now: number, prompt: string): ConsoleEvent[] {
  const quote = prompt.replace(/\s+/g, ' ').trim().slice(0, 70)
  const body = `This is demo data, so nothing was sent to Claude. In a real conversation I would start from “${quote}${prompt.length > 70 ? '…' : ''}” and show each step here as it happens.`
  const bodies: ConsoleBody[] = [
    { kind: 'state', state: 'working', sessionId: null, error: null, problem: null },
    { kind: 'assistant-text', messageId: `${id}:reply${seq}`, text: body, final: true },
    { kind: 'turn-end', costUsd: null, totalCostUsd: null, inputTokens: null, outputTokens: null, durationMs: 800, interrupted: false, error: null },
    { kind: 'state', state: 'idle', sessionId: null, error: null, problem: null }
  ]
  return bodies.map((b, i) => ({ id: `${id}:${seq + i}`, conversation: id, seq: seq + i, ts: now + i * 200, ...b }) as ConsoleEvent)
}
