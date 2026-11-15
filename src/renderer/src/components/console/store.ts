import { create } from 'zustand'
import type { Effort } from '@shared/bridge'
import { FORK_NAME_MAX, IMAGES_MAX, NO_OPTIONS, type ConsoleImage, type ConsoleEvent, type ConsoleOptions, type ConsoleStartResult, type ConsoleSummary, type PermissionMode } from '@shared/console'
import { NEW_SESSION, useUi } from '@/store'
import { recentProjects } from '@/lib/selectors'
import { rememberCapabilities, useCaps } from './caps-store'
import { demoCapabilities, demoConversations, demoReply } from './demo'
import { readModel, saveModel } from './modelChoice'
import { applyHistory, applyLive, emptyThread, isWorking, type Thread } from './thread'

/**
 * The conversations AgentDeck started (the Console, now the sessions started here): every conversation as main reports it (events,
 * in order), the one on screen, and the draft of a new one. It lives for the whole window, so a conversation keeps streaming while
 * you look at another page, and the page you come back to is current. What is on screen follows the window's nav (the frame syncs
 * `selected` from it); the actions below that start or pick a conversation also move the nav. Live conversations come from main's events (shared/console.ts); demo ones from ./demo.
 */

export type ConvInfo = Pick<ConsoleSummary, 'id' | 'title' | 'cwd' | 'startedAt' | 'model' | 'permissionMode' | 'options' | 'fork'>

export interface ConvView {
  info: ConvInfo
  thread: Thread
  /** The thread holds everything said so far (it was seen from its first event, or its history was read). */
  loaded: boolean
  /** Live events that arrived while the history was being read. */
  buffer: ConsoleEvent[]
  unread: boolean
}

export interface NewDraft {
  /** null = the most recent project. */
  cwd: string | null
  /** null = Claude Code's default. */
  model: string | null
  effort: Effort
  permissionMode: PermissionMode
  /** `fork`: the next message starts a copy of the session under a new id (Fork in the session menu). */
  resume: { sessionId: string; name: string; fork?: boolean } | null
  /** The Advanced section; every part is off by default. */
  options: ConsoleOptions
}

export interface StartProblem {
  message: string
  untrusted: boolean
  cwd: string
}

/** The composer text of the new-conversation view lives under this key; a conversation's under its id. */
export const NEW = 'new'

interface ConsoleState {
  convs: Record<string, ConvView>
  /** The conversation the composer talks to; null = the new session screen. */
  selected: string | null
  draft: NewDraft
  texts: Record<string, string>
  /** Pictures pasted into the composer, per draft (same keys as `texts`). Memory only. */
  images: Record<string, ConsoleImage[]>
  /** Bumped to put the cursor in the composer. */
  focusTick: number
  startProblem: StartProblem | null
  starting: boolean
}

export const useConsole = create<ConsoleState>(() => ({
  convs: {},
  selected: null,
  draft: { cwd: null, model: readModel(), effort: 'high', permissionMode: 'default', resume: null, options: NO_OPTIONS },
  texts: {},
  images: {},
  focusTick: 0,
  startProblem: null,
  starting: false
}))

const set = useConsole.setState
const get = useConsole.getState

const isDemo = (): boolean => useUi.getState().snapshot.mode === 'demo' || !window.agentdeck
const pick = (s: ConsoleSummary): ConvInfo => ({ id: s.id, title: s.title, cwd: s.cwd, startedAt: s.startedAt, model: s.model, permissionMode: s.permissionMode, options: s.options, fork: s.fork })

function updateView(id: string, fn: (v: ConvView) => ConvView): void {
  set((s) => {
    const v = s.convs[id]
    return v ? { convs: { ...s.convs, [id]: fn(v) } } : {}
  })
}

function addView(id: string, view: ConvView): void {
  set((s) => ({ convs: { ...s.convs, [id]: view } }))
}

/** Newest first, the order of the rail. */
export const orderedIds = (convs: Record<string, ConvView>): string[] => Object.keys(convs).sort((a, b) => convs[b]!.info.startedAt - convs[a]!.info.startedAt)

