import { randomBytes } from 'node:crypto'
import { rmSync } from 'node:fs'
import type { ActionResult } from '@shared/bridge'
import {
  CONSOLE_MAX_LIVE, FORK_NAME_MAX, TOOL_RULES_MAX, type ConsoleAllowResult, type ConsoleBody, type ConsoleEvent, type ConsoleImage, type ConsoleProblem, type ConsoleStart, type ConsoleStartResult,
  type ConsoleState, type ConsoleSummary
} from '@shared/console'
import { cap, maskSecrets } from '../collector/redact'
import { NO_CLI, stripAnsi } from './actions'
import { StreamMapper } from './console-parse'
import { NO_ROLE, mentionPrompt, type HelperRef, type MentionTarget, type RolePlan } from './console-roles'
import { PROBLEM_TEXT, classify, redactBody } from './console-text'
import { consoleArgs, isShim, spawnConsole, type ClaudeCommand, type ConsoleChild, type ExitInfo, type ProcHooks, type ProcOptions } from './console-proc'
import { History } from './console-store'

export interface HubDeps {
  command(): Promise<ClaudeCommand | null>
  env(): NodeJS.ProcessEnv
  emit(e: ConsoleEvent): void
  now(): number
  /** A conversation's Claude Code session id became known (`init`): main notes the role under it (session-meta.ts). */
  sessionKnown?(summary: ConsoleSummary): void
  /** Only a test replaces the real process. */
  spawn?(cmd: ClaudeCommand, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, hooks: ProcHooks): ConsoleChild
}

export interface HubTuning {
  /** Streaming text reaches the page in steps this far apart, not once per token. */
  flushMs: number
  /** After an interrupt, how long Claude Code gets to end the turn before AgentDeck closes it. */
  stopGraceMs: number
  /** After the input is closed, how long it gets to exit. */
  endGraceMs: number
  /** A conversation nobody writes to for this long is closed (its session stays resumable). */
  idleMs: number
  /** Conversations kept in the list, live or finished. */
  keep: number
  /** How long a control request (allowing a tool in a running conversation) gets to be answered. */
  controlMs: number
}

const TUNING: HubTuning = { flushMs: 40, stopGraceMs: 5_000, endGraceMs: 3_000, idleMs: 30 * 60_000, keep: 30, controlMs: 5_000 }

/** Deletes a definitions file; a missing one is fine. */
function forget(file: string | null): void {
  if (!file) return
  try {
    rmSync(file, { force: true })
  } catch {
    // Left behind at worst; the next start sweeps the folder.
  }
}

const NOT_OPEN = 'This conversation is not open (any more).'
const ENDED = 'This conversation has ended. Resume it from the list to continue.'
const TITLE_MAX = 60
const isText = (b: ConsoleBody): b is Extract<ConsoleBody, { kind: 'assistant-text' | 'thinking' }> => b.kind === 'assistant-text' || b.kind === 'thinking'

/** The first line of the prompt, as a title. */
export function titleOf(prompt: string): string {
  const line = prompt.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? 'Conversation'
  return cap(maskSecrets(line.replace(/\s+/g, ' ')), TITLE_MAX)
}

/** The title of a conversation that copies another session. */
export function forkTitle(name: string): string {
  return cap(maskSecrets(`Fork of ${name.replace(/\s+/g, ' ').trim() || 'a session'}`), TITLE_MAX)
}

/** Why `claude` left, in plain words (and the problem it names, when the user fixes it elsewhere). */
export function explainExit(i: ExitInfo): { error: string; problem: ConsoleProblem | null } {
  const text = stripAnsi(i.stderr)
  const problem = classify(text)
  if (problem) return { error: PROBLEM_TEXT[problem], problem }
  const last = text.split('\n').map((l) => l.trim()).filter(Boolean).at(-1)
  const said = last ? cap(maskSecrets(last), 200) : ''
  if (i.spawnFailed) return { error: `AgentDeck could not start Claude Code${said ? `: ${said}` : '.'}`, problem: null }
  const how = i.code !== null ? `exit code ${i.code}` : 'it was closed'
  return { error: `Claude Code stopped unexpectedly (${how}).${said ? ` It said: ${said}` : ''}`, problem: null }
}

