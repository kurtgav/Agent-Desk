import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HOOK_FIXTURES, fixture, s1Deliveries } from './fixtures'
import { activityText, normalizeHook } from './normalize'
import { maskSecrets } from './redact'

const TS = 1_793_822_576_128
const norm = (body: unknown) => normalizeHook(JSON.stringify(body), TS)

describe('hook fixtures (2.1.318)', () => {
  // Ported from spikes/check-fixtures.mjs: the fields EVENT_SCHEMA maps from must exist in every real payload.
  const REQUIRED: Record<string, string[]> = {
    UserPromptSubmit: ['prompt'],
    PreToolUse: ['tool_name', 'tool_input', 'tool_use_id'],
    PostToolUse: ['tool_name', 'tool_input', 'tool_use_id', 'tool_response'],
    PostToolUseFailure: ['tool_name', 'tool_input', 'tool_use_id', 'error'],
    PermissionRequest: ['tool_name', 'tool_input'],
    SubagentStart: ['agent_id', 'agent_type'],
    SubagentStop: ['agent_id', 'agent_type', 'last_assistant_message'],
    TaskCreated: ['task_id', 'task_subject'],
    TaskCompleted: ['task_id', 'task_subject'],
    Stop: ['last_assistant_message', 'stop_hook_active'],
    SessionEnd: ['reason']
  }
  const files = readdirSync(HOOK_FIXTURES).filter((f) => f.endsWith('.json'))

  it.each(files)('%s has the fields EVENT_SCHEMA reads', (f) => {
    const j = JSON.parse(readFileSync(join(HOOK_FIXTURES, f), 'utf8')) as Record<string, unknown>
    const ev = String(j.hook_event_name)
    for (const k of ['session_id', 'hook_event_name', 'cwd', ...(REQUIRED[ev] ?? [])]) expect(j, k).toHaveProperty(k)
    if (ev === 'PermissionRequest') expect(j).not.toHaveProperty('tool_use_id') // spike S4
  })

  it('every delivery normalizes to a known kind', () => {
    const kinds = s1Deliveries().map((d) => normalizeHook(d.raw, d.ts)!.kind)
    expect(kinds).not.toContain('unknown')
    expect(kinds.filter((k) => k === 'session.notified')).toHaveLength(1)
    expect(new Set(kinds)).toEqual(
      new Set([
        'session.prompt', 'session.notified', 'tool.started', 'tool.finished', 'tool.failed', 'permission.requested',
        'turn.stopped', 'session.ended', 'subagent.started', 'subagent.stopped', 'task.created', 'task.completed'
      ])
    )
  })
})