// ── live ──

let connected = false

/** Once per window: listen to main, then read what exists. Never unsubscribed: events keep arriving while another page is open. */
export function connectConsole(): void {
  if (connected) return
  connected = true
  const bridge = window.agentdeck
  if (isDemo() || !bridge) return seedDemo()
  bridge.onConsoleEvent(onEvent)
  void refreshList()
}

function onEvent(e: ConsoleEvent): void {
  const s = get()
  const v = s.convs[e.conversation]
  if (!v) {
    // Seen from its first event, nothing is missing; otherwise read what came before.
    const whole = e.seq === 1
    addView(e.conversation, {
      info: { id: e.conversation, title: 'Conversation', cwd: '', startedAt: e.ts, model: null, permissionMode: 'default', options: NO_OPTIONS, fork: null },
      thread: whole ? applyLive(emptyThread, e) : emptyThread,
      loaded: whole,
      buffer: whole ? [] : [e],
      unread: false
    })
    if (!whole) void loadHistory(e.conversation)
    void refreshList()
    return
  }
  if (!v.loaded) return updateView(e.conversation, (x) => ({ ...x, buffer: [...x.buffer, e] }))
  const thread = applyLive(v.thread, e)
  if (thread === v.thread) return
  if (e.kind === 'capabilities') rememberCapabilities(e.capabilities)
  const finished = e.kind === 'turn-end' || (e.kind === 'state' && (e.state === 'failed' || e.state === 'ended'))
  // Unread unless it is open in front of you: its session is the one on screen.
  const watching = isOnScreen(e.conversation)
  updateView(e.conversation, (x) => ({ ...x, thread, unread: x.unread || (finished && !watching) }))
}

/** The window shows this conversation's session now (nav.session is the conversation's key, or the Claude Code session id it later got). */
function isOnScreen(id: string): boolean {
  const { nav } = useUi.getState()
  if (nav.page !== 'session' || !nav.session) return false
  return nav.session === id || nav.session === get().convs[id]?.thread.sessionId
}

async function loadHistory(id: string): Promise<void> {
  const seed = get().convs[id]?.thread ?? emptyThread
  const history = await window.agentdeck?.consoleHistory(id).catch(() => [] as ConsoleEvent[])
  updateView(id, (v) => {
    const fresh = applyHistory(history ?? [], { ...emptyThread, state: seed.state, sessionId: seed.sessionId, error: seed.error, problem: seed.problem })
    // A trimmed history lost its early turns; the list still knows how many there were.
    let thread: Thread = { ...fresh, turns: Math.max(fresh.turns, seed.turns), totalCostUsd: Math.max(fresh.totalCostUsd, seed.totalCostUsd) }
    for (const e of v.buffer) thread = applyLive(thread, e)
    // A conversation from before this window opened still tells the menus what Claude can use.
    if (thread.capabilities && useCaps.getState().last === null) rememberCapabilities(thread.capabilities)
    return { ...v, thread, buffer: [], loaded: true }
  })
}

async function refreshList(): Promise<void> {
  const list = await window.agentdeck?.consoleList().catch(() => null)
  if (!list) return
  for (const sum of list) {
    const v = get().convs[sum.id]
    if (v) {
      updateView(sum.id, (x) => ({ ...x, info: pick(sum), thread: { ...x.thread, turns: Math.max(x.thread.turns, sum.turns), totalCostUsd: Math.max(x.thread.totalCostUsd, sum.costUsd) } }))
      continue
    }
    const thread: Thread = { ...emptyThread, state: sum.state, sessionId: sum.sessionId, error: sum.error, problem: sum.problem, turns: sum.turns, totalCostUsd: sum.costUsd }
    addView(sum.id, { info: pick(sum), thread, loaded: false, buffer: [], unread: false })
    void loadHistory(sum.id)
  }
}

// ── actions ──

export function setText(key: string, text: string): void {
  set((s) => ({ texts: { ...s.texts, [key]: text } }))
}

export function selectView(id: string | null): void {
  set((s) => {
    const v = id === null ? undefined : s.convs[id]
    return { selected: id, focusTick: s.focusTick + 1, convs: v ? { ...s.convs, [v.info.id]: { ...v, unread: false } } : s.convs }
  })
}

