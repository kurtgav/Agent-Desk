import { describe, expect, it } from 'vitest'
import type { ConsoleBody, ConsoleEvent } from '@shared/console'
import { demoConversations, demoReply } from './demo'
import { isNearBottom, stickAfterScroll } from './scroll'
import { applyEvent, applyHistory, applyLive, emptyThread, isStreaming, isWorking, type Thread } from './thread'

let n = 0
const ev = (body: ConsoleBody, over: Partial<ConsoleEvent> = {}): ConsoleEvent => {
  n++
  return { id: `c_1:${n}`, conversation: 'c_00000001', seq: n, ts: 1_000 + n, ...body, ...over } as ConsoleEvent
}
const reset = (): void => {
  n = 0
}
const run = (...bodies: ConsoleBody[]): Thread => bodies.map((b) => ev(b)).reduce(applyLive, emptyThread)
const turnEnd: ConsoleBody = { kind: 'turn-end', costUsd: 0.1, totalCostUsd: 0.1, inputTokens: 10, outputTokens: 5, durationMs: 1500, interrupted: false, error: null }

describe('the thread reducer', () => {
  it('builds a turn: you, Claude’s words as they grow, a tool, more words, the footer', () => {
    reset()
    const t = run(
      { kind: 'state', state: 'working', sessionId: null, error: null, problem: null },
      { kind: 'user', text: 'Fix it' },
      { kind: 'assistant-text', messageId: 'm:0', text: 'I will', final: false },
      { kind: 'assistant-text', messageId: 'm:0', text: 'I will look.', final: true },
      { kind: 'tool-use', toolUseId: 't1', name: 'Read', summary: 'Read a.ts', input: '{}' },
      { kind: 'tool-result', toolUseId: 't1', ok: true, text: 'contents', truncated: false },
      { kind: 'assistant-text', messageId: 'm2:0', text: 'Done.', final: true },
      turnEnd,
      { kind: 'state', state: 'idle', sessionId: 'sess-1', error: null, problem: null }
    )
    expect(t.items.map((i) => i.kind)).toEqual(['user', 'text', 'tool', 'text', 'turn'])
    expect(t.items[1]).toMatchObject({ text: 'I will look.', final: true })
    expect(t.items[2]).toMatchObject({ status: 'ok', result: 'contents' })
    expect(t).toMatchObject({ state: 'idle', sessionId: 'sess-1', turns: 1, totalCostUsd: 0.1, turnStartedAt: null })
  })

  it('grows a message in place and keeps its place in the thread', () => {
    reset()
    const t = run(
      { kind: 'assistant-text', messageId: 'm:0', text: 'A', final: false },
      { kind: 'tool-use', toolUseId: 't1', name: 'Bash', summary: 'Run: ls', input: '' },
      { kind: 'assistant-text', messageId: 'm:0', text: 'AB', final: false }
    )
    expect(t.items.map((i) => i.kind)).toEqual(['text', 'tool'])
    expect(t.items[0]).toMatchObject({ text: 'AB', key: 'text:m:0' })
  })

  it('marks a tool failed, or not allowed, and does not let a later result undo that', () => {
    reset()
    const failed = run({ kind: 'tool-use', toolUseId: 't1', name: 'Bash', summary: 'Run: x', input: '' }, { kind: 'tool-result', toolUseId: 't1', ok: false, text: 'boom', truncated: false })
    expect(failed.items[0]).toMatchObject({ status: 'failed', result: 'boom' })
    reset()
    const denied = run(
      { kind: 'tool-use', toolUseId: 't1', name: 'Bash', summary: 'Run: x', input: '' },
      { kind: 'permission-denied', toolUseId: 't1', name: 'Bash', summary: 'Run: x', rule: 'Bash(x)' },
      { kind: 'tool-result', toolUseId: 't1', ok: false, text: 'needs permission', truncated: false }
    )
    expect(denied.items[0]).toMatchObject({ status: 'denied', result: 'needs permission' })
  })

  it('shows a denial even when the call itself is not on screen', () => {
    reset()
    expect(run({ kind: 'permission-denied', toolUseId: 'x', name: 'Edit', summary: 'Edit a.ts', rule: 'Edit' }).items[0]).toMatchObject({ kind: 'tool', status: 'denied', name: 'Edit' })
  })

  it('ignores a result whose call was trimmed away, and a call seen twice', () => {
    reset()
    const t = run(
      { kind: 'tool-result', toolUseId: 'gone', ok: true, text: 'x', truncated: false },
      { kind: 'tool-use', toolUseId: 't1', name: 'Read', summary: 'Read', input: '' },
      { kind: 'tool-use', toolUseId: 't1', name: 'Read', summary: 'Read', input: '' }
    )
    expect(t.items).toHaveLength(1)
  })

  it('settles whatever was still going when a turn ends (an interrupted turn stops its running tool)', () => {
    reset()
    const t = run(
      { kind: 'assistant-text', messageId: 'm:0', text: 'Half a sen', final: false },
      { kind: 'thinking', messageId: 'm:1', text: 'hm', final: false },
      { kind: 'tool-use', toolUseId: 't1', name: 'Bash', summary: 'Run: sleep', input: '' },
      { ...turnEnd, interrupted: true, error: 'Claude Code hit an error' }
    )
    expect(t.items.slice(0, 3)).toMatchObject([{ final: true }, { final: true }, { status: 'stopped' }])
    expect(t.items[3]).toMatchObject({ kind: 'turn', interrupted: true, error: null })
  })

  it('keeps an error on a turn that was not interrupted', () => {
    reset()
    expect(run({ ...turnEnd, error: 'Claude reached its limit of steps for one request.' }).items[0]).toMatchObject({ kind: 'turn', error: expect.stringContaining('limit') })
  })

  it('keeps the session id once it is known, and the reason a conversation failed', () => {
    reset()
    const t = run(
      { kind: 'state', state: 'idle', sessionId: 'abc', error: null, problem: null },
      { kind: 'state', state: 'failed', sessionId: null, error: 'Claude Code stopped unexpectedly.', problem: 'signed-out' }
    )
    expect(t).toMatchObject({ state: 'failed', sessionId: 'abc', error: 'Claude Code stopped unexpectedly.', problem: 'signed-out' })
  })

  it('knows when to show the typing indicator', () => {
    reset()
    const working = run({ kind: 'state', state: 'working', sessionId: null, error: null, problem: null }, { kind: 'user', text: 'go' })
    expect(isWorking(working)).toBe(true)
    expect(isStreaming(working)).toBe(false)
    const writing = applyLive(working, ev({ kind: 'assistant-text', messageId: 'm:0', text: 'He', final: false }))
    expect(isStreaming(writing)).toBe(true)
    expect(isStreaming({ ...writing, state: 'idle' })).toBe(false)
  })
})