describe('normalizeHook', () => {
  it('keeps ids and attribution, drops transcript paths', () => {
    const ev = norm(fixture('SubagentStop-1'))!
    expect(ev).toMatchObject({ source: 'hook', kind: 'subagent.stopped', agentId: 'adb875602d90356fb', agentType: 'Explore', ts: TS })
    expect(ev.payload).not.toHaveProperty('transcript_path')
    expect(ev.payload).not.toHaveProperty('agent_transcript_path')
    expect(ev.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('keeps file bodies to their size, in the input and in the response', () => {
    const write = norm(fixture('PreToolUse-3'))!
    expect(write.payload.tool_input).toMatchObject({ file_path: expect.stringMatching(/hello\.txt$/), content: '<2 chars>' })
    const edit = norm(fixture('PostToolUse-3'))!
    expect(edit.payload.tool_input).toMatchObject({ old_string: '<2 chars>', new_string: '<5 chars>' })
    expect(edit.payload.tool_response).toMatch(/^<\d+ chars>$/)
  })

  it('tells a real prompt from a background-task report', () => {
    expect(norm({ session_id: 's', hook_event_name: 'UserPromptSubmit', prompt: 'fix it' })!.kind).toBe('session.prompt')
    expect(norm({ session_id: 's', hook_event_name: 'UserPromptSubmit', prompt: '<task-notification>…' })!.kind).toBe('session.notified')
  })

  it('stores unknown events instead of rejecting them', () => {
    expect(norm({ session_id: 's', hook_event_name: 'SomethingNew', extra: 1 })).toMatchObject({ kind: 'unknown', summary: 'SomethingNew' })
  })

  it('drops bodies that are not hook events', () => {
    expect(normalizeHook('not json', TS)).toBeNull()
    expect(norm({ hook_event_name: 'Stop' })).toBeNull()
    expect(norm([1, 2])).toBeNull()
  })

  it('gives identical deliveries the same dedupe key', () => {
    const raw = JSON.stringify(fixture('PreToolUse-1'))
    expect(normalizeHook(raw, 1)!.dedupeKey).toBe(normalizeHook(raw, 2)!.dedupeKey)
    expect(normalizeHook(raw, 1)!.id).not.toBe(normalizeHook(raw, 1)!.id)
  })

  it('masks secrets in commands before the summary is built', () => {
    const ev = norm({ session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 't', tool_input: { command: 'curl -H "Authorization: Bearer abc.def" x' } })!
    expect(ev.summary).not.toContain('abc.def')
    expect(JSON.stringify(ev.payload)).not.toContain('abc.def')
  })
})

describe('activityText (EVENT_SCHEMA § Activity text)', () => {
  const cwd = 'D:\\proj'
  it.each([
    ['Edit', { file_path: 'D:\\Proj\\src\\app.tsx' }, 'Editing `src\\app.tsx`'],
    ['Write', { file_path: 'C:\\other\\a.md' }, 'Editing `C:\\other\\a.md`'],
    ['Read', { file_path: 'D:\\proj\\README.md' }, 'Reading `README.md`'],
    ['Bash', { command: 'npm   test' }, 'Running `npm test`'],
    ['PowerShell', { command: 'echo `x`' }, "Running `echo 'x'`"],
    ['Bash', { command: 'x'.repeat(80) }, `Running \`${'x'.repeat(60)}…\``],
    ['Grep', { pattern: 'auth' }, 'Searching "auth"'],
    ['Glob', { pattern: '**/*.ts' }, 'Finding files `**/*.ts`'],
    ['Agent', { subagent_type: 'Explore' }, 'Delegating to Explore'],
    ['WebFetch', { url: 'https://example.com/a' }, 'Fetching example.com'],
    ['WebSearch', { query: 'zod v4' }, 'Searching the web for "zod v4"'],
    ['AskUserQuestion', { questions: [{ question: 'Which DB?' }] }, 'Asking you: Which DB?'],
    ['ExitPlanMode', {}, 'Plan ready for your review'],
    ['TaskCreate', {}, 'Updating the plan'],
    ['mcp__github__create_issue', {}, 'Using github · create_issue'],
    ['ToolSearch', {}, 'Using ToolSearch']
  ])('%s', (tool, input, text) => {
    expect(activityText(tool, input, cwd)).toBe(text)
  })
})

describe('maskSecrets (EVENT_SCHEMA § Redaction)', () => {
  it.each([
    ['api_key=abc123', 'api_key=•••'],
    ['TOKEN: xyz', 'TOKEN: •••'],
    ['Authorization: Bearer abc', 'Authorization: •••'],
    ['key sk-ant-api03-AbC_d-1', 'key •••'],
    [`sk-${'a'.repeat(24)}`, '•••'],
    [`ghp_${'A'.repeat(36)}`, '•••'],
    ['github_pat_11AB_cd', '•••'],
    ['xoxb-123-abc', '•••'],
    ['AKIAABCDEFGHIJKLMNOP', '•••'],
    ['eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl', '•••'],
    ['https://user:hunter2@host/x', 'https://user:•••@host/x'],
    ['-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----', '•••'],
    // Shapes from the M2 security review (HIGH-2)
    ['export NPM_TOKEN=abc123def', 'export NPM_TOKEN=•••'],
    ['DB_PASSWORD=hunter2 node app.js', 'DB_PASSWORD=••• node app.js'],
    ['AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG', 'AWS_SECRET_ACCESS_KEY=•••'],
    ['GITHUB_TOKEN=gho_x', 'GITHUB_TOKEN=•••'],
    ['{"password": "hunter2", "user": "kurt"}', '{"password": "•••", "user": "kurt"}'],
    ['{\\"api_key\\":\\"abc\\"}', '{\\"api_key\\":\\"•••\\"}'], // JSON escaped inside a tool's stdout
    ['mysql --password hunter2 -u root', 'mysql --password ••• -u root'],
    ['cli --api-key=abc', 'cli --api-key=•••'],
    [`sk-proj-${'a'.repeat(24)}`, '•••'],
    [`sk_live_${'a'.repeat(24)}`, '•••'],
    [`AIza${'b'.repeat(35)}`, '•••'],
    [`glpat-${'c'.repeat(20)}`, '•••'],
    [`npm_${'d'.repeat(36)}`, '•••'],
    // A key cut off by a cap upstream has no END line: everything after BEGIN goes
    ['before -----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk', 'before •••']
  ])('%s', (input, masked) => {
    expect(maskSecrets(input)).toBe(masked)
  })

  it('leaves ordinary text alone', () => {
    expect(maskSecrets('git push origin main && npm test')).toBe('git push origin main && npm test')
    expect(maskSecrets('risk-assessment-for-the-project-plan.md')).toBe('risk-assessment-for-the-project-plan.md')
  })

  it('stays linear on hostile input (security review MEDIUM-4)', () => {
    const hostile = [
      'a'.repeat(200_000), // the URL rule was quadratic on a long word: 45 s at 200 KB
      '://a:'.repeat(40_000),
      'eyJ-'.repeat(50_000),
      `token${' '.repeat(100_000)}`,
      '-----BEGIN '.repeat(20_000),
      `--password${' '.repeat(100_000)}`
    ]
    for (const s of hostile) {
      const t = performance.now()
      maskSecrets(s)
      expect(performance.now() - t, s.slice(0, 12)).toBeLessThan(250)
    }
  })
})

describe('redaction order and limits (security review HIGH-1, LOW-5)', () => {
  const PEM = `-----BEGIN RSA PRIVATE KEY-----\n${'A'.repeat(3000)}\n-----END RSA PRIVATE KEY-----`

  it('masks before capping, so a cap can not cut a key out of its pattern', () => {
    const prompt = norm({ session_id: 's', hook_event_name: 'UserPromptSubmit', prompt: `use ${PEM}` })!
    expect(prompt.payload.prompt).toBe('use •••')
    const bash = norm({
      session_id: 's', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 't',
      tool_input: { command: 'cat id_rsa' }, tool_response: { stdout: `${'x'.repeat(1000)}${PEM}` }
    })!
    expect(JSON.stringify(bash.payload)).not.toContain('AAAA')
  })

  it('masks string values under secret-named keys, whatever their shape', () => {
    const ev = norm({ session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'mcp__db__connect', tool_use_id: 't', tool_input: { password: 'p@ss w0rd', host: 'db' } })!
    expect(ev.payload.tool_input).toEqual({ password: '•••', host: 'db' })
  })

  it('treats prototype names as unknown events instead of reading Object.prototype', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(norm({ session_id: 's', hook_event_name: name })).toMatchObject({ kind: 'unknown' })
    }
  })

  it('survives hostile nesting without blowing the stack', () => {
    const deep = `{"session_id":"s","hook_event_name":"PreToolUse","tool_input":${'['.repeat(5000)}${']'.repeat(5000)}}`
    expect(() => normalizeHook(deep, TS)).not.toThrow()
    expect(JSON.stringify(normalizeHook(deep, TS)!.payload)).toContain('<nested too deep>')
  })
})
