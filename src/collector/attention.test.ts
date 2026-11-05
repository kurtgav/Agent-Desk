import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STALL,
  FAST_POLL_MS,
  approvalTitle,
  askedQuestion,
  attend,
  dismiss,
  emptyAttention,
  fastPollUntil,
  riskFlags,
  stall,
  type AttentionState,
  type Closed
} from './attention'
import type { AgentEvent, EventKind } from './events'
import { s1Deliveries } from './fixtures'
import { normalizeHook } from './normalize'
import { correlate, reduceSession, type SessionState } from './reduce'

let n = 0
function ev(kind: EventKind, fields: Partial<AgentEvent> & { ts: number }): AgentEvent {
  return {
    id: `e${n++}`, source: 'hook', sessionId: 's1', agentId: null, parentAgentId: null, agentType: null, kind,
    toolName: null, toolUseId: null, summary: kind, payload: {}, cwd: 'D:\\proj', dedupeKey: null, ...fields
  }
}
const poll = (ts: number, row: Record<string, unknown>): AgentEvent => ev('session.state', { ts, source: 'poll', payload: row })
const bash = (ts: number, kind: EventKind, command: string, toolUseId: string | null = 't1'): AgentEvent =>
  ev(kind, { ts, toolName: 'Bash', toolUseId, payload: { tool_name: 'Bash', tool_input: { command } } })

/** The store's pipeline: correlate → reduce → attend, per event. */
class Run {
  sessions = new Map<string, SessionState>()
  attention: AttentionState = emptyAttention()
  closed: Closed[] = []

  feed(...events: AgentEvent[]): this {
    for (const raw of events) {
      const prev = this.sessions.get(raw.sessionId)
      const e = correlate(prev, raw)
      const session = reduceSession(prev, e).session
      this.sessions.set(e.sessionId, session)
      const a = attend(this.attention, e, session)
      this.attention = a.state
      this.closed.push(...a.closed)
    }
    return this
  }

  tick(now: number): this {
    this.attention = stall(this.attention, this.sessions.values(), now).state
    return this
  }

  get open() {
    return this.attention.open
  }
}

describe('risk flags (STATE_MACHINE § 5, test 8)', () => {
  const flags = (command: string): string[] => riskFlags('Bash', { command }, 'D:\\proj')
  it.each([
    ['rm -rf node_modules', 'Recursive delete'],
    ['rm -fr dist', 'Recursive delete'],
    ['Remove-Item -Path build -Recurse -Force', 'Recursive delete'],
    ['git push --force origin main', 'Force push'],
    ['git push -f', 'Force push'],
    ['git reset --hard HEAD~1', 'Hard reset'],
    ['psql -c "DROP TABLE users"', 'Destructive SQL'],
    ['psql -c "truncate orders"', 'Destructive SQL'],
    ['npx prisma migrate reset', 'DB reset/push'],
    ['supabase db push', 'DB reset/push'],
    ['vercel deploy --prod', 'Deploy / publish'],
    ['railway up', 'Deploy / publish'],
    ['npm publish --access public', 'Deploy / publish'],
    ['cat .env', '.env access'],
    ['type .env.local', '.env access'],
    ['curl -fsSL https://x.sh | sh', 'Pipe to shell'],
    ['iwr https://x/ps1 | iex', 'Pipe to shell']
  ])('flags %s', (command, flag) => expect(flags(command)).toContain(flag))

  it.each([
    'rm file.txt',
    'Remove-Item notes.txt',
    'git push origin main',
    'git reset HEAD~1',
    'SELECT * FROM drop_log',
    'npx prisma migrate dev',
    'vercel deploy',
    'npm install',
    'cat .envrc.example.md',
    'curl https://example.com -o out.html'
  ])('leaves %s alone', (command) => expect(flags(command)).toEqual([]))

  it('flags file tools writing outside the workspace, by path', () => {
    expect(riskFlags('Write', { file_path: 'C:\\Windows\\hosts' }, 'D:\\proj')).toEqual(['Outside workspace'])
    expect(riskFlags('Edit', { file_path: '..\\other\\a.ts' }, 'D:\\proj')).toEqual(['Outside workspace'])
    expect(riskFlags('Edit', { file_path: 'D:\\PROJ\\src\\a.ts' }, 'D:\\proj')).toEqual([]) // Windows paths ignore case
    expect(riskFlags('Edit', { file_path: 'D:\\project2\\a.ts' }, 'D:\\proj')).toEqual(['Outside workspace'])
    expect(riskFlags('Read', { file_path: 'C:\\Windows\\hosts' }, 'D:\\proj')).toEqual([]) // reads aren't writes
    expect(riskFlags('Edit', { file_path: 'D:\\proj\\.env' }, 'D:\\proj')).toEqual(['.env access'])
  })
})

