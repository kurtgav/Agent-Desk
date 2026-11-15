import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NO_OPTIONS, type ConsoleBody, type ConsoleEvent, type ConsoleStart, type ConsoleStartResult, type ConsoleSummary } from '@shared/console'
import { demoSnapshot } from '@/demo/snapshot'
import { useUi } from '@/store'
import { NEW, connectConsole, orderedIds, requestNewConversation, resetConsole, selectView, setDraft, setText, startResume, submit, useConsole } from './store'

const ID = 'c_00000001'
let seq = 0
const ev = (body: ConsoleBody): ConsoleEvent => ({ id: `${ID}:${++seq}`, conversation: ID, seq, ts: 1_000 + seq, ...body }) as ConsoleEvent
const summary = (over: Partial<ConsoleSummary> = {}): ConsoleSummary => ({
  id: ID, title: 'Fix the login bug', cwd: 'D:\\proj', startedAt: 500, state: 'working', sessionId: null, turns: 0, costUsd: 0, model: null, permissionMode: 'default', options: NO_OPTIONS, fork: null, error: null, problem: null, ...over
})
const state = (s: ConsoleSummary['state']): ConsoleBody => ({ kind: 'state', state: s, sessionId: null, error: null, problem: null })

function bridge(over: Record<string, unknown> = {}) {
  let listener: (e: ConsoleEvent) => void = () => undefined
  const b = {
    onConsoleEvent: vi.fn((l: (e: ConsoleEvent) => void) => {
      listener = l
      return () => undefined
    }),
    consoleList: vi.fn(async (): Promise<ConsoleSummary[]> => []),
    consoleHistory: vi.fn(async (): Promise<ConsoleEvent[]> => []),
    consoleStart: vi.fn<(req: ConsoleStart) => Promise<ConsoleStartResult>>(async () => ({ ok: true, id: ID })),
    consoleSend: vi.fn(async () => ({ ok: true as const })),
    consoleStop: vi.fn(async () => ({ ok: true as const })),
    ...over
  }
  return { b, push: (e: ConsoleEvent) => listener(e) }
}

const live = (b: object): void => {
  vi.stubGlobal('window', { agentdeck: b })
  useUi.setState({ snapshot: { ...demoSnapshot(Date.now()), mode: 'live' } })
}
const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  seq = 0
  resetConsole()
  useUi.setState({ nav: { page: 'console' }, notice: null })
})
afterEach(() => vi.unstubAllGlobals())

