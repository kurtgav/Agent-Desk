import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ConsoleBody } from '@shared/console'
import { RESULT_MAX, StreamMapper, type Mapped } from './console-parse'
import { LineSplitter, classify, maskText, redactBody, summarizeTool } from './console-text'

const fixture = (name: string): string[] =>
  readFileSync(fileURLToPath(new URL(`../../test/fixtures/console/${name}`, import.meta.url)), 'utf8').split('\n').filter(Boolean)

/** Everything a fixture maps to, in order (what main would publish before throttling). */
function mapAll(lines: string[], cwd = 'C:\\work\\demo-app', resumed = false): { mapper: StreamMapper; all: Mapped[]; bodies: ConsoleBody[] } {
  const mapper = new StreamMapper(cwd, resumed)
  const all = lines.map((l) => mapper.map(l))
  return { mapper, all, bodies: all.flatMap((m) => m.drafts) }
}

describe('LineSplitter', () => {
  it('joins a line that arrives in pieces and drops blank lines and the CR of CRLF', () => {
    const s = new LineSplitter()
    expect(s.push('{"a":')).toEqual([])
    expect(s.push('1}\r\n\r\n{"b"')).toEqual(['{"a":1}'])
    expect(s.push(':2}\n{"c":3}\n')).toEqual(['{"b":2}', '{"c":3}'])
  })

  it('hands back a last line that has no newline, once', () => {
    const s = new LineSplitter()
    s.push('{"x":1}')
    expect(s.flush()).toEqual(['{"x":1}'])
    expect(s.flush()).toEqual([])
  })

  it('drops a line longer than the limit without buffering it, then carries on with the next', () => {
    const s = new LineSplitter(10)
    expect(s.push('x'.repeat(8))).toEqual([])
    expect(s.push('x'.repeat(8))).toEqual([]) // now over the limit: skipping
    expect(s.push('xxxx\nok\n')).toEqual(['ok'])
    expect(s.dropped).toBe(1)
  })
})

describe('a real turn (Claude Code 2.1.323, the single word OK)', () => {
  const { all, bodies, mapper } = mapAll(fixture('turn-ok.jsonl'))

  it('reports the session on init and nothing else for the system lines', () => {
    const init = all.find((m) => m.init)?.init
    expect(init).toMatchObject({ sessionId: '00000000-0000-4000-8000-000000000001', model: 'claude-sonnet-5-5' })
    expect(init?.protocol).toContain('interrupt_cancel_queued_v1')
    expect(mapper.skipped).toBe(0)
  })

  it('streams the text as its whole-so-far and settles it with a final', () => {
    const texts = bodies.filter((b) => b.kind === 'assistant-text')
    expect(texts.map((t) => [t.text, t.final])).toEqual([['OK', false], ['OK', true]])
    expect(new Set(texts.map((t) => t.messageId)).size).toBe(1)
  })

  it('ends the turn with cost, tokens and duration', () => {
    const end = bodies.find((b) => b.kind === 'turn-end')
    expect(end).toMatchObject({ costUsd: 0.51942, totalCostUsd: 0.51942, inputTokens: 129_846, outputTokens: 4, durationMs: 6653, interrupted: false, error: null })
    expect(all.at(-1)?.turnEnded).toBe(true)
  })
})

describe('a real turn with a read-only tool', () => {
  const { bodies } = mapAll(fixture('turn-tool.jsonl'))

  it('shows the call as a one-line summary with its input', () => {
    const use = bodies.find((b) => b.kind === 'tool-use')
    expect(use).toMatchObject({ name: 'Glob', summary: 'Find files: scripts/**/*' })
    expect(JSON.parse(use?.kind === 'tool-use' ? use.input : '{}')).toMatchObject({ pattern: 'scripts/**/*' })
  })

  it('matches the result to the call and keeps its text', () => {
    const use = bodies.find((b) => b.kind === 'tool-use')
    const res = bodies.find((b) => b.kind === 'tool-result')
    expect(res).toMatchObject({ ok: true, truncated: false })
    expect(res?.kind === 'tool-result' && res.toolUseId).toBe(use?.kind === 'tool-use' && use.toolUseId)
    expect(res?.kind === 'tool-result' && res.text).toContain('scripts\\make-icons.ps1')
  })

  it('ends the turn once, with the cost of the whole turn and every model call in its tokens', () => {
    const ends = bodies.filter((b) => b.kind === 'turn-end')
    expect(ends).toHaveLength(1)
    expect(ends[0]).toMatchObject({ costUsd: 0.2905957, outputTokens: 224 })
    const text = bodies.filter((b) => b.kind === 'assistant-text' && b.final).at(-1)
    expect(text?.kind === 'assistant-text' && text.text).toContain('Files in `scripts/`')
  })
})