class Conv {
  seq = 0
  readonly history = new History()
  /** Turns sent and not yet ended. */
  pending = 0
  stopping = false
  endedByUs = false
  endNote: string | null = null
  /** Protocol behaviours this Claude Code advertises (init): what the interrupt can do. */
  protocol: string[] = []
  /** Control requests waiting for their answer, by request id. */
  readonly controls = new Map<string, (ok: boolean) => void>()
  child!: ConsoleChild
  /** What this conversation was started as: the role arguments, the definitions file (deleted once read), who the lead can ask. */
  plan: RolePlan = NO_ROLE
  /** The session id `sessionKnown` was last told: Claude Code repeats `init` every turn (checked on 2.1.323), the note is made once per id. */
  noted: string | null = null
  readonly texts = new Map<string, ConsoleBody>()
  flushTimer: NodeJS.Timeout | undefined
  stopTimer: NodeJS.Timeout | undefined
  endTimer: NodeJS.Timeout | undefined
  idleTimer: NodeJS.Timeout | undefined

  constructor(
    public summary: ConsoleSummary,
    readonly mapper: StreamMapper
  ) {}

  clearTimers(): void {
    for (const t of [this.flushTimer, this.stopTimer, this.endTimer, this.idleTimer]) clearTimeout(t)
    this.flushTimer = this.stopTimer = this.endTimer = this.idleTimer = undefined
  }
}

/**
 * One `claude -p` per conversation (see console-proc.ts), the events they produce (console-parse.ts), and what a page opened later
 * can read back (console-store.ts). No Electron in here: console.ts adds the window, the IPC and the folder rules.
 */
export class ConsoleHub {
  private readonly convs = new Map<string, Conv>()
  private readonly tuning: HubTuning

  constructor(
    private readonly deps: HubDeps,
    tuning: Partial<HubTuning> = {}
  ) {
    this.tuning = { ...TUNING, ...tuning }
  }

  private live(): Conv[] {
    return [...this.convs.values()].filter((c) => c.summary.state !== 'ended' && c.summary.state !== 'failed')
  }

  /**
   * `plan` is what console-roles.ts made of `req.role` and `req.helpers`. Its definitions file is this conversation's: it is
   * deleted when Claude Code has read it (`init`), when the process exits, when the hub is disposed, and here when the start fails.
   */
  async start(req: ConsoleStart, plan: RolePlan = NO_ROLE): Promise<ConsoleStartResult> {
    const cmd = await this.deps.command()
    if (!cmd) {
      forget(plan.file)
      return { ok: false, error: NO_CLI, untrusted: false }
    }
    // Checked after the await and registered in the same tick, so two starts at once can not both take the last place.
    if (this.live().length >= CONSOLE_MAX_LIVE) {
      forget(plan.file)
      return { ok: false, error: `${CONSOLE_MAX_LIVE} conversations are already running. End one, then start again.`, untrusted: false }
    }
    const id = `c_${randomBytes(4).toString('hex')}`
    // Only a resumed session can be copied. The copy gets its own session id from Claude Code (init), which replaces `sessionId` below.
    const fork = req.fork === true && req.resume !== null ? { sessionId: req.resume, name: cap(maskSecrets(req.forkOf ?? 'a session'), FORK_NAME_MAX) } : null
    const conv = new Conv(
      {
        id, title: fork ? forkTitle(fork.name) : titleOf(req.prompt), cwd: req.cwd, startedAt: this.deps.now(), state: 'starting', sessionId: null, turns: 0, costUsd: 0,
        model: req.model, permissionMode: req.permissionMode, options: req.options, fork, error: null, problem: null, role: plan.lead, helpers: plan.helpers.map(({ id, name, emoji }) => ({ id, name, emoji }))
      },
      new StreamMapper(req.cwd, req.resume !== null)
    )
    conv.plan = plan
    this.convs.set(id, conv)
    this.prune()
    const options: ProcOptions = { model: req.model, effort: req.effort, permissionMode: req.permissionMode, resume: req.resume, fork: fork !== null, roleArgs: plan.args, options: req.options }
    conv.child = (this.deps.spawn ?? spawnConsole)(cmd, consoleArgs(options, isShim(cmd.file)), req.cwd, this.deps.env(), {
      onLine: (line) => this.line(conv, line),
      onExit: (info) => this.exited(conv, info)
    })
    if (req.options.allowedTools.length) this.publish(conv, { kind: 'allowed', tools: req.options.allowedTools })
    // The user's words stay first and untouched; with helpers one factual line follows. The thread shows only the user's words.
    this.sendPrompt(conv, plan.opening ? `${req.prompt}\n\n${plan.opening}` : req.prompt, req.prompt, req.images)
    return { ok: true, id }
  }

