#!/usr/bin/env node
// A stand-in for `claude -p --input-format stream-json --output-format stream-json`, for tests (no model, no network, no account).
// The shapes are the ones captured from Claude Code 2.1.323 (test/fixtures/console/*.jsonl). The prompt picks the script:
//   "tool"   a Glob call, its result, then text      "denied"  a Bash call nobody approved (permission_denials)
//   "slow"   text for ~20 s, until interrupted        "hang"    like slow, but it ignores the interrupt
//   "signin" a not-signed-in result                   "crash"   exits 3 with a line on stderr
//   "secret" text that carries a key                  "mcp"     an MCP tool call (mcp__fake_server__ping): runs when allowed, else denied
//   /context /mcp  local commands (no model, cost 0)   /clear   a conversation reset and a new init (new session id)
//   /anything-else a skill: "Skill ran: <the message>"  anything else: one short reply
// --allowedTools a,b and a live `apply_flag_settings` {permissions:{allow}} control request allow tools; FAKE_CLAUDE_NO_LIVE_ALLOW=1
// makes the live one fail, like a Claude Code that can not take it.
// --agents <file|json> and --agent <name> are honoured like 2.1.323: the file is read at start (a missing one exits 1 with the real message),
// its keys join the agents init lists, and a --agent name that is neither defined nor in FAKE_CLAUDE_INSTALLED (comma list) is silently
// ignored. The log gets AGENTS (the parsed definitions), AGENTS_FILE (was it there), AGENT (the flag) and AGENT_FOUND (true | false). `claude mcp list` prints FAKE_MCP_LIST: normal | garbage | huge | none | hang | fail.
/* global process, setTimeout */
// FAKE_CLAUDE_LOG=<file> appends the argv and each input line there, so a test can see what was sent.
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const argv = process.argv.slice(2)
if (argv.includes('--version') || argv.includes('-v')) {
  process.stdout.write('9.9.9 (Claude Code)\n')
  process.exit(0)
}
if (argv[0] === 'mcp' && argv[1] === 'list') {
  const mode = process.env.FAKE_MCP_LIST ?? 'normal'
  if (process.env.FAKE_CLAUDE_LOG) appendFileSync(process.env.FAKE_CLAUDE_LOG, `MCPLIST ${mode}\n`)
  if (mode === 'fail') process.exit(2)
  if (mode === 'hang') {
    setTimeout(() => process.exit(0), 600_000)
  } else {
    const lines = {
      normal: [
        'Checking MCP server health…',
        '',
        'claude.ai Figma: https://mcp.example.com/figma?token=sk-ant-api03-SECRETSECRETSECRET - ✔ Connected',
        'plugin:expo:expo: https://api.example.com/mcp - ! Needs authentication',
        'github: npx -y @modelcontextprotocol/server-github --token ghp_abcdefghijklmnopqrstuvwxyz0123456789 - ✘ Failed to connect — ECONNREFUSED: Unable to connect',
        'caveman: node C:\\Users\\someone\\caveman.js --api-key=hunter2 - ✔ Connected'
      ],
      garbage: ['\u0000\u0001 not a list at all', 'foo bar', '{"json":"nope"}', 'AWS_SECRET_ACCESS_KEY=abc123'],
      huge: ['Checking MCP server health…', ...Array.from({ length: 150 }, (_, i) => `server-${i}: https://x.example/${i} - ✔ Connected`), 'x'.repeat(400_000)],
      none: ['No MCP servers configured. Use `claude mcp add` to add a server.']
    }[mode] ?? []
    process.stdout.write(`${lines.join('\n')}\n`)
    process.exit(0)
  }
} else {
  main()
}