export function focusComposer(): void {
  set((s) => ({ focusTick: s.focusTick + 1 }))
}

/** The Console page is on screen with this conversation open: whatever happened in it has been seen. */
export function markSeen(id: string | null): void {
  if (id === null) return
  updateView(id, (v) => (v.unread ? { ...v, unread: false } : v))
}

export function setDraft(patch: Partial<NewDraft>): void {
  if ('model' in patch) saveModel(patch.model ?? null)
  set((s) => ({ draft: { ...s.draft, ...patch }, startProblem: null }))
}

export function setOptions(patch: Partial<ConsoleOptions>): void {
  set((s) => ({ draft: { ...s.draft, options: { ...s.draft.options, ...patch } }, startProblem: null }))
}

/** Pictures for the composer draft under `key`, capped at IMAGES_MAX; returns how many did not fit. */
export function addImages(key: string, add: ConsoleImage[]): number {
  const room = Math.max(0, IMAGES_MAX - (get().images[key]?.length ?? 0))
  if (room > 0) set((s) => ({ images: { ...s.images, [key]: [...(s.images[key] ?? []), ...add.slice(0, room)] } }))
  return add.length - Math.min(room, add.length)
}

export function removeImage(key: string, index: number): void {
  set((s) => ({ images: { ...s.images, [key]: (s.images[key] ?? []).filter((_, i) => i !== index) } }))
}

/** Ctrl+N, the palette and the New session button: the new session screen, with an empty draft. */
export function requestNewConversation(): void {
  useUi.getState().go(NEW_SESSION)
  set((s) => ({ selected: null, focusTick: s.focusTick + 1, draft: { ...s.draft, resume: null }, startProblem: null }))
}

/** Continue a session Claude Code already has (one AgentDeck lists, or an ended conversation): the next message resumes it. */
export function startResume(session: { sessionId: string; name: string; cwd: string; fork?: boolean }): void {
  useUi.getState().go(NEW_SESSION)
  set((s) => ({
    selected: null, focusTick: s.focusTick + 1, startProblem: null,
    draft: { ...s.draft, cwd: session.cwd, resume: { sessionId: session.sessionId, name: session.name, ...(session.fork ? { fork: true } : {}) } }
  }))
}

/** Resume a conversation that ended: the next message continues its Claude Code session in the same folder. */
export function resumeConversation(id: string): void {
  const v = get().convs[id]
  if (v?.thread.sessionId) startResume({ sessionId: v.thread.sessionId, name: v.info.title, cwd: v.info.cwd })
}

const FAILED = 'AgentDeck could not reach its main process.'
/** As main titles a conversation (console-hub.ts titleOf). */
const TITLE_MAX = 60