  /**
   * `mentions`: roles this one message addresses. Claude Code gets the message worded to delegate to them (console-roles.ts
   * `mentionPrompt`); the thread shows what the user typed. The conversation's own role does not change.
   */
  send(id: string, text: string, mentions: readonly MentionTarget[] = [], images: readonly ConsoleImage[] = []): ActionResult {
    const conv = this.convs.get(id)
    if (!conv) return { ok: false, error: NOT_OPEN }
    if (conv.summary.state === 'ended' || conv.summary.state === 'failed') return { ok: false, error: ENDED }
    const wire = mentions.length ? mentionPrompt(text, mentions) : text
    return this.sendPrompt(conv, wire, text, images) ? { ok: true } : { ok: false, error: 'Claude Code is no longer listening. Start the conversation again.' }
  }

  /** Who this conversation runs as and who its lead was given, for resolving a later @mention; null when it is not open. */
  roleInfo(id: string): { lead: string | null; helpers: HelperRef[] } | null {
    const conv = this.convs.get(id)
    return conv ? { lead: conv.plan.lead?.id ?? null, helpers: conv.plan.helpers } : null
  }

  /** Interrupts the running turn when there is one; otherwise ends the conversation. */
  stop(id: string): ActionResult {
    const conv = this.convs.get(id)
    if (!conv) return { ok: false, error: NOT_OPEN }
    const state = conv.summary.state
    if (state === 'ended' || state === 'failed') return { ok: true }
    if (state === 'working' && conv.pending > 0) {
      if (conv.stopping) return { ok: true }
      conv.stopping = true
      const cancelQueued = conv.protocol.includes('interrupt_cancel_queued_v1')
      conv.child.write({
        type: 'control_request',
        request_id: `ad_${randomBytes(4).toString('hex')}`,
        request: { subtype: 'interrupt', ...(cancelQueued ? { cancel_queued: true } : {}) }
      })
      // The interrupt is a request; if the turn does not end, the process goes (the session stays resumable).
      conv.stopTimer = setTimeout(() => this.end(conv, 'Stopped. Claude Code did not answer the interrupt in time, so AgentDeck closed it. Resume it to continue.', true), this.tuning.stopGraceMs)
      return { ok: true }
    }
    this.end(conv, null, false)
    return { ok: true }
  }

  /**
   * Lets one more tool run without asking in this conversation, now, with no restart: `apply_flag_settings` merges
   * `permissions.allow` into the running session (checked on 2.1.323 with `list_permission_rules`, which then shows the rule from
   * `flagSettings`). The whole list is sent each time. `restart`: this Claude Code did not take it; resume with the rule instead.
   */
  async allow(id: string, rule: string): Promise<ConsoleAllowResult> {
    const conv = this.convs.get(id)
    if (!conv) return { ok: false, error: NOT_OPEN, restart: false }
    if (conv.summary.state === 'ended' || conv.summary.state === 'failed') return { ok: false, error: ENDED, restart: true }
    const allowed = [...new Set([...conv.summary.options.allowedTools, rule])]
    if (allowed.length > TOOL_RULES_MAX) return { ok: false, error: `At most ${TOOL_RULES_MAX} tools can be allowed in one conversation.`, restart: false }
    const requestId = `ad_${randomBytes(4).toString('hex')}`
    const answered = new Promise<boolean>((resolve) => {
      conv.controls.set(requestId, resolve)
      setTimeout(() => resolve(false), this.tuning.controlMs).unref()
    })
    const sent = conv.child.write({ type: 'control_request', request_id: requestId, request: { subtype: 'apply_flag_settings', settings: { permissions: { allow: allowed } } } })
    const ok = sent && (await answered)
    conv.controls.delete(requestId)
    if (!ok) return { ok: false, error: 'This Claude Code did not take the new rule while running.', restart: true }
    conv.summary = { ...conv.summary, options: { ...conv.summary.options, allowedTools: allowed } }
    this.publish(conv, { kind: 'allowed', tools: allowed })
    return { ok: true, allowed }
  }

