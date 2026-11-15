import { randomUUID } from 'node:crypto'
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HELPERS_MAX, type RoleRef } from '@shared/console'
import { cleanLine, isSafeAgentName, type RoleSummary } from '@shared/roles'
import type { RolesService, SpawnRole } from './roles'

/**
 * Starting a conversation as a role (`claude -p ... --agents <file> --agent <id>`), and addressing a role in a later message.
 * Everything here was checked against Claude Code 2.1.323 (D-159):
 * - `--agent` matches an agent's front matter `name`. A name Claude Code does not have is NOT an error: it silently runs as a bare
 *   agent. So `--agent <name>` is passed only for a name main read from an installed file, and a role Claude Code does not have is
 *   handed over as a definition (`--agents <file>`, key = the role id) and `--agent <id>`.
 * - The definition file may hold any number of definitions with `description`, `prompt` and `tools`; it is read once, at start.
 * - A definition given through the `initialize` control request counts only the first time, so a later message cannot add one.
 * No UI, no Electron: console.ts calls this with what the window sent, after zod.
 */

/** The definitions' text in one start: the lead and four helpers can each be 64 KB; this keeps a start sane and far under any limit seen. */
export const DEFINITIONS_MAX_BYTES = 256 * 1024
/** A role named in a later message that Claude Code was not given at start is described inline; past this it is refused. */
export const INLINE_ROLE_MAX_BYTES = 24 * 1024
const DESCRIPTION_MAX = 400
const TMP_FILE = /^roles-[0-9a-f-]{36}\.json$/
/** Names that are safe on cmd.exe's command line (an npm `claude.cmd` shim): no `&`, `(`, `)`, `+`, `'` or `/`. */
export const SHIM_SAFE = /^[\w .:-]+$/

export const DELEGATION_TOOL = 'Agent'

export interface Definition {
  description: string
  prompt: string
  tools?: string[]
}

export interface HelperRef extends RoleRef {
  /** What the lead calls it: the exact name of an installed agent, or the key the definition went in under. */
  subagent: string
}

export interface RolePlan {
  lead: RoleRef | null
  helpers: HelperRef[]
  /** Added to the `claude` command line after the usual flags. */
  args: string[]
  /** The definitions file written for this start; main deletes it when the process has read it, and again when it exits. */
  file: string | null
  /** Appended to the opening message so the lead knows who it can ask. Null with no helpers. */
  opening: string | null
  /** The name Claude Code must list among its agents once it is up, or the role did not take (checked after `init`). */
  expect: string | null
}

export const NO_ROLE: RolePlan = { lead: null, helpers: [], args: [], file: null, opening: null, expect: null }

export type PlanResult = { ok: true; plan: RolePlan } | { ok: false; error: string }

const ref = (r: { id: string; name: string; emoji: string }): RoleRef => ({ id: r.id, name: r.name, emoji: r.emoji })
const missing = (id: string): string => `AgentDeck does not have the role “${id}” any more. Reload the roles and pick it again.`
export const definition = (r: SpawnRole, extraTools: string[] = []): Definition => ({
  description: cleanLine(r.description).slice(0, DESCRIPTION_MAX) || r.name,
  prompt: r.prompt,
  ...(r.tools ? { tools: [...new Set([...r.tools, ...extraTools])] } : {})
})

/** The line that tells the lead who it can ask. Plain and factual: it asks for nothing the user did not choose. */
export const helperLine = (helpers: readonly { subagent: string }[]): string => `Available to consult: ${helpers.map((h) => h.subagent).join(', ')}. Use them when their expertise applies.`

/** `a`, `a and b`, `a, b and c`. */
const andList = (xs: string[]): string => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)

/**
 * Works out how to start a conversation as `req.role` with `req.helpers` available. Nothing is trusted from the window: every id is
 * looked up in the catalog, and the text comes from the files main read.
 */
