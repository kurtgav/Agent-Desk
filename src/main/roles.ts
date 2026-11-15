import { homedir } from 'node:os'
import { join } from 'node:path'
import { dialog } from 'electron'
import { z } from 'zod'
import { IPC, type ActionResult } from '@shared/bridge'
import { toSummary } from '@shared/role-catalog'
import { parseFrontMatter } from '@shared/role-parse'
import { searchRoles, suggestRoles } from '@shared/role-search'
import {
  ROLE_ID, ROLE_PREVIEW_CHARS, ROLE_PROMPT_MAX, type CustomRoleInput, type RoleDetail, type RoleHit, type RoleRepoResult, type RoleSaveResult,
  type RoleSkillsResult, type RoleSource, type RoleSummary, type RolesCatalog, type RolesStatus
} from '@shared/roles'
import { LOCAL_PATH } from './actions'
import { readConfig, updateConfig } from './config'
import type { Dispose, MainCtx } from './ctx'
import { createScanner, type RepoSource, type Scan, type ScanPaths } from './roles-catalog'
import { copyName, deleteCustomRole, saveCustomRole } from './roles-custom'
import { readInside, realDir } from './roles-fs'
import { SKILLS_BATCH_MAX, installedSkillIds, removeSkill, writeSkill } from './roles-skills'

/**
 * Roles (D-158): the catalog of personas a conversation or task can take on. Main reads the files, the page gets summaries and a
 * short plain-text preview; a role's full text stays here until a conversation or task starts with that role. No network, no model.
 * Registers the `roles*` channels.
 */

/** Scans closer together than this share one result: the page, the palette and the composer all ask when they open. */
const FRESH_MS = 2_000
const PINNED_MAX = 200
const DEMO_REFUSED = 'Turn demo data off first.'

/** `out/main/index.js` -> the project root's `resources` (the same hop index.ts makes for icons). */
const BUILTIN_DIR = join(__dirname, '../../resources/roles')

const Id = z.string().regex(ROLE_ID)
const CustomInput = z.object({
  id: Id.nullish(),
  name: z.string().max(400),
  emoji: z.string().max(32),
  vibe: z.string().max(1_000).optional(),
  description: z.string().max(4_000),
  prompt: z.string().max(ROLE_PROMPT_MAX * 2)
})

/** The file name stem in a catalog key (`custom:release-notes.md`): not path.basename, which on Windows would read `custom:` as a drive. */
const stemOf = (key: string): string => key.slice(key.indexOf(':') + 1).split('/').pop()!.replace(/\.md$/i, '')

const configDir = (): string => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
/** Claude Code's skills folder: where a role installed as a skill goes. */
const skillsDir = (): string => join(configDir(), 'skills')
const SkillIds = z.array(Id).min(1).max(SKILLS_BATCH_MAX)

interface RolesConfig {
  repoPath: string | null
  pinned: string[]
}

function rolesConfig(file: string): RolesConfig {
  const raw = readConfig(file).roles
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return {
    repoPath: typeof r.repoPath === 'string' && r.repoPath.trim() ? r.repoPath : null,
    pinned: Array.isArray(r.pinned) ? r.pinned.filter((p): p is string => typeof p === 'string' && ROLE_ID.test(p)).slice(0, PINNED_MAX) : []
  }
}

/** The role file's text, or the front matter's absence: what a conversation is started with. */
export interface SpawnRole {
  id: string
  name: string
  emoji: string
  description: string
  source: RoleSource
  /** Set when Claude Code has this agent installed under this exact name: `claude --agent <agentName>` is enough. */
  agentName: string | null
  /** The role's text: everything after the front matter. */
  prompt: string
  /** The tools its front matter limits it to (`tools: Read, Write`); null = all. A file-defined role must pass these on, as an installed one has them. */
  tools: string[] | null
}

/** A tool name Claude Code knows (`Read`, `WebFetch`, `mcp__server__tool`): letters, digits, underscore and dot, never an option or a path. */
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/
const TOOLS_MAX = 40

