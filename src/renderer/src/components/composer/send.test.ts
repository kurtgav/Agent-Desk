import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NO_OPTIONS, type ConsoleStart, type ConsoleStartResult } from '@shared/console'
import { TaskInput } from '@shared/work'
import { demoSnapshot } from '@/demo/snapshot'
import { useUi } from '@/store'
import { NEW, resetConsole, setDraft, setText, submit, useConsole } from '../console/store'
import { useDrafts } from './drafts'
import { parseMentions } from './mentions'
import { planBackground, planSend } from './plan'
import type { RoleLookup } from './types'

/** What each variant sends, through the Console's own store and a fake bridge: the calls main would receive. */

const ID = 'c_00000001'
const roles: RoleLookup = { name: (id) => ({ cto: 'CTO', qa: 'QA', 'seo-specialist': 'SEO Specialist' })[id] ?? id, agent: (id) => (id === 'cto' ? 'CTO' : null) }
const known = (id: string): boolean => ['cto', 'qa', 'seo-specialist'].includes(id)
const planned = (variant: 'new-session' | 'reply' | 'task', text: string) => planSend(variant, text, parseMentions(text, known), roles)

function bridge(over: Record<string, unknown> = {}) {
  return {
    onConsoleEvent: vi.fn(() => () => undefined),
    consoleList: vi.fn(async () => []),
    consoleHistory: vi.fn(async () => []),
    consoleStart: vi.fn<(req: ConsoleStart) => Promise<ConsoleStartResult>>(async () => ({ ok: true, id: ID })),
    consoleSend: vi.fn<(id: string, text: string, mentions?: string[]) => Promise<{ ok: true }>>(async () => ({ ok: true })),
    consoleStop: vi.fn(async () => ({ ok: true as const })),
    dispatch: vi.fn(async () => ({ ok: true as const, name: 'plan-0001', bgId: 'x' })),
    ...over
  }
}
const live = (b: object): void => {
  vi.stubGlobal('window', { agentdeck: b })
  useUi.setState({ snapshot: { ...demoSnapshot(Date.now()), mode: 'live' } })
}

beforeEach(() => {
  resetConsole()
  useDrafts.setState({ task: '' })
  useUi.setState({ notice: null })
})
afterEach(() => vi.unstubAllGlobals())

describe('a new session', () => {
  it('starts with the first mention as its role and the rest as helpers, the text with names', async () => {
    const b = bridge()
    live(b)
    setDraft({ cwd: 'D:\\proj' })
    const plan = planned('new-session', '@cto @qa plan the launch')
    if (!plan.ok || plan.kind !== 'new-session') throw new Error('not a session plan')
    const r = await submit({ conversation: null, text: plan.prompt, role: plan.role, helpers: plan.helpers })
    expect(r).toEqual({ ok: true, id: ID })
    const req = b.consoleStart.mock.calls[0]![0]
    expect(req).toMatchObject({ cwd: 'D:\\proj', prompt: '@CTO @QA plan the launch', role: 'cto', helpers: ['qa'], options: NO_OPTIONS })
  })

  it('sends no role and no helpers when nobody is mentioned, so main sees the same request as before', async () => {
    const b = bridge()
    live(b)
    setDraft({ cwd: 'D:\\proj' })
    await submit({ conversation: null, text: 'fix the bug', role: null, helpers: [] })
    const req = b.consoleStart.mock.calls[0]![0]
    expect(req).not.toHaveProperty('role')
    expect(req).not.toHaveProperty('helpers')
  })

  it('starts a new conversation even when another one is open', async () => {
    const b = bridge()
    live(b)
    setDraft({ cwd: 'D:\\proj' })
    useConsole.setState({ selected: 'c_00000009' })
    await submit({ conversation: null, text: 'hello' })
    expect(b.consoleStart).toHaveBeenCalledTimes(1)
    expect(b.consoleSend).not.toHaveBeenCalled()
  })

  it('clears its draft when it starts, and keeps it with the reason when it does not', async () => {
    live(bridge())
    setDraft({ cwd: 'D:\\proj' })
    setText(NEW, '@cto go')
    expect((await submit({ conversation: null, text: 'go' })).ok).toBe(true)
    expect(useConsole.getState().texts[NEW]).toBe('')

    live(bridge({ consoleStart: vi.fn(async () => ({ ok: false as const, error: 'Workspace not trusted', untrusted: true })) }))
    setText(NEW, 'again')
    const failed = await submit({ conversation: null, text: 'again' })
    expect(failed).toEqual({ ok: false, error: 'Workspace not trusted' })
    expect(useConsole.getState().texts[NEW]).toBe('again')
    expect(useConsole.getState().startProblem).toEqual({ message: 'Workspace not trusted', untrusted: true, cwd: 'D:\\proj' })
  })

  it('says why when there is nothing to send, no project, or a start in progress, and calls nothing', async () => {
    const b = bridge()
    live(b)
    expect(await submit({ conversation: null, text: '   ' })).toEqual({ ok: false, error: 'Type a message first.' })
    useUi.setState({ snapshot: { ...demoSnapshot(Date.now()), mode: 'live', sessions: [] } })
    expect(await submit({ conversation: null, text: 'hello' })).toEqual({ ok: false, error: 'Pick a project first.' })
    useConsole.setState({ starting: true })
    expect(await submit({ conversation: null, text: 'hello' })).toEqual({ ok: false, error: 'Still starting the conversation.' })
    expect(b.consoleStart).not.toHaveBeenCalled()
  })
})