export async function planRole(
  req: { role?: string | null; helpers?: readonly string[] },
  deps: { roles: RolesService | null; tmpDir: string; viaCmd: boolean }
): Promise<PlanResult> {
  const helperIds = [...new Set(req.helpers ?? [])].filter((h) => h !== req.role)
  if (!req.role) return helperIds.length ? { ok: false, error: 'Pick a lead role first: helpers answer to it.' } : { ok: true, plan: NO_ROLE }
  if (helperIds.length > HELPERS_MAX) return { ok: false, error: `A conversation can have up to ${HELPERS_MAX} helper roles.` }
  if (!deps.roles) return { ok: false, error: 'AgentDeck is still reading its roles. Try again in a moment.' }
  const lead = await deps.roles.roleForSpawn(req.role)
  if (!lead) return { ok: false, error: missing(req.role) }
  const helpers: SpawnRole[] = []
  for (const id of helperIds) {
    const h = await deps.roles.roleForSpawn(id)
    if (!h) return { ok: false, error: missing(id) }
    helpers.push(h)
  }

  const defs: Record<string, Definition> = {}
  const taken = new Set((await deps.roles.list()).flatMap((r: RoleSummary) => (r.installed && r.agentName ? [r.agentName] : [])))
  // Delegating needs the Agent tool. A lead that is limited to a few tools gets it added, which only a definition can do.
  const needsAgentTool = helpers.length > 0 && lead.tools !== null && !lead.tools.some((t) => t === DELEGATION_TOOL || t === 'Task')
  const nameOk = (n: string): boolean => (deps.viaCmd ? SHIM_SAFE.test(n) : true)
  const installedLead = lead.agentName !== null && nameOk(lead.agentName) && !needsAgentTool
  const leadName = installedLead ? lead.agentName! : lead.id
  if (!installedLead) defs[lead.id] = definition(lead, helpers.length ? [DELEGATION_TOOL] : [])
  taken.add(leadName)

  const refs: HelperRef[] = []
  for (const h of helpers) {
    // Installed under a safe name: Claude Code lists it as a subagent already (checked), so it needs no definition.
    if (h.agentName !== null && !defs[h.agentName]) {
      refs.push({ ...ref(h), subagent: h.agentName })
      continue
    }
    const key = isSafeAgentName(h.name) && !taken.has(h.name) && !(h.name in defs) ? h.name : h.id
    if (taken.has(key) || key in defs) return { ok: false, error: `Two of these roles would answer to the name “${key}”. Pick one of them.` }
    defs[key] = definition(h)
    taken.add(key)
    refs.push({ ...ref(h), subagent: key })
  }

  const args: string[] = []
  let file: string | null = null
  if (Object.keys(defs).length) {
    const json = JSON.stringify(defs)
    if (Buffer.byteLength(json) > DEFINITIONS_MAX_BYTES) return { ok: false, error: 'These roles are too long to start together (over 256 KB of role text). Take one away.' }
    file = join(deps.tmpDir, `roles-${randomUUID()}.json`)
    try {
      await mkdir(deps.tmpDir, { recursive: true })
      await writeFile(file, json, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    } catch {
      return { ok: false, error: 'AgentDeck could not write the role to its temporary folder.' }
    }
    args.push('--agents', file)
  }
  args.push('--agent', leadName)
  return { ok: true, plan: { lead: ref(lead), helpers: refs, args, file, opening: refs.length ? helperLine(refs) : null, expect: leadName } }
}

export async function removeRoleFile(file: string | null): Promise<void> {
  if (file) await unlink(file).catch(() => undefined)
}

/** At startup no conversation is running, so every definitions file left in the folder (a crash, a kill) is stale. */
export async function sweepRoleFiles(tmpDir: string): Promise<number> {
  let n = 0
  for (const name of await readdir(tmpDir).catch(() => [] as string[])) {
    if (TMP_FILE.test(name) && (await unlink(join(tmpDir, name)).then(() => true, () => false))) n++
  }
  return n
}

/** Someone a later message names: an agent Claude Code can call by name, or a role described in the message itself. */
export type MentionTarget = { kind: 'named'; name: string; subagent: string } | { kind: 'inline'; name: string; text: string }

/**
 * What Claude Code is sent for a message that names roles. The user's words come right after "for this:", unchanged. Verified on
 * 2.1.323 with `--model haiku`: "Use the <name> subagent for this: <text>" makes the lead call the Agent tool with that subagent
 * type. A role Claude Code was not given at start cannot be added to a running session, so it is described in the message and played
 * by a general-purpose subagent.
 */
export function mentionPrompt(text: string, targets: readonly MentionTarget[]): string {
  const named = targets.filter((t): t is Extract<MentionTarget, { kind: 'named' }> => t.kind === 'named')
  const inline = targets.filter((t): t is Extract<MentionTarget, { kind: 'inline' }> => t.kind === 'inline')
  const parts: string[] = []
  if (named.length) parts.push(`Use ${andList(named.map((t) => `the ${t.subagent} subagent`))} for this: ${text}`)
  if (inline.length) {
    const who = andList(inline.map((t) => `the ${t.name}`))
    parts.push(
      named.length
        ? `Also use a general-purpose subagent for each of these roles, briefed with the role text below, on the same request: ${andList(inline.map((t) => t.name))}.`
        : `Use a general-purpose subagent for this, briefed as ${who} with the role text below: ${text}`
    )
    for (const t of inline) parts.push(`Role of the ${t.name}:\n${t.text}`)
  }
  return parts.join('\n\n')
}