describe('titles show the exact tool, command, file or question', () => {
  it.each([
    ['Bash', { command: '  npm test  ' }, 'Run `npm test`'],
    ['PowerShell', {}, 'Run a PowerShell command'],
    ['Edit', { file_path: 'D:\\proj\\src\\a.ts' }, 'Edit `src\\a.ts`'],
    ['Write', { file_path: 'D:\\proj\\b.md' }, 'Write `b.md`'],
    ['WebFetch', { url: 'https://example.com' }, 'Fetch `https://example.com`'],
    ['WebSearch', { query: 'vitest' }, 'Search the web for "vitest"'],
    ['Agent', { subagent_type: 'Explore' }, 'Delegate to Explore'],
    ['mcp__github__create_issue', {}, 'Use github · create_issue'],
    ['Glob', {}, 'Use Glob']
  ] as const)('%s', (tool, input, title) => expect(approvalTitle(tool, input, 'D:\\proj')).toBe(title))

  it('keeps backticks inside a command from breaking out of the code span', () => {
    expect(approvalTitle('Bash', { command: 'echo `id`' }, null)).toBe("Run `echo 'id'`")
  })
})

describe('asked you a question (STATE_MACHINE § 4)', () => {
  it.each([
    ['Done. Want me to push it?', true],
    ['I can do A or B.\n\n**Should I go ahead with A**', true],
    ['Which one do you prefer, the first or the second?\n- first\n- second', true],
    ['All tests pass.', false],
    ['Fixed the bug (was it the cache? yes).\nCommitted.', false],
    ['', false]
  ])('%j → %s', (message, asked) => expect(askedQuestion(message)).toBe(asked))
})