describe('live conversations', () => {
  it('builds a conversation from its first event and fills in its details from the list', async () => {
    const { b, push } = bridge()
    b.consoleList.mockResolvedValue([summary()])
    live(b)
    connectConsole()
    push(ev({ kind: 'user', text: 'Fix the login bug' }))
    push(ev(state('working')))
    await settle()
    const v = useConsole.getState().convs[ID]!
    expect(v.thread.items.map((i) => i.kind)).toEqual(['user'])
    expect(v.loaded).toBe(true)
    expect(v.info.title).toBe('Fix the login bug')
    expect(b.consoleHistory).not.toHaveBeenCalled()
  })

  it('reads the history of a conversation it first hears of mid-way, and keeps what came meanwhile', async () => {
    const { b, push } = bridge()
    live(b)
    const history = [ev({ kind: 'user', text: 'old' }), ev({ kind: 'assistant-text', messageId: 'm:0', text: 'older answer', final: true })]
    let release: (v: ConsoleEvent[]) => void = () => undefined
    b.consoleHistory.mockImplementation(() => new Promise<ConsoleEvent[]>((r) => (release = r)))
    connectConsole()
    push(ev({ kind: 'assistant-text', messageId: 'm:1', text: 'a new answer', final: true })) // seq 3: not the first event
    expect(useConsole.getState().convs[ID]?.loaded).toBe(false)
    push(ev({ kind: 'turn-end', costUsd: 0.1, totalCostUsd: 0.1, inputTokens: 1, outputTokens: 1, durationMs: 10, interrupted: false, error: null })) // seq 4, buffered
    release(history)
    await settle()
    const v = useConsole.getState().convs[ID]!
    expect(v.loaded).toBe(true)
    expect(v.thread.items.map((i) => i.kind)).toEqual(['user', 'text', 'text', 'turn'])
    expect(v.buffer).toEqual([])
  })

  it('selects the newest conversation when the list loads, unless the user already chose a view', async () => {
    const { b } = bridge()
    b.consoleList.mockResolvedValue([summary({ id: 'c_00000002', title: 'Newer', startedAt: 900 }), summary()])
    live(b)
    connectConsole()
    await settle()
    expect(useConsole.getState().selected).toBe('c_00000002')
    expect(orderedIds(useConsole.getState().convs)).toEqual(['c_00000002', ID])
    resetConsole()
    connectConsole()
    selectView(null)
    await settle()
    expect(useConsole.getState().selected).toBeNull()
  })

  it('marks a finished conversation you are not looking at, and clears it when you open it', async () => {
    const { b, push } = bridge()
    live(b)
    connectConsole()
    push(ev({ kind: 'user', text: 'go' }))
    push(ev({ kind: 'turn-end', costUsd: 0.1, totalCostUsd: 0.1, inputTokens: 1, outputTokens: 1, durationMs: 10, interrupted: false, error: null }))
    expect(useConsole.getState().convs[ID]?.unread).toBe(true)
    selectView(ID)
    expect(useConsole.getState().convs[ID]?.unread).toBe(false)
    push(ev({ kind: 'turn-end', costUsd: 0.1, totalCostUsd: 0.2, inputTokens: 1, outputTokens: 1, durationMs: 10, interrupted: false, error: null }))
    expect(useConsole.getState().convs[ID]?.unread).toBe(false)
  })

  it('starts a conversation with the draft, selects it and clears the box', async () => {
    const { b, push } = bridge()
    live(b)
    connectConsole()
    setDraft({ cwd: 'D:\\proj', model: 'opus', effort: 'low', permissionMode: 'plan' })
    setText(NEW, '  Tidy the imports  ')
    b.consoleStart.mockImplementation(async () => {
      push(ev({ kind: 'user', text: 'Tidy the imports' })) // main pushes before it answers
      return { ok: true, id: ID }
    })
    await submit()
    expect(b.consoleStart).toHaveBeenCalledWith({ cwd: 'D:\\proj', prompt: 'Tidy the imports', model: 'opus', effort: 'low', permissionMode: 'plan', resume: null, options: NO_OPTIONS })
    const s = useConsole.getState()
    expect(s.selected).toBe(ID)
    expect(s.texts[NEW]).toBe('')
    expect(s.convs[ID]?.info).toMatchObject({ title: 'Tidy the imports', cwd: 'D:\\proj', model: 'opus', permissionMode: 'plan' })
    expect(s.convs[ID]?.thread.items).toHaveLength(1)
  })

  it('resumes a session: the draft carries its id, and the next message continues it', async () => {
    const { b } = bridge()
    live(b)
    connectConsole()
    startResume({ sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', name: 'stripe-webhooks', cwd: 'D:\\thirdcode\\billing-api' })
    expect(useUi.getState().nav).toEqual({ page: 'console' })
    setText(NEW, 'Carry on')
    await submit()
    expect(b.consoleStart).toHaveBeenCalledWith(expect.objectContaining({ cwd: 'D:\\thirdcode\\billing-api', resume: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', options: NO_OPTIONS }))
    expect(useConsole.getState().draft.resume).toBeNull()
  })

  it('forks a session: the draft asks for a copy, the start says so, and the new conversation is titled and marked', async () => {
    const { b } = bridge()
    live(b)
    connectConsole()
    startResume({ sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', name: 'stripe-webhooks', cwd: 'D:\thirdcode\billing-api', fork: true })
    expect(useConsole.getState().draft.resume).toEqual({ sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', name: 'stripe-webhooks', fork: true })
    setText(NEW, 'Try the other way')
    await submit()
    expect(b.consoleStart).toHaveBeenCalledWith(expect.objectContaining({ resume: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', fork: true, forkOf: 'stripe-webhooks' }))
    expect(useConsole.getState().convs[ID]?.info).toMatchObject({ title: 'Fork of stripe-webhooks', fork: { sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', name: 'stripe-webhooks' } })
    expect(useConsole.getState().draft.resume).toBeNull()
  })

  it('a plain resume sends no fork fields', async () => {
    const { b } = bridge()
    live(b)
    connectConsole()
    startResume({ sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', name: 'stripe-webhooks', cwd: 'D:\thirdcode\billing-api' })
    setText(NEW, 'Carry on')
    await submit()
    const sent = b.consoleStart.mock.calls[0]![0]
    expect('fork' in sent || 'forkOf' in sent).toBe(false)
    expect(useConsole.getState().convs[ID]?.info.fork).toBeNull()
  })

  it('keeps the text and says why when a conversation will not start', async () => {
    const { b } = bridge()
    b.consoleStart.mockResolvedValue({ ok: false, error: 'Claude Code does not trust this folder yet.', untrusted: true })
    live(b)
    connectConsole()
    setDraft({ cwd: 'D:\\proj' })
    setText(NEW, 'hello')
    await submit()
    const s = useConsole.getState()
    expect(s.texts[NEW]).toBe('hello')
    expect(s.selected).toBeNull()
    expect(s.startProblem).toEqual({ message: 'Claude Code does not trust this folder yet.', untrusted: true, cwd: 'D:\\proj' })
    setDraft({ model: 'sonnet' }) // changing a setting clears the message
    expect(useConsole.getState().startProblem).toBeNull()
  })

  it('sends a follow-up to the open conversation and keeps the text if it was refused', async () => {
    const { b, push } = bridge()
    live(b)
    connectConsole()
    push(ev({ kind: 'user', text: 'first' }))
    selectView(ID)
    setText(ID, 'second')
    await submit()
    expect(b.consoleSend).toHaveBeenCalledWith(ID, 'second')
    expect(useConsole.getState().texts[ID]).toBe('')
    b.consoleSend.mockResolvedValueOnce({ ok: false, error: 'This conversation has ended.' } as never)
    setText(ID, 'third')
    await submit()
    expect(useConsole.getState().texts[ID]).toBe('third')
    expect(useUi.getState().notice).toMatchObject({ text: 'This conversation has ended.', tone: 'error' })
  })

  it('does nothing for an empty box', async () => {
    const { b } = bridge()
    live(b)
    connectConsole()
    setText(NEW, '   ')
    await submit()
    expect(b.consoleStart).not.toHaveBeenCalled()
  })

  it('opens the new-conversation view from anywhere', () => {
    const { b } = bridge()
    live(b)
    useUi.setState({ nav: { page: 'home' } })
    selectView(ID)
    requestNewConversation()
    expect(useUi.getState().nav).toEqual({ page: 'console' })
    expect(useConsole.getState().selected).toBeNull()
  })
})

describe('demo mode', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {})
    useUi.setState({ snapshot: demoSnapshot(Date.now()) })
  })

  it('shows two conversations, the refactor first and open', () => {
    connectConsole()
    const s = useConsole.getState()
    expect(orderedIds(s.convs)).toEqual(['demo-refactor', 'demo-mail', 'demo-review'])
    expect(s.selected).toBe('demo-refactor')
    expect(s.convs['demo-refactor']?.thread.items.some((i) => i.kind === 'tool')).toBe(true)
  })

  it('opens on the new-conversation view when Fork was chosen before the page connected', () => {
    startResume({ sessionId: 's-auth', name: 'auth-tests', cwd: 'D:\thirdcode\thirdcode-web', fork: true })
    connectConsole()
    const s = useConsole.getState()
    expect(s.selected).toBeNull()
    expect(s.draft.resume).toMatchObject({ name: 'auth-tests', fork: true })
    expect(orderedIds(s.convs)).toHaveLength(3)
  })

  it('answers a fork with the scripted reply too, titled as a copy', async () => {
    connectConsole()
    startResume({ sessionId: 's-auth', name: 'auth-tests', cwd: 'D:\thirdcode\thirdcode-web', fork: true })
    setText(NEW, 'Try the other approach')
    await submit()
    const s = useConsole.getState()
    expect(s.convs[s.selected!]?.info).toMatchObject({ title: 'Fork of auth-tests', fork: { sessionId: 's-auth', name: 'auth-tests' } })
    expect(s.convs[s.selected!]?.thread.items.map((i) => i.kind)).toEqual(['user', 'text', 'turn'])
  })

  it('answers a new conversation and a follow-up with the scripted reply, calling nothing', async () => {
    connectConsole()
    selectView(null)
    setText(NEW, 'Add a changelog entry')
    await submit()
    const s1 = useConsole.getState()
    const id = s1.selected!
    expect(id).toMatch(/^demo-new-/)
    expect(s1.convs[id]?.thread.items.map((i) => i.kind)).toEqual(['user', 'text', 'turn'])
    setText(id, 'And a second line')
    await submit()
    const thread = useConsole.getState().convs[id]!.thread
    expect(thread.items.map((i) => i.kind)).toEqual(['user', 'text', 'turn', 'user', 'text', 'turn'])
    expect(thread.state).toBe('idle')
    expect(thread.turns).toBe(2)
  })
})