describe('a reply', () => {
  it('addresses the mentioned agents for this one message and leaves the session role alone', async () => {
    const b = bridge()
    live(b)
    const plan = planned('reply', '@qa review this')
    if (!plan.ok || plan.kind !== 'reply') throw new Error('not a reply plan')
    const r = await submit({ conversation: ID, text: plan.text, mentions: plan.mentions })
    expect(r).toEqual({ ok: true, id: ID })
    expect(b.consoleSend).toHaveBeenCalledWith(ID, '@QA review this', ['qa'])
    expect(b.consoleStart).not.toHaveBeenCalled()
  })

  it('sends a plain reply with no mentions argument at all', async () => {
    const b = bridge()
    live(b)
    await submit({ conversation: ID, text: 'thanks' })
    expect(b.consoleSend).toHaveBeenCalledWith(ID, 'thanks')
  })

  it('keeps each conversation its own draft, and clears only the one that was sent', async () => {
    live(bridge())
    setText(ID, 'first')
    setText('c_00000002', 'second')
    setText(NEW, 'new one')
    await submit({ conversation: ID, text: 'first' })
    const { texts } = useConsole.getState()
    expect(texts[ID]).toBe('')
    expect(texts['c_00000002']).toBe('second')
    expect(texts[NEW]).toBe('new one')
  })

  it('keeps the text and tells the user when the send is refused', async () => {
    live(bridge({ consoleSend: vi.fn(async () => ({ ok: false as const, error: 'The conversation has ended.' })) }))
    setText(ID, 'hello?')
    const r = await submit({ conversation: ID, text: 'hello?' })
    expect(r).toEqual({ ok: false, error: 'The conversation has ended.' })
    expect(useConsole.getState().texts[ID]).toBe('hello?')
    expect(useUi.getState().notice).toMatchObject({ text: 'The conversation has ended.', tone: 'error' })
  })
})

describe('a task', () => {
  it('keeps its agent apart from its title, and the pair is a valid task input', () => {
    const plan = planned('task', '@seo-specialist audit the pricing page')
    if (!plan.ok || plan.kind !== 'task') throw new Error('not a task plan')
    const input = { title: plan.title, project: 'D:\\proj', role: plan.role }
    expect(TaskInput.safeParse(input).success).toBe(true)
    expect(input).toEqual({ title: 'audit the pricing page', project: 'D:\\proj', role: 'seo-specialist' })
  })

  it('has a draft of its own that the sessions do not touch', () => {
    setText(NEW, 'a session draft')
    useDrafts.getState().setTask('a task draft')
    expect(useConsole.getState().texts[NEW]).toBe('a session draft')
    expect(useDrafts.getState().task).toBe('a task draft')
  })
})

describe('Run in the background', () => {
  it('goes to claude --bg with the lead as --agent and the model and effort chosen', async () => {
    const b = bridge()
    live(b)
    const text = '@cto plan the launch'
    const bg = planBackground(text, parseMentions(text, known), roles)
    if (!bg.ok) throw new Error(bg.reason)
    const { dispatchTask } = await import('@/lib/act')
    setDraft({ model: 'sonnet', effort: 'high' })
    const { draft } = useConsole.getState()
    await dispatchTask({ prompt: bg.prompt, cwd: 'D:\\proj', agent: bg.agent, effort: draft.effort, model: draft.model })
    expect(b.dispatch).toHaveBeenCalledWith({ prompt: 'plan the launch', cwd: 'D:\\proj', agent: 'CTO', effort: 'high', model: 'sonnet' })
  })
})