describe('live events and history', () => {
  it('ignores a live event that was already seen (it came with the history)', () => {
    reset()
    const a = ev({ kind: 'user', text: 'one' })
    const b = ev({ kind: 'user', text: 'two' })
    const t = applyLive(applyLive(applyLive(emptyThread, a), b), a)
    expect(t.items).toHaveLength(2)
    expect(applyLive(t, b)).toBe(t)
  })

  it('applies history whose event numbers are not in order (a message that grew keeps its place)', () => {
    reset()
    const history = [
      ev({ kind: 'assistant-text', messageId: 'm:0', text: 'Hello', final: true }, { seq: 9 }),
      ev({ kind: 'user', text: 'later' }, { seq: 4 })
    ]
    const t = applyHistory(history)
    expect(t.items.map((i) => i.kind)).toEqual(['text', 'user'])
    expect(t.lastSeq).toBe(9)
    expect(applyLive(t, ev({ kind: 'user', text: 'new' }, { seq: 10 })).items).toHaveLength(3)
  })

  it('applyEvent is pure: the thread it was given is untouched', () => {
    reset()
    const before = run({ kind: 'user', text: 'x' })
    const frozen = JSON.stringify(before)
    applyEvent(before, ev({ kind: 'assistant-text', messageId: 'm:0', text: 'y', final: true }))
    expect(JSON.stringify(before)).toBe(frozen)
  })
})

describe('the demo conversations (what the smoke tests and screenshots show)', () => {
  const NOW = Date.UTC(2026, 10, 5, 14, 0)

  it('replay into believable threads: tools, a failed test then a fix, footers, a finished review', () => {
    const threads = Object.fromEntries(demoConversations(NOW).map((c) => [c.info.id, applyHistory(c.events)]))
    const refactor = threads['demo-refactor']
    const review = threads['demo-review']
    const tools = refactor!.items.filter((i) => i.kind === 'tool')
    expect(tools.map((t) => (t.kind === 'tool' ? [t.name, t.status] : null))).toEqual([['Read', 'ok'], ['Edit', 'ok'], ['Bash', 'failed'], ['Edit', 'ok'], ['Bash', 'ok']])
    expect(refactor!.items.filter((i) => i.kind === 'turn')).toHaveLength(2)
    expect(refactor).toMatchObject({ state: 'idle', turns: 2 })
    expect(refactor!.totalCostUsd).toBeCloseTo(0.36)
    expect(review).toMatchObject({ state: 'ended', turns: 1 })
  })

  it('answers a message in demo with a scripted reply that says nothing ran', () => {
    const t = applyHistory(demoReply('demo-x', 1, NOW, 'Please rename the thing'))
    expect(t.items[0]).toMatchObject({ kind: 'text', text: expect.stringContaining('demo data') })
    expect(t.items[0]).toMatchObject({ text: expect.stringContaining('Please rename the thing') })
    expect(t.state).toBe('idle')
  })
})

describe('following new content', () => {
  const at = (scrollTop: number) => ({ scrollTop, clientHeight: 400, scrollHeight: 1_000 })

  it('is at the end within a few lines of it', () => {
    expect(isNearBottom(at(600))).toBe(true)
    expect(isNearBottom(at(560))).toBe(true)
    expect(isNearBottom(at(551))).toBe(false)
    expect(isNearBottom(at(0))).toBe(false)
  })

  it('lets go when you scroll up, holds on when you come back, and a short thread is always at its end', () => {
    expect(stickAfterScroll(at(300))).toBe(false)
    expect(stickAfterScroll(at(600))).toBe(true)
    expect(stickAfterScroll({ scrollTop: 0, clientHeight: 400, scrollHeight: 300 })).toBe(true)
  })
})