function placeholder(text: string, at: number): ConvInfo {
  const d = get().draft
  const cwd = d.cwd ?? recentProjects(useUi.getState().snapshot, 1)[0]?.cwd ?? ''
  const first = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).find(Boolean) ?? 'Conversation'
  const title = d.resume?.fork ? `Fork of ${d.resume.name}`.slice(0, TITLE_MAX) : first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX)}…` : first
  const fork = d.resume?.fork ? { sessionId: d.resume.sessionId, name: d.resume.name.slice(0, FORK_NAME_MAX) } : null
  return { id: '', title, cwd, startedAt: at, model: d.model, permissionMode: d.permissionMode, options: d.options, fork }
}

export interface SubmitOptions {
  /** `null`: a new conversation, even when another is open. An id: a message in that conversation. Absent: whichever is on screen. */
  conversation?: string | null
  /** What to send when it is not the draft as typed (the composer writes each @mention as @Name). */
  text?: string
  /** A new conversation: the role it runs as (`--agent`) and the roles it may consult (at most 4). */
  role?: string | null
  helpers?: string[]
  /** A message: the roles it is addressed to, for this one message. */
  mentions?: string[]
}

/** `id` is the conversation that was started, or the one that was written to. */
export type SubmitResult = { ok: true; id: string } | { ok: false; error: string }

/** Sends the composer's text: a new conversation when the new view is on screen, otherwise a message in the open one. */
export async function submit(o: SubmitOptions = {}): Promise<SubmitResult> {
  const { selected, texts, draft, starting } = get()
  const target = o.conversation === undefined ? selected : o.conversation
  const key = target ?? NEW
  const text = (o.text ?? texts[key] ?? '').trim()
  if (!text) return { ok: false, error: 'Type a message first.' }
  if (starting) return { ok: false, error: 'Still starting the conversation.' }
  const ui = useUi.getState()
  if (isDemo()) {
    const id = submitDemo(target, text, key)
    return { ok: true, id }
  }
  const bridge = window.agentdeck!
  const images = get().images[key] ?? []
  if (target !== null) {
    const sending = images.length
      ? bridge.consoleSend(target, text, o.mentions ?? [], images)
      : o.mentions?.length ? bridge.consoleSend(target, text, o.mentions) : bridge.consoleSend(target, text)
    const r = await sending.catch(() => ({ ok: false as const, error: FAILED }))
    if (r.ok) {
      setText(key, '')
      if (images.length) set((s) => ({ images: { ...s.images, [key]: [] } }))
      return { ok: true, id: target }
    }
    ui.notify(r.error, 'error')
    return { ok: false, error: r.error }
  }
  const cwd = draft.cwd ?? recentProjects(ui.snapshot, 1)[0]?.cwd
  if (!cwd) {
    set({ startProblem: { message: 'Pick a project first.', untrusted: false, cwd: '' } })
    return { ok: false, error: 'Pick a project first.' }
  }
  set({ starting: true, startProblem: null })
  const r: ConsoleStartResult = await bridge
    .consoleStart({
      cwd, prompt: text, model: draft.model, effort: draft.effort, permissionMode: draft.permissionMode, resume: draft.resume?.sessionId ?? null,
      ...(draft.resume?.fork ? { fork: true, forkOf: draft.resume.name } : {}),
      ...(o.role ? { role: o.role } : {}), ...(o.helpers?.length ? { helpers: o.helpers } : {}), ...(images.length ? { images } : {}), options: draft.options
    })
    .catch(() => ({ ok: false as const, error: FAILED, untrusted: false }))
  set({ starting: false })
  if (!r.ok) {
    set({ startProblem: { message: r.error, untrusted: r.untrusted, cwd } })
    return { ok: false, error: r.error }
  }
  const info = { ...placeholder(text, Date.now()), id: r.id, cwd }
  set((s) => {
    const v = s.convs[r.id]
    const convs = { ...s.convs, [r.id]: v ? { ...v, info } : { info, thread: emptyThread, loaded: false, buffer: [], unread: false } }
    return { convs, selected: r.id, texts: { ...s.texts, [NEW]: '' }, images: { ...s.images, [NEW]: [] }, draft: { ...s.draft, resume: null }, focusTick: s.focusTick + 1 }
  })
  useUi.getState().openSession(r.id)
  if (!get().convs[r.id]?.loaded) void loadHistory(r.id)
  void refreshList()
  return { ok: true, id: r.id }
}

/** Interrupts the running turn; with nothing running, ends the conversation. */
export async function stopConversation(id: string): Promise<void> {
  if (isDemo()) return
  const r = await window.agentdeck!.consoleStop(id).catch(() => ({ ok: false as const, error: FAILED }))
  if (!r.ok) useUi.getState().notify(r.error, 'error')
}

export const isRunning = (v: ConvView | undefined): boolean => v !== undefined && isWorking(v.thread)

export type AllowOutcome = { ok: true } | { ok: false; error: string; restart: boolean }

const retryMessage = (label: string): string => `I allowed ${label} for this conversation. Please try that again.`

/**
 * "Allow this tool for this conversation": live, with no restart (main sends `apply_flag_settings`); with `retry`, a message follows so
 * Claude tries the call again. Nothing is stored: the rule lives in the running process.
 */
export async function allowTool(id: string, rule: string, label: string, retry: boolean): Promise<AllowOutcome> {
  if (isDemo()) {
    demoAllow(id, rule, label, retry)
    return { ok: true }
  }
  const bridge = window.agentdeck!
  const r = await bridge.consoleAllow(id, rule).catch(() => ({ ok: false as const, error: FAILED, restart: false }))
  if (!r.ok) return r
  if (retry) await bridge.consoleSend(id, retryMessage(label)).catch(() => undefined)
  return { ok: true }
}

/** This Claude Code could not take the rule while running: end the conversation and continue its session in a new process that starts with it. */
export async function continueWithAllowance(id: string, rule: string, label: string): Promise<AllowOutcome> {
  const v = get().convs[id]
  const sessionId = v?.thread.sessionId
  if (!v || !sessionId) return { ok: false, error: 'This conversation has no session to continue.', restart: false }
  if (isDemo()) return { ok: true }
  const bridge = window.agentdeck!
  const options = { ...v.info.options, allowedTools: [...new Set([...v.thread.allowed, rule])] }
  await bridge.consoleStop(id).catch(() => undefined)
  const r: ConsoleStartResult = await bridge
    .consoleStart({ cwd: v.info.cwd, prompt: retryMessage(label), model: v.info.model, effort: get().draft.effort, permissionMode: v.info.permissionMode, resume: sessionId, options })
    .catch(() => ({ ok: false as const, error: FAILED, untrusted: false }))
  if (!r.ok) return { ok: false, error: r.error, restart: false }
  set((s) => ({ selected: r.id, focusTick: s.focusTick + 1 }))
  useUi.getState().openSession(r.id)
  void refreshList()
  return { ok: true }
}

// ── demo ──

let demoCount = 0

function seedDemo(): void {
  const now = Date.now()
  for (const c of demoConversations(now)) addView(c.info.id, { info: c.info, thread: applyHistory(c.events), loaded: true, buffer: [], unread: false })
  rememberCapabilities(demoCapabilities(), false)
}

function submitDemo(selected: string | null, text: string, key: string): string {
  const now = Date.now()
  const id = selected ?? `demo-new-${++demoCount}`
  const existing = selected === null ? undefined : get().convs[selected]
  const base = existing?.thread ?? emptyThread
  const info: ConvInfo = existing?.info ?? { ...placeholder(text, now), id, cwd: get().draft.cwd ?? demoConversations(now)[1]!.info.cwd }
  const user = { id: `${id}:${base.lastSeq + 1}`, conversation: id, seq: base.lastSeq + 1, ts: now, kind: 'user', text } as const
  const events = [user, ...demoReply(id, base.lastSeq + 2, now, text)]
  set((s) => ({
    convs: { ...s.convs, [id]: { info, thread: events.reduce(applyLive, base), loaded: true, buffer: [], unread: false } },
    selected: id, texts: { ...s.texts, [key]: '' }, draft: { ...s.draft, resume: null }, focusTick: s.focusTick + 1
  }))
  useUi.getState().openSession(id)
  return id
}

/** Demo: the rule is added to the thread, and a retry gets the scripted reply (nothing runs). */
function demoAllow(id: string, rule: string, label: string, retry: boolean): void {
  const v = get().convs[id]
  if (!v) return
  const now = Date.now()
  const tools = [...new Set([...v.thread.allowed, rule])]
  const allowed = { id: `${id}:${v.thread.lastSeq + 1}`, conversation: id, seq: v.thread.lastSeq + 1, ts: now, kind: 'allowed', tools } as const
  updateView(id, (x) => ({ ...x, info: { ...x.info, options: { ...x.info.options, allowedTools: tools } }, thread: applyLive(x.thread, allowed) }))
  if (retry) submitDemo(id, retryMessage(label), id)
}

/** Test seam: forget everything (a new window starts from nothing). */
export function resetConsole(): void {
  connected = false
  demoCount = 0
  useConsole.setState({ convs: {}, selected: null, texts: {}, images: {}, startProblem: null, starting: false, draft: { cwd: null, model: null, effort: 'high', permissionMode: 'default', resume: null, options: NO_OPTIONS } })
}
