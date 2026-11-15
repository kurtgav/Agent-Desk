import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { z } from 'zod'
import { EFFORTS, IPC, type ActionResult } from '@shared/bridge'
import {
  ADD_DIRS_MAX, APPEND_PROMPT_MAX, BUDGET_USD_MAX, CONSOLE_PROMPT_MAX, CONVERSATION_ID, HELPERS_MAX, IMAGES_MAX, IMAGE_BASE64_MAX, IMAGE_TYPES, MODEL_PATTERN, PERMISSION_MODES, RESUME_PATTERN, TOOL_RULE, TOOL_RULES_MAX,
  isFallbackModels, type ConsoleAllowResult, type ConsoleEvent, type ConsoleStartResult, type ConsoleSummary, type McpListResult, type ModelListResult
} from '@shared/console'
import { ROLE_ID } from '@shared/roles'
import { cleanEnv } from '../collector/cli'
import { LOCAL_PATH, NO_CLI } from './actions'
import { ConsoleHub } from './console-hub'
import { McpList } from './console-mcp'
import { ModelList } from './console-models'
import type { ClaudeCommand } from './console-proc'
import { INLINE_ROLE_MAX_BYTES, planRole, removeRoleFile, sweepRoleFiles, type MentionTarget } from './console-roles'
import { isShim } from './console-proc'
import type { Dispose, MainCtx } from './ctx'
import { NOT_KNOWN, NOT_LOCAL, knownFolder } from './dispatch'
import { roles } from './roles'
import { noteRole } from './session-meta'

/** What the Console needs from main beyond MainCtx. */
export interface ConsoleDeps {
  /** The Claude Code CLI as ADR-0008 resolves it, or null. */
  command(): Promise<ClaudeCommand | null>
  /** Folders AgentDeck saw a session in, plus the ones picked with Browse… (the Composer's rule, D-109..D-123). */
  knownFolders(): string[]
}

const DEMO_START = 'Demo data: nothing was started.'
const DEMO_TEXT = 'Demo data: nothing was run.'
const DEMO_REFUSED: ActionResult = { ok: false, error: DEMO_TEXT }
const REFUSED = 'AgentDeck did not accept that request.'

/** Every renderer input is checked here: the page is not trusted (ADR-0010). */
const Prompt = z.string().trim().min(1).max(CONSOLE_PROMPT_MAX)
const Folder = z.string().min(3).max(1024)
const Rules = z.array(z.string().regex(TOOL_RULE)).max(TOOL_RULES_MAX)
/** The Advanced section: every field is a documented `claude --help` flag, checked here and passed as an argument (console-proc.ts). */
const Options = z.strictObject({
  allowedTools: Rules,
  disallowedTools: Rules,
  addDirs: z.array(Folder).max(ADD_DIRS_MAX),
  appendSystemPrompt: z.string().trim().min(1).max(APPEND_PROMPT_MAX).refine((s) => [...s].every((c) => c.charCodeAt(0) >= 32 || c === '\n' || c === '\r' || c === '\t')).nullable(),
  fallbackModel: z.string().refine(isFallbackModels).nullable(),
  maxBudgetUsd: z.number().min(0.01).max(BUDGET_USD_MAX).nullable()
})
/** Pasted pictures: a known image type and plain base64, capped; the page is not trusted to say what it is sending. */
const Images = z
  .array(z.strictObject({ mediaType: z.enum(IMAGE_TYPES), data: z.string().min(1).max(IMAGE_BASE64_MAX).regex(/^[A-Za-z0-9+/]+={0,2}$/) }))
  .max(IMAGES_MAX)
const BAD_IMAGES = `Attach up to ${IMAGES_MAX} images (PNG, JPEG, GIF or WebP, under 3.5 MB each).`
const FORK_NEEDS_SESSION ='A fork needs a session to copy.'
const ROLE_NEEDS_NEW = 'A resumed conversation keeps the role it began with. Start a new one to pick another.'
const TOO_MANY_HELPERS = `A conversation can have up to ${HELPERS_MAX} helper roles.`
const Start = z
  .strictObject({
    cwd: Folder,
    prompt: Prompt,
    model: z.string().regex(MODEL_PATTERN).nullable(),
    effort: z.enum(EFFORTS),
    permissionMode: z.enum(PERMISSION_MODES),
    resume: z.string().regex(RESUME_PATTERN).nullable(),
    fork: z.boolean().optional(),
    forkOf: z.string().trim().min(1).max(500).optional(),
    /** Roles are ids in the catalog (never a name or a path); main looks each one up itself. */
    role: z.string().regex(ROLE_ID).nullable().optional(),
    helpers: z.array(z.string().regex(ROLE_ID)).max(HELPERS_MAX).optional(),
    images: Images.optional(),
    options: Options
  })
  // A fork is a copy of the session `resume` names: without one there is nothing to copy.
  .superRefine((s, ctx) => {
    if ((s.fork === true || s.forkOf !== undefined) && s.resume === null) ctx.addIssue({ code: 'custom', path: ['fork'], message: FORK_NEEDS_SESSION })
    else if (s.forkOf !== undefined && s.fork !== true) ctx.addIssue({ code: 'custom', path: ['forkOf'], message: REFUSED })
    // A resumed or forked session already is whatever it was; a role would silently change who it answers as.
    if (s.resume !== null && (s.role || (s.helpers?.length ?? 0) > 0)) ctx.addIssue({ code: 'custom', path: ['role'], message: ROLE_NEEDS_NEW })
  })