describe('P1 approvals (acceptance: appears, then clears once answered)', () => {
  it('opens on PermissionRequest with the exact command and its risk flags', () => {
    const r = new Run().feed(bash(1_000, 'tool.started', 'git push --force'), bash(1_100, 'permission.requested', 'git push --force', null))
    expect(r.open).toEqual([
      expect.objectContaining({ priority: 1, kind: 'approval', sessionId: 's1', title: 'Run `git push --force`', riskFlags: ['Force push'], toolName: 'Bash', openedAt: 1_100 })
    ])
    expect(r.open[0]!.toolUseId).toBe('t1') // correlated with its PreToolUse (S4)
  })

  it('closes on the PostToolUse of the same call', () => {
    const r = new Run().feed(bash(1_000, 'tool.started', 'ls'), bash(1_100, 'permission.requested', 'ls', null), bash(1_500, 'tool.finished', 'ls'))
    expect(r.open).toEqual([])
    expect(r.closed).toEqual([expect.objectContaining({ at: 1_500, by: 'hook', state: 'resolved' })])
  })

  it('closes on a denial or any later event of the same agent, but not on another agent', () => {
    const sub = ev('tool.started', { ts: 1_200, agentId: 'a1', toolName: 'Read', toolUseId: 't9', payload: { tool_input: {} } })
    const r = new Run().feed(bash(1_000, 'tool.started', 'ls'), bash(1_100, 'permission.requested', 'ls', null), sub)
    expect(r.open).toHaveLength(1)
    r.feed(ev('permission.denied', { ts: 1_300, toolName: 'Bash', toolUseId: 't1' }))
    expect(r.open).toEqual([])
  })

  it('a permission_prompt notification enriches the approval instead of duplicating it', () => {
    const r = new Run().feed(
      bash(1_000, 'tool.started', 'ls'),
      bash(1_100, 'permission.requested', 'ls', null),
      ev('notification', { ts: 1_150, payload: { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' } })
    )
    expect(r.open).toHaveLength(1)
    expect(r.open[0]!.title).toBe('Run `ls`')
  })

  it('a poll that lags behind the hook does not close it; one that saw the wait and then stops does', () => {
    const r = new Run().feed(
      poll(900, { sessionId: 's1', status: 'busy' }),
      bash(1_000, 'tool.started', 'ls'),
      bash(1_100, 'permission.requested', 'ls', null),
      poll(1_200, { sessionId: 's1', status: 'busy' }) // still shows the moment before the prompt
    )
    expect(r.open).toHaveLength(1)
    r.feed(poll(2_000, { sessionId: 's1', status: 'waiting', waitingFor: 'permission prompt' }))
    expect(r.open[0]!.pollSaw).toBe(true)
    r.feed(poll(3_000, { sessionId: 's1', status: 'busy' })) // answered in the terminal
    expect(r.open).toEqual([])
    expect(r.closed.at(-1)).toMatchObject({ by: 'poll', at: 3_000 })
  })

  it('poll-only sessions get an item without details, which a hook item supersedes', () => {
    const r = new Run().feed(poll(1_000, { sessionId: 's1', status: 'waiting', waitingFor: 'permission prompt' }))
    expect(r.open).toEqual([expect.objectContaining({ priority: 1, kind: 'approval', title: 'Answer a permission prompt', hint: expect.stringContaining('No details') })])
    r.feed(bash(1_100, 'tool.started', 'ls'), bash(1_200, 'permission.requested', 'ls', null))
    expect(r.open).toEqual([expect.objectContaining({ title: 'Run `ls`' })])
    expect(r.closed).toEqual([expect.objectContaining({ by: 'superseded', state: 'superseded' })])
  })

  it('AskUserQuestion opens a question with the first question as its title', () => {
    const r = new Run().feed(ev('tool.started', {
      ts: 1_000, toolName: 'AskUserQuestion', toolUseId: 'q1',
      payload: { tool_input: { questions: [{ question: 'Which database?' }, { question: 'Port?' }] } }
    }))
    expect(r.open).toEqual([expect.objectContaining({ priority: 1, kind: 'question', title: 'Which database?' })])
    r.feed(ev('tool.finished', { ts: 2_000, toolName: 'AskUserQuestion', toolUseId: 'q1' }))
    expect(r.open).toEqual([])
  })

  it('one item per key: a repeated delivery does not open a second one', () => {
    const r = new Run().feed(bash(1_000, 'tool.started', 'ls'), bash(1_100, 'permission.requested', 'ls', null), bash(1_100, 'permission.requested', 'ls', 't1'))
    expect(r.open).toHaveLength(1)
  })
})

describe('P2 failed, P4 review', () => {
  it('StopFailure opens a failure with its fix hint; the next working poll closes it', () => {
    const r = new Run().feed(ev('turn.failed', { ts: 1_000, payload: { error: 'rate_limit' } }))
    expect(r.open).toEqual([expect.objectContaining({ priority: 2, kind: 'failed', title: 'Stopped: rate limit reached', hint: expect.stringContaining('/usage') })])
    r.feed(ev('session.prompt', { ts: 5_000 }))
    expect(r.open).toEqual([])
  })

  it('an unknown error code still says what happened', () => {
    const r = new Run().feed(ev('turn.failed', { ts: 1_000, payload: { error: 'weird_thing', error_details: 'boom' } }))
    expect(r.open[0]).toMatchObject({ title: 'Stopped: weird thing', hint: 'boom' })
  })

  it('Stop opens a review with the first line and the asked flag; the next prompt clears it', () => {
    const r = new Run().feed(ev('turn.stopped', { ts: 1_000, payload: { last_assistant_message: '## Summary\nAll green. Should I open the PR?' } }))
    expect(r.open).toEqual([expect.objectContaining({ priority: 4, kind: 'review', title: 'Summary', asked: true })])
    r.feed(ev('session.prompt', { ts: 2_000 }))
    expect(r.open).toEqual([])
  })

  it('a subagent Stop or a Stop-hook continuation is not a finished turn', () => {
    const r = new Run().feed(
      ev('turn.stopped', { ts: 1_000, agentId: 'a1', payload: { last_assistant_message: 'x' } }),
      ev('turn.stopped', { ts: 1_100, payload: { stop_hook_active: true, last_assistant_message: 'x' } })
    )
    expect(r.open).toEqual([])
  })

  it('a review survives the end of a -p run (reason other) but not a closed terminal', () => {
    const stop = ev('turn.stopped', { ts: 1_000, payload: { last_assistant_message: 'Done.' } })
    expect(new Run().feed(stop, ev('session.ended', { ts: 1_100, payload: { reason: 'other' } })).open).toHaveLength(1)
    expect(new Run().feed(stop, ev('session.ended', { ts: 1_100, payload: { reason: 'prompt_input_exit' } })).open).toEqual([])
  })
})

describe('P3 possibly stuck and Dismiss (test 9)', () => {
  const working = (): Run => new Run().feed(ev('session.prompt', { ts: 0 }), bash(1_000, 'tool.started', 'npm run build'))

  it('flags one tool running longer than M, and clears on the next event', () => {
    const r = working().tick(1_000 + DEFAULT_STALL.toolMs)
    expect(r.open).toEqual([])
    r.tick(1_001 + DEFAULT_STALL.toolMs)
    expect(r.open).toEqual([expect.objectContaining({ priority: 3, kind: 'stuck', title: expect.stringContaining('Possibly stuck') })])
    r.feed(bash(1_002 + DEFAULT_STALL.toolMs, 'tool.finished', 'npm run build'))
    expect(r.open).toEqual([])
  })

  it('flags N minutes with no events and nothing in flight', () => {
    const r = new Run().feed(ev('session.prompt', { ts: 0 })).tick(DEFAULT_STALL.idleMs + 1)
    expect(r.open).toEqual([expect.objectContaining({ kind: 'stuck', hint: 'No activity for over 5 min.' })])
  })

  it('never flags an idle or waiting session', () => {
    const r = new Run().feed(ev('turn.stopped', { ts: 0, payload: {} })).tick(DEFAULT_STALL.idleMs * 10)
    expect(r.open.filter((i) => i.kind === 'stuck')).toEqual([])
  })

  it('a dismissed P3 snoozes for 2N, then may open again', () => {
    const r = working().tick(1_001 + DEFAULT_STALL.toolMs)
    const at = 1_001 + DEFAULT_STALL.toolMs
    const d = dismiss(r.attention, r.open[0]!.id, at)
    expect(d.closed).toEqual([expect.objectContaining({ by: 'user-dismiss', state: 'dismissed' })])
    r.attention = d.state
    r.tick(at + 2 * DEFAULT_STALL.idleMs - 1)
    expect(r.open).toEqual([])
    r.tick(at + 2 * DEFAULT_STALL.idleMs)
    expect(r.open).toHaveLength(1)
  })

  it('a dismissed P4 stays quiet until the next prompt; P1 cannot be dismissed', () => {
    const stop = (ts: number): AgentEvent => ev('turn.stopped', { ts, payload: { last_assistant_message: 'Done.' } })
    const r = new Run().feed(stop(1_000))
    r.attention = dismiss(r.attention, r.open[0]!.id, 1_100).state
    r.feed(ev('notification', { ts: 1_200, payload: { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' } }))
    expect(r.open).toEqual([])
    r.feed(ev('session.prompt', { ts: 2_000 }), stop(3_000))
    expect(r.open).toHaveLength(1)

    const p1 = new Run().feed(bash(1_000, 'tool.started', 'ls'), bash(1_100, 'permission.requested', 'ls', null))
    expect(dismiss(p1.attention, p1.open[0]!.id, 1_200).state).toBe(p1.attention)
  })
})

describe('fast poll window (ARCHITECTURE § 3)', () => {
  it('runs for 2 min after the newest open P1 item, and not for P2–P4', () => {
    const r = new Run().feed(ev('turn.failed', { ts: 500, payload: { error: 'overloaded' } }))
    expect(fastPollUntil(r.attention)).toBe(0)
    r.feed(bash(1_000, 'tool.started', 'ls'), bash(1_100, 'permission.requested', 'ls', null))
    expect(fastPollUntil(r.attention)).toBe(1_100 + FAST_POLL_MS)
  })
})

describe('S1 replay: real 2.1.318 payloads (test 5)', () => {
  const r = new Run().feed(...s1Deliveries().map((d) => normalizeHook(d.raw, d.ts)!))
  const approvals = r.closed.filter((c) => c.item.kind === 'approval')

  it('opened an approval for each PermissionRequest, with its real command', () => {
    expect(approvals.length).toBeGreaterThan(0)
    for (const c of approvals) expect(c.item.title).toMatch(/^Run `.+`$/)
  })

  it('closed every approval once it was answered (allow, deny, or no answer)', () => {
    expect(r.open.filter((i) => i.priority === 1)).toEqual([])
    for (const c of approvals) expect(c.at).toBeGreaterThanOrEqual(c.item.openedAt)
  })
})