function main() {
  const log = (line) => process.env.FAKE_CLAUDE_LOG && appendFileSync(process.env.FAKE_CLAUDE_LOG, `${line}\n`)
  log(`ARGV ${JSON.stringify(argv)}`)
  log(`PID ${process.pid}`)

  // Roles: definitions from --agents (a file, or inline JSON) and the agent the session runs as.
  let defined = {}
  const agentsArg = argv.includes('--agents') ? argv[argv.indexOf('--agents') + 1] : null
  if (agentsArg !== null) {
    const inline = agentsArg.trimStart().startsWith('{')
    if (!inline) {
      log(`AGENTS_FILE ${existsSync(agentsArg)}`)
      if (!existsSync(agentsArg)) {
        process.stderr.write(`Error: --agents file not found: ${agentsArg} (a value that is not a JSON object is read as a file path)\n`)
        process.exit(1)
      }
    }
    try {
      defined = JSON.parse(inline ? agentsArg : readFileSync(agentsArg, 'utf8'))
    } catch {
      process.stderr.write('Error: --agents is not valid JSON\n')
      process.exit(1)
    }
    log(`AGENTS ${JSON.stringify(defined)}`)
  }
  const installed = (process.env.FAKE_CLAUDE_INSTALLED ?? '').split(',').filter(Boolean)
  const agentFlag = argv.includes('--agent') ? argv[argv.indexOf('--agent') + 1] : null
  // `claude --bg ...` (a dispatch): it starts nothing and prints the id the real one prints.
  if (argv.includes('--bg')) {
    process.stdout.write('backgrounded · fakebg1' + String.fromCharCode(10))
    process.exit(0)
  }
  const agentNames = ['Explore', 'Plan', 'code-reviewer', ...installed, ...Object.keys(defined)]
  if (agentFlag !== null) {
    log(`AGENT ${agentFlag}`)
    log(`AGENT_FOUND ${agentNames.includes(agentFlag)}`)
  }

  const flag = (name) => argv[argv.indexOf(name) + 1]
  // --resume continues the session under its own id; with --fork-session it is a copy, and Claude Code reports a NEW id.
  let sessionId = argv.includes('--resume') ? (argv.includes('--fork-session') ? '77777777-6666-4555-8444-333333333333' : flag('--resume')) : '11111111-2222-4333-8444-555555555555'
  const emit = (m) => process.stdout.write(`${JSON.stringify({ ...m, session_id: sessionId })}\n`)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  // Tools that run without asking: --allowedTools a,b at start, and live rules.
  const allowed = new Set(argv.includes('--allowedTools') ? flag('--allowedTools').split(',') : [])
  const isAllowed = (tool) => allowed.has(tool) || allowed.has(tool.split('__').slice(0, 2).join('__'))

  let msgN = 0
  let turns = 0
  let interrupted = false
  let ignoreInterrupt = false

  const COMMANDS = [
    { name: 'compact', description: 'Clear conversation history but keep a summary in context', argumentHint: '<optional custom summarization instructions>' },
    { name: 'clear', description: 'Clear conversation history and free up context', argumentHint: '' },
    { name: 'context', description: 'Show current context usage', argumentHint: '' },
    { name: 'mcp', description: 'Show MCP server status', argumentHint: '' },
    { name: 'caveman:caveman-help', description: 'Quick-reference card of all caveman modes and commands.', argumentHint: '' },
    { name: 'aside', description: 'Answer a quick side question without interrupting the current task', argumentHint: '<question>' }
  ]
  const emitInit = () => {
    emit({
      type: 'system', subtype: 'init', cwd: process.cwd(), model: flag('--model') ? `claude-fake-${flag('--model')}` : 'claude-fake-1', permissionMode: flag('--permission-mode') ?? 'default',
      capabilities: ['interrupt_receipt_v1', 'interrupt_cancel_queued_v1'],
      tools: ['Glob', 'Bash', 'Read', 'Edit', 'mcp__fake_server__ping', 'mcp__fake_server__echo', 'mcp__claude_ai_Gmail__list_labels'],
      mcp_servers: [
        { name: 'fake_server', status: 'connected', source: 'user' }, { name: 'claude.ai Gmail', status: 'connected', source: 'claudeai' },
        { name: 'broken', status: 'failed', source: 'user' }, { name: 'slack', status: 'needs-auth', source: 'plugin' }, { name: 'later', status: 'pending', source: 'user' }
      ],
      slash_commands: COMMANDS.map((c) => c.name), terminal_slash_commands: ['doctor', 'color'], skills: ['caveman:caveman-help', 'aside'],
      agents: agentNames,
      plugins: [{ name: 'caveman', path: 'C:\\Users\\someone\\.claude\\plugins\\caveman', source: 'x@y', version: '1.2.3' }],
      output_style: 'default', claude_code_version: '9.9.9'
    })
    emit({ type: 'system', subtype: 'commands_changed', commands: COMMANDS })
  }
  emitInit()

  const startMessage = (id) => emit({ type: 'stream_event', event: { type: 'message_start', message: { id, type: 'message', role: 'assistant', content: [] } }, parent_tool_use_id: null })
  const endMessage = (stop) => {
    emit({ type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: stop } }, parent_tool_use_id: null })
    emit({ type: 'stream_event', event: { type: 'message_stop' }, parent_tool_use_id: null })
  }

  async function say(text, { pace = 4, until = () => false } = {}) {
    const id = `msg_fake_${++msgN}`
    startMessage(id)
    emit({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, parent_tool_use_id: null })
    let shown = ''
    for (const word of text.split(/(?<= )/)) {
      if (until()) break
      shown += word
      emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: word } }, parent_tool_use_id: null })
      await sleep(pace)
    }
    emit({ type: 'assistant', message: { id, role: 'assistant', content: [{ type: 'text', text: shown }] }, parent_tool_use_id: null })
    emit({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 }, parent_tool_use_id: null })
    endMessage('end_turn')
    return shown
  }

  async function useTool(name, input, resultText, isError = false) {
    const id = `msg_fake_${++msgN}`
    const toolId = `toolu_fake_${msgN}`
    startMessage(id)
    emit({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: toolId, name, input: {} } }, parent_tool_use_id: null })
    emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }, parent_tool_use_id: null })
    emit({ type: 'assistant', message: { id, role: 'assistant', content: [{ type: 'tool_use', id: toolId, name, input }] }, parent_tool_use_id: null })
    emit({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 }, parent_tool_use_id: null })
    endMessage('tool_use')
    await sleep(20)
    emit({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: resultText, ...(isError ? { is_error: true } : {}) }] }, parent_tool_use_id: null })
    return { toolId }
  }

  function result(extra = {}) {
    turns++
    emit({
      type: 'result', subtype: 'success', is_error: false, duration_ms: 40, num_turns: turns, total_cost_usd: Math.round(turns * 0.0123 * 1e4) / 1e4,
      usage: { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 12 }, permission_denials: [], result: '', ...extra
    })
  }

  /** A local command: answered by Claude Code itself, no model, cost 0. */
  function local(command, text) {
    emit({ type: 'assistant', message: { id: `local_${++msgN}`, model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text }] }, parent_tool_use_id: null, local_command_run: { command, args: '' } })
    emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 3, num_turns: 0, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 }, permission_denials: [], result: '', local_command: command })
  }

  async function turn(prompt) {
    interrupted = false
    const p = prompt.toLowerCase().trim()
    if (p === '/context') return local('context', '## Context Usage\n\n| Category | Tokens |\n|---|---|\n| System | 1k |')
    if (p === '/mcp') return local('mcp', '5 MCP server(s): 2 connected, 1 connecting, 2 not connected, 0 disabled.')
    if (p === '/clear') {
      emit({ type: 'conversation_reset', new_conversation_id: 'nc', trigger: 'clear', uuid: 'nc' })
      sessionId = '99999999-8888-4777-8666-555555555555'
      emitInit()
      return local('clear', '')
    }
    if (p.startsWith('/')) {
      await say(`Skill ran: ${prompt.trim()}`)
      return result()
    }
    if (p.includes('crash')) {
      process.stderr.write('boom: the fake crashed\n')
      process.exit(3)
    }
    if (p.includes('signin')) return result({ subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' })
    if (p.includes('slow') || p.includes('hang')) {
      ignoreInterrupt = p.includes('hang')
      await say('Working on it slowly. '.repeat(200), { pace: 100, until: () => interrupted })
      return interrupted ? result({ subtype: 'error_during_execution', is_error: true, result: '' }) : result()
    }
    if (p.includes('mcp')) {
      const tool = 'mcp__fake_server__ping'
      const ran = isAllowed(tool)
      const text = ran ? 'pong' : "Claude requested permissions to use mcp__fake_server__ping, but you haven't granted it yet."
      const { toolId } = await useTool(tool, { message: 'hi' }, text, !ran)
      await say(ran ? 'The server answered: pong.' : 'I could not call the server because permission was not given.')
      return result(ran ? {} : { permission_denials: [{ tool_name: tool, tool_use_id: toolId, tool_input: { message: 'hi' } }] })
    }
    if (p.includes('tool')) {
      await useTool('Glob', { pattern: 'scripts/**/*', path: process.cwd() }, 'scripts\\a.mjs\nscripts\\b.mjs')
      await say('Two files in scripts: a.mjs and b.mjs.')
      return result()
    }
    if (p.includes('denied') && !isAllowed('Bash(npm test)')) {
      const { toolId } = await useTool('Bash', { command: 'npm test' }, "Claude requested permissions to use Bash, but you haven't granted it yet.", true)
      await say('I could not run the tests because permission was not given.')
      return result({ permission_denials: [{ tool_name: 'Bash', tool_use_id: toolId, tool_input: { command: 'npm test' } }] })
    }
    if (p.includes('denied')) {
      await useTool('Bash', { command: 'npm test' }, 'PASS 2 tests', false)
      await say('The tests passed.')
      return result()
    }
    if (p.includes('secret')) {
      await say('Use this key: sk-ant-api03-FAKEFAKEFAKEFAKEFAKE and password=hunter2 for the demo.')
      return result()
    }
    await say(`Fake reply to: ${prompt}`)
    return result()
  }

  let chain = Promise.resolve()
  const rl = createInterface({ input: process.stdin })
  rl.on('line', (line) => {
    log(`IN ${line}`)
    let m
    try {
      m = JSON.parse(line)
    } catch {
      return
    }
    if (m.type === 'control_request' && m.request?.subtype === 'interrupt') {
      if (!ignoreInterrupt) {
        interrupted = true
        emit({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: { still_queued: [] } } })
      }
      return
    }
    if (m.type === 'control_request' && m.request?.subtype === 'apply_flag_settings') {
      const rules = m.request.settings?.permissions?.allow
      if (process.env.FAKE_CLAUDE_NO_LIVE_ALLOW || !Array.isArray(rules)) {
        emit({ type: 'control_response', response: { subtype: 'error', request_id: m.request_id, error: 'not supported' } })
      } else {
        for (const r of rules) allowed.add(r)
        emit({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id } })
      }
      return
    }
    if (m.type === 'user') {
      const content = m.message?.content
      const text = typeof content === 'string' ? content : (content ?? []).map((b) => b.text ?? '').join('')
      chain = chain.then(() => turn(text))
    }
  })
  rl.on('close', () => {
    void chain.then(() => process.exit(0))
  })
}