describe('lines that are not what we expect', () => {
  it('never throws on malformed, partial, unknown or oddly shaped lines', () => {
    const lines = [
      '', '{', 'not json', '[]', '"a string"', 'null', '{"type":5}', '{"type":"future_thing","x":{"y":[1,2,3]}}',
      '{"type":"stream_event"}', '{"type":"stream_event","event":{"type":"content_block_delta","index":"0","delta":{"type":"text_delta","text":7}}}',
      '{"type":"assistant","message":{"content":[null,5,{"type":"text"},{"type":"tool_use"},{"type":"tool_use","id":"t1"}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result"},{"type":"tool_result","tool_use_id":"t1","content":[{"type":"text","text":"hi"},{"type":"image"}]}]}}',
      '{"type":"system","subtype":"init"}', '{"type":"result"}'
    ]
    const { mapper, bodies } = mapAll(lines)
    expect(mapper.skipped).toBeGreaterThanOrEqual(6)
    expect(bodies.find((b) => b.kind === 'tool-result')).toMatchObject({ toolUseId: 't1', ok: true, text: 'hi\n[image]' })
    expect(bodies.find((b) => b.kind === 'tool-use')).toMatchObject({ toolUseId: 't1', name: 'Tool' })
    expect(bodies.at(-1)?.kind).toBe('turn-end')
  })

  it('ignores a message from inside a subagent (the call that started it stands for it)', () => {
    const m = new StreamMapper('C:\\p', false)
    const line = JSON.stringify({ type: 'assistant', parent_tool_use_id: 'toolu_x', message: { id: 'm', content: [{ type: 'text', text: 'inner' }] } })
    expect(m.map(line).drafts).toEqual([])
  })

  it('settles an assistant message even when nothing streamed before it', () => {
    const m = new StreamMapper('C:\\p', false)
    const out = m.map(JSON.stringify({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Hello' }, { type: 'thinking', thinking: 'hmm' }] } }))
    expect(out.drafts).toMatchObject([
      { kind: 'assistant-text', text: 'Hello', final: true },
      { kind: 'thinking', text: 'hmm', final: true }
    ])
  })

  it('streams a thinking block apart from the text', () => {
    const m = new StreamMapper('C:\\p', false)
    const ev = (event: unknown): Mapped => m.map(JSON.stringify({ type: 'stream_event', event, parent_tool_use_id: null }))
    ev({ type: 'message_start', message: { id: 'a' } })
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } })
    expect(ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me ' } }).drafts[0]).toMatchObject({ kind: 'thinking', text: 'Let me ', final: false })
    expect(ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'see' } }).drafts[0]).toMatchObject({ kind: 'thinking', text: 'Let me see' })
    expect(ev({ type: 'content_block_stop', index: 0 }).drafts[0]).toMatchObject({ kind: 'thinking', final: true })
  })
})

describe('turns and cost', () => {
  const result = (total: number): string => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: total, usage: { output_tokens: 1 } })
  const costOf = (m: Mapped): unknown[] => {
    const end = m.drafts.find((d) => d.kind === 'turn-end')
    return end?.kind === 'turn-end' ? [end.costUsd, end.totalCostUsd] : []
  }

  it('gives each turn its own share of the running total', () => {
    const m = new StreamMapper('C:\\p', false)
    expect([0.5, 0.75, 1].map((t) => costOf(m.map(result(t))))).toEqual([[0.5, 0.5], [0.25, 0.75], [0.25, 1]])
  })

  it('does not know the first turn of a resumed session (its total includes earlier runs)', () => {
    const m = new StreamMapper('C:\\p', true)
    expect([3, 3.5].map((t) => costOf(m.map(result(t))))).toEqual([[null, 3], [0.5, 3.5]])
  })

  it('says what went wrong in words, and which problem the user fixes elsewhere', () => {
    const m = new StreamMapper('C:\\p', false)
    const signedOut = m.map(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' }))
    expect(signedOut.problem).toBe('signed-out')
    expect(signedOut.drafts.at(-1)).toMatchObject({ kind: 'turn-end', error: 'Not logged in · Please run /login' })
    const turns = m.map(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true }))
    expect(turns.problem).toBeUndefined()
    expect(turns.drafts.at(-1)).toMatchObject({ error: 'Claude reached its limit of steps for one request.' })
  })

  it('reports a tool nobody approved once, with what it tried to run', () => {
    const m = new StreamMapper('C:\\p', false)
    const live = m.map(JSON.stringify({ type: 'system', subtype: 'permission_denied', tool_name: 'Bash', tool_use_id: 'toolu_1' }))
    expect(live.drafts).toEqual([{ kind: 'permission-denied', toolUseId: 'toolu_1', name: 'Bash', summary: 'Bash', rule: null }])
    const denials = [
      { tool_name: 'Bash', tool_use_id: 'toolu_1', tool_input: { command: 'npm test' } },
      { tool_name: 'Edit', tool_use_id: 'toolu_2', tool_input: { file_path: 'C:\\p\\src\\a.ts' } }
    ]
    const end = m.map(JSON.stringify({ type: 'result', subtype: 'success', permission_denials: denials }))
    expect(end.drafts.filter((d) => d.kind === 'permission-denied')).toEqual([{ kind: 'permission-denied', toolUseId: 'toolu_2', name: 'Edit', summary: 'Edit src/a.ts', rule: 'Edit' }])
  })
})