const Mentions = z.array(z.string().regex(ROLE_ID)).max(HELPERS_MAX)
const Rule = z.string().regex(TOOL_RULE)
const ConversationId = z.string().regex(CONVERSATION_ID)

const NOT_ALLOWED = 'AgentDeck did not accept that rule.'
const TOO_LONG = `That message is longer than ${CONSOLE_PROMPT_MAX.toLocaleString('en-US')} characters.`

/**
 * The Console: child `claude -p --input-format stream-json --output-format stream-json` processes, one per conversation
 * (console-hub.ts). Registers the IPC.console* channels and pushes IPC.consoleEvent to the window.
 */
export function registerConsole(ctx: MainCtx, deps: ConsoleDeps): Dispose {
  const watched = new WeakSet<BrowserWindow>()
  const mcp = new McpList()
  const models = new ModelList()
  /** Definitions files for conversations started as a role (console-roles.ts). Nothing is running yet, so whatever is there is left over from a crash. */
  const tmpDir = join(ctx.userData(), 'tmp')
  void sweepRoleFiles(tmpDir)
  const hub: ConsoleHub = new ConsoleHub({
    command: deps.command,
    env: cleanEnv,
    now: Date.now,
    // The session id is known: note the role under it, so Sessions, Running now and the drawer can show it (session-meta.ts).
    sessionKnown: (s) => {
      const role = s.role
      if (!role || !s.sessionId || ctx.demo()) return
      try {
        noteRole(ctx.configFile(), [s.sessionId], role.id, Date.now())
      } catch {
        // The badge is a convenience; a conversation never fails because config.json could not be written.
      }
    },
    emit: (e: ConsoleEvent) => {
      const w = ctx.window()
      if (!w || w.isDestroyed()) return
      // A conversation does not outlive the window it is shown in.
      if (!watched.has(w)) {
        watched.add(w)
        w.once('closed', () => hub.dispose())
      }
      try {
        w.webContents.send(IPC.consoleEvent, e)
      } catch {
        // The page went away between the check and the send; the history still has the event for the next page.
      }
    }
  })

  async function start(raw: unknown): Promise<ConsoleStartResult> {
    if (ctx.demo()) return { ok: false, error: DEMO_START, untrusted: false }
    const parsed = Start.safeParse(raw)
    if (!parsed.success) {
      const long = parsed.error.issues.some((i) => i.path[0] === 'prompt' && i.code === 'too_big')
      const noSession = parsed.error.issues.some((i) => i.path[0] === 'fork' && i.message === FORK_NEEDS_SESSION)
      const roleNeedsNew = parsed.error.issues.some((i) => i.message === ROLE_NEEDS_NEW)
      const helpers = parsed.error.issues.some((i) => i.path[0] === 'helpers' && i.code === 'too_big')
      const images = parsed.error.issues.some((i) => i.path[0] === 'images')
      return { ok: false, error: long ? TOO_LONG : noSession ? FORK_NEEDS_SESSION : roleNeedsNew ? ROLE_NEEDS_NEW : helpers ? TOO_MANY_HELPERS : images ? BAD_IMAGES : REFUSED, untrusted: false }
    }
    const req = { ...parsed.data, options: { ...parsed.data.options, allowedTools: [...new Set(parsed.data.options.allowedTools)], disallowedTools: [...new Set(parsed.data.options.disallowedTools)], addDirs: [...new Set(parsed.data.options.addDirs)] } }
    // The Composer's rule, for the working folder and every extra folder: a local folder AgentDeck knows, never a path the page names by itself.
    for (const dir of [req.cwd, ...req.options.addDirs]) {
      if (!LOCAL_PATH.test(dir)) return { ok: false, error: NOT_LOCAL, untrusted: false }
      if (!(await knownFolder(dir, deps.knownFolders()))) return { ok: false, error: NOT_KNOWN, untrusted: false }
    }
    // The role and its helpers are looked up here; the window only named ids. A refusal says why, in plain words.
    const cmd = await deps.command()
    const planned = await planRole(req, { roles: roles(), tmpDir, viaCmd: cmd !== null && isShim(cmd.file) })
    if (!planned.ok) return { ok: false, error: planned.error, untrusted: false }
    try {
      return await hub.start(req, planned.plan)
    } catch {
      await removeRoleFile(planned.plan.file)
      return { ok: false, error: 'AgentDeck could not start Claude Code.', untrusted: false }
    }
  }

  /** Each role a message names, as something Claude Code can be told to use: a subagent it already has, or a role described in the message. */
  async function mentionTargets(id: string, ids: readonly string[]): Promise<MentionTarget[] | ActionResult> {
    const info = hub.roleInfo(id)
    if (!info || ids.length === 0) return []
    const svc = roles()
    if (!svc) return { ok: false, error: 'AgentDeck is still reading its roles. Try again in a moment.' }
    const out: MentionTarget[] = []
    for (const rid of new Set(ids)) {
      if (rid === info.lead) continue // the conversation already is this role
      const helper = info.helpers.find((h) => h.id === rid)
      if (helper) {
        out.push({ kind: 'named', name: helper.name, subagent: helper.subagent })
        continue
      }
      const r = await svc.roleForSpawn(rid)
      if (!r) return { ok: false, error: `AgentDeck does not have the role “${rid}” any more.` }
      if (r.agentName) out.push({ kind: 'named', name: r.name, subagent: r.agentName })
      else if (Buffer.byteLength(r.prompt) <= INLINE_ROLE_MAX_BYTES) out.push({ kind: 'inline', name: r.name, text: r.prompt })
      else return { ok: false, error: `“${r.name}” is too long to bring into a running conversation. Start a new conversation with it.` }
    }
    return out
  }

  async function send(rawId: unknown, rawText: unknown, rawMentions: unknown, rawImages?: unknown): Promise<ActionResult> {
    if (ctx.demo()) return DEMO_REFUSED
    const id = ConversationId.safeParse(rawId)
    const text = Prompt.safeParse(rawText)
    const mentions = Mentions.safeParse(rawMentions ?? [])
    const images = Images.safeParse(rawImages ?? [])
    if (!id.success || !mentions.success) return { ok: false, error: REFUSED }
    if (!images.success) return { ok: false, error: BAD_IMAGES }
    if (!text.success) return { ok: false, error: text.error.issues.some((i) => i.code === 'too_big') ? TOO_LONG : 'Type a message first.' }
    const targets = await mentionTargets(id.data, mentions.data)
    return Array.isArray(targets) ? hub.send(id.data, text.data, targets, images.data) : targets
  }

  function stop(rawId: unknown): ActionResult {
    if (ctx.demo()) return DEMO_REFUSED
    const id = ConversationId.safeParse(rawId)
    return id.success ? hub.stop(id.data) : { ok: false, error: REFUSED }
  }

  async function allow(rawId: unknown, rawRule: unknown): Promise<ConsoleAllowResult> {
    if (ctx.demo()) return { ok: false, error: DEMO_TEXT, restart: false }
    const id = ConversationId.safeParse(rawId)
    const rule = Rule.safeParse(rawRule)
    if (!id.success || !rule.success) return { ok: false, error: NOT_ALLOWED, restart: false }
    return hub.allow(id.data, rule.data)
  }

  /** `claude mcp list` for the Advanced and Capabilities screens: only a folder AgentDeck knows may be the working folder. */
  async function mcpList(rawCwd: unknown): Promise<McpListResult> {
    if (ctx.demo()) return { ok: false, error: DEMO_TEXT }
    const cwd = Folder.nullable().safeParse(rawCwd)
    if (!cwd.success) return { ok: false, error: REFUSED }
    if (cwd.data !== null && (!LOCAL_PATH.test(cwd.data) || !(await knownFolder(cwd.data, deps.knownFolders())))) return { ok: false, error: NOT_KNOWN }
    const cmd = await deps.command()
    return cmd ? mcp.list(cmd, cwd.data, cleanEnv()) : { ok: false, error: NO_CLI }
  }

  async function modelList(): Promise<ModelListResult> {
    if (ctx.demo()) return { ok: false, error: DEMO_TEXT }
    const cmd = await deps.command()
    return cmd ? models.list(cmd, cleanEnv(), join(ctx.userData(), 'model-list')) : { ok: false, error: NO_CLI }
  }

  function history(rawId: unknown): ConsoleEvent[] {
    const id = ConversationId.safeParse(rawId)
    return ctx.demo() || !id.success ? [] : hub.history(id.data)
  }

  ctx.handle(IPC.consoleStart, (_e, raw) => start(raw))
  ctx.handle(IPC.consoleSend, (_e, id, text, mentions, images) => send(id, text, mentions, images))
  ctx.handle(IPC.consoleStop, (_e, id) => stop(id))
  ctx.handle(IPC.consoleList, (): ConsoleSummary[] => (ctx.demo() ? [] : hub.list()))
  ctx.handle(IPC.consoleHistory, (_e, id) => history(id))
  ctx.handle(IPC.consoleAllow, (_e, id, rule) => allow(id, rule))
  ctx.handle(IPC.consoleMcpList, (_e, cwd) => mcpList(cwd))
  ctx.handle(IPC.consoleMcpCancel, () => mcp.cancel())
  ctx.handle(IPC.consoleModels, () => modelList())

  return () => {
    mcp.cancel()
    models.cancel()
    hub.dispose()
  }
}