/** `tools: Read, Write, Edit` as a list. Anything that is not a plain tool name is dropped; nothing left means "no limit". */
export function toolList(value: string | undefined): string[] | null {
  const list = (value ?? '').split(',').map((s) => s.trim()).filter((s) => TOOL_NAME.test(s)).slice(0, TOOLS_MAX)
  return list.length ? list : null
}

export interface RolesService {
  roleForSpawn(id: string): Promise<SpawnRole | null>
  /** The catalog entry of one role (its name and emoji, whether it is installed), or null when there is none. */
  summary(id: string): Promise<RoleSummary | null>
  /** Every role: what the Console checks a helper's name against, so a file-defined one never takes an installed agent's name. */
  list(): Promise<RoleSummary[]>
}

let service: RolesService | null = null
/** For the Console, the Composer and Tasks (main only): the full role by id. Null before `registerRoles` has run. */
export const roles = (): RolesService | null => service

export function registerRoles(ctx: MainCtx): Dispose {
  const scanner = createScanner()
  let current: Scan | null = null
  let running: Promise<Scan> | null = null
  /** Writes wait for each other, so two saves cannot pick the same file name. */
  let writes: Promise<unknown> = Promise.resolve()

  const paths = (repoOverride?: string): ScanPaths => {
    const cfg = rolesConfig(ctx.configFile())
    const chosen = repoOverride ?? cfg.repoPath
    const fromEnv = process.env.CLAUDE_CONFIG_DIR
    const repo: { path: string; source: RepoSource }[] = [
      ...(chosen ? [{ path: chosen, source: 'config' as const }] : []),
      ...(fromEnv ? [{ path: join(fromEnv, 'repos', 'agency-agents'), source: 'claude-config' as const }] : []),
      { path: join(homedir(), '.claude', 'repos', 'agency-agents'), source: 'default' as const }
    ]
    return {
      repo,
      configured: chosen,
      suggested: join(configDir(), 'repos', 'agency-agents'),
      installed: join(configDir(), 'agents'),
      custom: join(ctx.userData(), 'roles'),
      builtin: BUILTIN_DIR
    }
  }

  /** Merges into config.json's `roles`, keeping any key this version does not know. */
  const saveRoles = (patch: Partial<RolesConfig>): void => {
    const raw = readConfig(ctx.configFile()).roles
    updateConfig(ctx.configFile(), { roles: { ...(typeof raw === 'object' && raw !== null ? raw : {}), ...patch } })
  }

  const scan = (force = false): Promise<Scan> => {
    if (!force && current && Date.now() - current.status.scannedAt < FRESH_MS) return Promise.resolve(current)
    running ??= scanner
      .scan(paths())
      .then((s) => (current = s))
      .finally(() => {
        running = null
      })
    return running
  }

  /** The skills AgentDeck wrote, limited to roles the catalog still has. */
  const skillIds = async (s: Scan): Promise<string[]> => {
    const on = await installedSkillIds(skillsDir())
    return s.roles.filter((r) => on.has(r.id)).map((r) => r.id)
  }

  const catalog = async (s: Scan): Promise<RolesCatalog> => ({
    roles: s.roles.map(toSummary),
    divisions: s.divisions,
    pinned: rolesConfig(ctx.configFile()).pinned,
    skills: await skillIds(s),
    skillsPath: skillsDir(),
    status: s.status
  })

  /** The text after the front matter, read from inside the role's own root. */
  async function body(id: string, s: Scan): Promise<{ text: string; fields: Record<string, string>; role: Scan['roles'][number] } | null> {
    const role = s.roles.find((r) => r.id === id)
    const at = role && s.where.get(role.key)
    if (!role || !at) return null
    const text = await readInside(at.root, at.abs)
    const fm = text === null ? null : parseFrontMatter(text)
    return fm ? { text: fm.body.trim(), fields: fm.fields, role } : null
  }

  async function detail(id: string): Promise<RoleDetail | null> {
    const s = await scan()
    const got = await body(id, s)
    if (!got) return null
    const { role, text } = got
    const cut = text.length > ROLE_PREVIEW_CHARS
    const head = cut ? text.slice(0, ROLE_PREVIEW_CHARS) : text
    const lineEnd = cut ? head.lastIndexOf('\n') : -1
    return {
      ...toSummary(role),
      preview: cut && lineEnd > ROLE_PREVIEW_CHARS * 0.6 ? head.slice(0, lineEnd) : head,
      previewTruncated: cut,
      editable: role.source === 'custom',
      prompt: role.source === 'custom' ? text : null
    }
  }

  /** Runs a change to the custom folder alone, then rescans and answers with the role as it now is. */
  function change<T>(work: () => Promise<T>): Promise<T> {
    const next = writes.then(work, work)
    writes = next.catch(() => undefined)
    return next
  }

  async function save(input: CustomRoleInput): Promise<RoleSaveResult> {
    if (ctx.demo()) return { ok: false, error: DEMO_REFUSED }
    return change(async () => {
      const s = await scan(true)
      const editing = input.id ? s.roles.find((r) => r.id === input.id && r.source === 'custom') : undefined
      if (input.id && !editing) return { ok: false as const, error: 'That role no longer exists.' }
      const outcome = await saveCustomRole(input, {
        dir: paths().custom,
        editing: editing ? stemOf(editing.key) : null,
        otherIds: new Set(s.roles.filter((r) => r.id !== editing?.id).map((r) => r.id)),
        stems: new Set(s.roles.filter((r) => r.source === 'custom').map((r) => stemOf(r.key)))
      })
      if (!outcome.ok) return outcome
      const after = await scan(true)
      const saved = after.roles.find((r) => r.source === 'custom' && stemOf(r.key) === outcome.stem)
      if (!saved) return { ok: false as const, error: 'The role was saved but AgentDeck could not read it back.' }
      return { ok: true as const, role: toSummary(saved) }
    })
  }

  async function duplicate(id: string): Promise<RoleSaveResult> {
    if (ctx.demo()) return { ok: false, error: DEMO_REFUSED }
    const s = await scan(true)
    const got = await body(id, s)
    if (!got) return { ok: false, error: 'AgentDeck could not read that role.' }
    const names = new Set(s.roles.map((r) => r.name.toLowerCase()))
    const { role } = got
    return save({
      name: copyName(role.name, (n) => names.has(n.toLowerCase())),
      emoji: role.emoji,
      vibe: role.vibe,
      description: role.description.slice(0, 400),
      prompt: got.text
    })
  }

  async function remove(id: string): Promise<ActionResult> {
    if (ctx.demo()) return { ok: false, error: DEMO_REFUSED }
    return change(async () => {
      const s = await scan(true)
      const role = s.roles.find((r) => r.id === id)
      if (!role || role.source !== 'custom') return { ok: false as const, error: 'Only your own roles can be deleted.' }
      const r = await deleteCustomRole(paths().custom, stemOf(role.key))
      if (!r.ok) return r
      // Its pin goes with it.
      const cfg = rolesConfig(ctx.configFile())
      if (cfg.pinned.includes(id)) saveRoles({ pinned: cfg.pinned.filter((p) => p !== id) })
      await scan(true)
      return { ok: true as const }
    })
  }

  function setPinned(id: string, pinned: boolean): string[] {
    const cfg = rolesConfig(ctx.configFile())
    const next = pinned ? [...cfg.pinned.filter((p) => p !== id), id].slice(-PINNED_MAX) : cfg.pinned.filter((p) => p !== id)
    saveRoles({ pinned: next })
    return next
  }

  /** Points AgentDeck at a clone of agency-agents. Checked before it is saved: the folder must exist, be on a local drive and hold roles. */
  async function setRepo(path: string | null): Promise<RoleRepoResult> {
    if (ctx.demo()) return { ok: false, error: DEMO_REFUSED }
    if (path !== null) {
      if (!LOCAL_PATH.test(path)) return { ok: false, error: 'Use a folder on a local drive, like C:\\Users\\you\\agency-agents.' }
      const real = await realDir(path)
      if (!real) return { ok: false, error: 'That folder does not exist.' }
      const probe = await createScanner().scan({ ...paths(real), repo: [{ path: real, source: 'config' }] })
      if (probe.status.counts.agency === 0) {
        return { ok: false, error: 'No roles found there. Pick the folder that holds engineering, marketing and the other division folders.' }
      }
    }
    saveRoles({ repoPath: path })
    return { ok: true, catalog: await catalog(await scan(true)) }
  }

  /**
   * Installs or removes these roles as Claude Code skills, one after another through the same queue as the other writes. One
   * failure does not stop the rest; the answer counts them and names the first.
   */
  async function setSkills(ids: string[], on: boolean): Promise<RoleSkillsResult> {
    if (ctx.demo()) return { ok: false, skills: [], error: DEMO_REFUSED }
    return change(async () => {
      const s = await scan(true)
      const errors: string[] = []
      for (const id of new Set(ids)) {
        if (!on) {
          const r = await removeSkill(skillsDir(), id)
          if (!r.ok) errors.push(r.error)
          continue
        }
        const got = await body(id, s)
        const r = got ? await writeSkill(skillsDir(), got.role, got.text) : { ok: false as const, error: 'AgentDeck could not read that role.' }
        if (!r.ok) errors.push(r.error)
      }
      const skills = await skillIds(s)
      if (!errors.length) return { ok: true as const, skills }
      const more = errors.length > 1 ? ` (${errors.length} did not ${on ? 'install' : 'go'}.)` : ''
      return { ok: false as const, skills, error: `${errors[0]}${more}` }
    })
  }

  async function browse(): Promise<string | null> {
    const win = ctx.window()
    const options = { title: 'Choose the agency-agents folder', properties: ['openDirectory' as const] }
    const r = win && !win.isDestroyed() ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
  }

  ctx.handle(IPC.rolesList, async (): Promise<RolesCatalog> => catalog(await scan()))
  ctx.handle(IPC.rolesReload, async (): Promise<RolesCatalog> => catalog(await scan(true)))
  ctx.handle(IPC.rolesInstallSkills, (_e, ids) => setSkills(SkillIds.parse(ids), true))
  ctx.handle(IPC.rolesRemoveSkills, (_e, ids) => setSkills(SkillIds.parse(ids), false))
  ctx.handle(IPC.rolesStatus, async (): Promise<RolesStatus> => (await scan()).status)
  ctx.handle(IPC.rolesSearch, async (_e, query): Promise<RoleHit[]> => searchRoles((await scan()).roles, z.string().max(200).parse(query)))
  ctx.handle(IPC.rolesSuggest, async (_e, text, n): Promise<RoleHit[]> => suggestRoles((await scan()).roles, z.string().max(4_000).parse(text), z.number().int().min(1).max(10).parse(n)))
  ctx.handle(IPC.rolesGet, (_e, id) => detail(Id.parse(id)))
  ctx.handle(IPC.rolesSave, (_e, input) => save(CustomInput.parse(input)))
  ctx.handle(IPC.rolesDelete, (_e, id) => remove(Id.parse(id)))
  ctx.handle(IPC.rolesDuplicate, (_e, id) => duplicate(Id.parse(id)))
  ctx.handle(IPC.rolesSetPinned, (_e, id, pinned) => setPinned(Id.parse(id), z.boolean().parse(pinned)))
  ctx.handle(IPC.rolesSetRepo, (_e, path) => setRepo(z.string().min(1).max(500).nullable().parse(path)))
  ctx.handle(IPC.rolesBrowseRepo, browse)

  service = {
    async summary(id) {
      const r = (await scan()).roles.find((x) => x.id === id)
      return r ? toSummary(r) : null
    },
    async list() {
      return (await scan()).roles.map(toSummary)
    },
    async roleForSpawn(id) {
      const s = await scan()
      const got = await body(id, s)
      if (!got || Buffer.byteLength(got.text) > ROLE_PROMPT_MAX) return null
      const { role } = got
      return { id: role.id, name: role.name, emoji: role.emoji, description: role.description, source: role.source, agentName: role.agentName, prompt: got.text, tools: toolList(got.fields.tools) }
    }
  }
  return () => {
    service = null
  }
}