describe('summarizeTool', () => {
  const cwd = 'C:\\work\\demo-app'
  it.each([
    ['Edit', { file_path: 'C:\\work\\demo-app\\src\\App.tsx' }, 'Edit src/App.tsx'],
    ['Edit', { file_path: 'c:/WORK/demo-app/src/App.tsx' }, 'Edit src/App.tsx'],
    ['Write', { file_path: 'D:\\elsewhere\\notes.md' }, 'Write D:\\elsewhere\\notes.md'],
    ['MultiEdit', { file_path: 'C:\\work\\demo-app\\a.ts', edits: [] }, 'Edit a.ts'],
    ['Read', { file_path: 'C:\\work\\demo-app\\package.json' }, 'Read package.json'],
    ['Bash', { command: 'npm test -- --run\n  && echo done' }, 'Run: npm test -- --run && echo done'],
    ['Glob', { pattern: 'src/**/*.ts' }, 'Find files: src/**/*.ts'],
    ['Grep', { pattern: 'TODO' }, 'Search for "TODO"'],
    ['WebFetch', { url: 'https://example.com/docs?q=1' }, 'Fetch example.com'],
    ['Task', { description: 'Review the diff' }, 'Subagent: Review the diff'],
    ['TodoWrite', { todos: [] }, 'Update the to-do list'],
    ['SomethingNew', { x: 1 }, 'SomethingNew'],
    ['Bash', null, 'Bash']
  ])('%s %j', (name, input, expected) => {
    expect(summarizeTool(name, input, cwd)).toBe(expected)
  })

  it('cuts a very long command to one line', () => {
    const s = summarizeTool('Bash', { command: 'x'.repeat(500) }, cwd)
    expect(s.length).toBeLessThan(130)
    expect(s.endsWith('…')).toBe(true)
  })
})

describe('redaction before text leaves main', () => {
  it('masks a secret in a tool input', () => {
    const m = new StreamMapper('C:\\p', false)
    const input = { command: 'curl -H "Authorization: Bearer abcdef123456" http://x', api_key: 'sk-ant-api03-ZZZZZZZZZZ' }
    const use = m.map(JSON.stringify({ type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 't', name: 'Bash', input }] } }))
    expect(JSON.stringify(redactBody(use.drafts[0]!))).not.toMatch(/abcdef123456|ZZZZZZ/)
  })

  it('keeps a long tool result to a few KB and says so', () => {
    const m = new StreamMapper('C:\\p', false)
    const big = 'line of output\n'.repeat(1000)
    const out = m.map(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: big }] } }))
    const r = out.drafts[0]
    expect(r).toMatchObject({ kind: 'tool-result', truncated: true })
    expect(r?.kind === 'tool-result' && r.text.length).toBe(RESULT_MAX)
  })

  it('masks text longer than maskSecrets scans, without cutting it short', () => {
    const long = `${'a plain sentence with words in it. '.repeat(1200)}\nthe key is sk-ant-api03-LEAKLEAKLEAK and more text follows\n${'tail '.repeat(100)}`
    const masked = maskText(long)
    expect(masked).not.toContain('LEAKLEAK')
    expect(masked.length).toBeGreaterThan(40_000)
    expect(masked.endsWith('tail ')).toBe(true)
  })

  it('keeps a private key block whole when masking in pieces', () => {
    const key = `-----BEGIN RSA PRIVATE KEY-----\n${'MIIEowIBAAKCAQEA'.repeat(40)}\n-----END RSA PRIVATE KEY-----\n`
    const long = `${'filler line\n'.repeat(1000)}${key}${'after\n'.repeat(10)}`
    expect(maskText(long)).not.toContain('MIIEow')
  })

  it('masks the text events a page would see', () => {
    expect(redactBody({ kind: 'assistant-text', messageId: 'm', text: 'password=hunter2 ok', final: true })).toMatchObject({ text: 'password=••• ok' })
    expect(redactBody({ kind: 'user', text: 'token: sk-ant-abc123' })).toMatchObject({ text: 'token: •••' })
  })
})

describe('classify', () => {
  it.each([
    ['Workspace not trusted. Run `claude` in C:\\x once', 'untrusted'],
    ['Not logged in · Please run /login', 'signed-out'],
    ['OAuth token has expired', 'signed-out'],
    ['SessionEnd hook failed: connect ECONNREFUSED', null],
    ['', null]
  ])('%s', (text, problem) => {
    expect(classify(text)).toBe(problem)
  })
})