  list(): ConsoleSummary[] {
    return [...this.convs.values()].map((c) => c.summary).sort((a, b) => b.startedAt - a.startedAt)
  }

  history(id: string): ConsoleEvent[] {
    return this.convs.get(id)?.history.list() ?? []
  }

  /** Quit, or the window is gone: no child outlives AgentDeck. */
  dispose(): void {
    for (const conv of this.convs.values()) {
      conv.clearTimers()
      conv.endedByUs = true
      conv.child?.killTree()
      // Synchronous: the process may be gone before an async delete would run.
      forget(conv.plan.file)
    }
  }

  // ── internals ──

  /** `text` goes to Claude Code, after any `images` as base64 content blocks; `shown` (the user's own words, by default the same) goes in the thread. */
  private sendPrompt(conv: Conv, text: string, shown: string = text, images: readonly ConsoleImage[] = []): boolean {
    const content = images.length
      ? [...images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mediaType, data: i.data } })), { type: 'text', text }]
      : text
    if (!conv.child.write({ type: 'user', message: { role: 'user', content } })) return false
    clearTimeout(conv.idleTimer)
    conv.pending++
    // The picture itself is never kept in the thread (memory only, and large); the thread says one was sent.
    this.queue(conv, { kind: 'user', text: images.length ? `${shown}\n\n[${images.length === 1 ? '1 image' : `${images.length} images`} attached]` : shown })
    this.setState(conv, 'working')
    return true
  }

  private end(conv: Conv, note: string | null, hard: boolean): void {
    if (conv.endedByUs) return
    conv.endedByUs = true
    conv.endNote = note
    clearTimeout(conv.stopTimer)
    conv.child.endInput()
    if (hard) conv.child.killTree()
    else conv.endTimer = setTimeout(() => conv.child.killTree(), this.tuning.endGraceMs)
  }

  private armIdle(conv: Conv): void {
    clearTimeout(conv.idleTimer)
    conv.idleTimer = setTimeout(() => this.end(conv, 'Ended after 30 minutes without a message. Resume it to continue.', false), this.tuning.idleMs)
  }

  private line(conv: Conv, line: string): void {
    const mapped = conv.mapper.map(line)
    if (mapped.init) {
      conv.protocol = mapped.init.protocol
      // `model` stays what was asked for; the model in use is `capabilities.model`.
      conv.summary = { ...conv.summary, sessionId: mapped.init.sessionId }
      // Claude Code has read its arguments: the definitions file has done its job.
      forget(conv.plan.file)
      this.publishState(conv)
      if (mapped.init.sessionId !== conv.noted) {
        conv.noted = mapped.init.sessionId
        this.deps.sessionKnown?.(conv.summary)
      }
    }
    this.checkRole(conv, mapped.drafts)
    if (mapped.control) conv.controls.get(mapped.control.requestId)?.(mapped.control.ok)
    for (const d of mapped.drafts) this.queue(conv, d.kind === 'turn-end' && conv.stopping ? { ...d, interrupted: true } : d)
    if (mapped.turnEnded) this.turnEnded(conv, mapped.problem ?? null)
  }

  /**
   * `--agent` with a name Claude Code does not have is not an error: it silently runs as a bare agent. So once Claude Code says which
   * agents it has (`init`), the one the conversation was started as must be among them, or the user is told at once.
   */
  private checkRole(conv: Conv, drafts: readonly ConsoleBody[]): void {
    const expect = conv.plan.expect
    if (!expect) return
    for (const d of drafts) {
      if (d.kind !== 'capabilities') continue
      conv.plan = { ...conv.plan, expect: null }
      if (!d.capabilities.agents.some((a) => a.name === expect)) {
        this.publish(conv, { kind: 'notice', level: 'warn', text: `Claude Code did not list the role “${conv.summary.role?.name ?? expect}”, so this conversation is running as plain Claude Code. Stop it and start again, or reload the roles first.` })
      }
      return
    }
  }

  private turnEnded(conv: Conv, problem: ConsoleProblem | null): void {
    this.flush(conv)
    clearTimeout(conv.stopTimer)
    // An interrupt that cancels the queue leaves nothing running; otherwise each queued message still gets its own turn.
    conv.pending = conv.stopping && conv.protocol.includes('interrupt_cancel_queued_v1') ? 0 : Math.max(0, conv.pending - 1)
    conv.stopping = false
    if (problem) {
      // Nothing more can happen in this conversation until the user fixes it elsewhere, so the process goes.
      conv.summary = { ...conv.summary, problem }
      this.end(conv, PROBLEM_TEXT[problem], true)
      return
    }
    if (conv.pending > 0) return
    this.setState(conv, 'idle')
    this.armIdle(conv)
  }

  private exited(conv: Conv, info: ExitInfo): void {
    conv.clearTimers()
    forget(conv.plan.file)
    for (const answer of conv.controls.values()) answer(false)
    this.flush(conv)
    const clean = conv.endedByUs || (info.code === 0 && conv.pending === 0)
    conv.pending = 0
    const known = conv.summary.problem
    if (known) {
      this.setState(conv, 'failed', PROBLEM_TEXT[known], known)
      return
    }
    if (clean) {
      this.setState(conv, 'ended', conv.endNote)
      return
    }
    const why = explainExit(info)
    this.setState(conv, 'failed', why.error, why.problem)
  }

  /** Whole messages go out at once; text still being written goes in steps, the latest version of each message winning. */
  private queue(conv: Conv, body: ConsoleBody): void {
    if (isText(body) && !body.final) {
      conv.texts.set(`${body.kind}:${body.messageId}`, body)
      conv.flushTimer ??= setTimeout(() => this.flush(conv), this.tuning.flushMs)
      return
    }
    if (isText(body)) conv.texts.delete(`${body.kind}:${body.messageId}`)
    this.flush(conv)
    this.publish(conv, body)
  }

  private flush(conv: Conv): void {
    clearTimeout(conv.flushTimer)
    conv.flushTimer = undefined
    const pending = [...conv.texts.values()]
    conv.texts.clear()
    for (const body of pending) this.publish(conv, body)
  }

  private setState(conv: Conv, state: ConsoleState, error: string | null = null, problem: ConsoleProblem | null = null): void {
    const s = conv.summary
    if (s.state === state && s.error === error && s.problem === problem) return
    conv.summary = { ...s, state, error, problem }
    this.publishState(conv)
  }

  private publishState(conv: Conv): void {
    const s = conv.summary
    this.publish(conv, { kind: 'state', state: s.state, sessionId: s.sessionId, error: s.error, problem: s.problem })
  }

  private publish(conv: Conv, body: ConsoleBody): void {
    const safe = redactBody(body)
    if (safe.kind === 'turn-end') conv.summary = { ...conv.summary, turns: conv.summary.turns + 1, costUsd: safe.totalCostUsd ?? conv.summary.costUsd }
    const seq = ++conv.seq
    const e = { id: `${conv.summary.id}:${seq}`, conversation: conv.summary.id, seq, ts: this.deps.now(), ...safe } as ConsoleEvent
    conv.history.push(e)
    this.deps.emit(e)
  }

  /** The list keeps this many; the oldest finished ones go first. */
  private prune(): void {
    while (this.convs.size > this.tuning.keep) {
      const old = [...this.convs.values()].filter((c) => c.summary.state === 'ended' || c.summary.state === 'failed').sort((a, b) => a.summary.startedAt - b.summary.startedAt)[0]
      if (!old) return
      this.convs.delete(old.summary.id)
    }
  }
}
