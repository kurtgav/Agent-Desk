import { mkdir, readdir, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ActionResult } from '@shared/bridge'
import { cleanLine, ROLE_ID, skillName } from '@shared/roles'
import { readCapped, readHead, removeFile, writeAtomic } from './roles-fs'

/**
 * A role as a Claude Code skill: `<CLAUDE_CONFIG_DIR or ~/.claude>/skills/agency-<role id>/SKILL.md`, the agency-agents
 * `skill-md` layout. Written only when the user asks, one role or one division at a time (each installed skill's description is
 * loaded into every Claude Code session, so installing all of them is never the default). AgentDeck marks what it writes and only
 * ever replaces or removes a SKILL.md that carries its mark, so a skill you made by hand under the same name is left alone.
 */

/** Every folder `skillName` makes starts with this. */
export const SKILL_PREFIX = 'agency-'
/** The line every SKILL.md AgentDeck writes carries, right after the front matter. */
export const SKILL_MARK = '<!-- agentdeck:role-skill -->'
/** Claude Code's limit for a skill's description. */
const SKILL_DESCRIPTION_MAX = 1_024
/** Installs per call: the biggest division is well under this. */
export const SKILLS_BATCH_MAX = 400

export interface SkillRole {
  id: string
  name: string
  description: string
  vibe: string
}

/** The SKILL.md text: front matter Claude Code reads (name, description), the mark, then the role's own text. */
export function skillMarkdown(role: SkillRole, text: string): string {
  const what = cleanLine(role.description) || cleanLine(role.vibe) || cleanLine(role.name)
  const when = ` Use when the task calls for a ${cleanLine(role.name)}.`
  const description = `${what.slice(0, SKILL_DESCRIPTION_MAX - when.length).trimEnd()}${when}`
  return [
    '---',
    `name: ${skillName(role.id)}`,
    // JSON.stringify makes a valid YAML double-quoted string, escapes and all.
    `description: ${JSON.stringify(description)}`,
    '---',
    '',
    SKILL_MARK,
    `<!-- Written by AgentDeck from the role "${cleanLine(role.name).replace(/--/g, '-')}". Remove it from AgentDeck's Agents page. -->`,
    '',
    text.trim().replace(/\r\n?/g, '\n'),
    ''
  ].join('\n')
}

const ours = (text: string | null | undefined): boolean => !!text && text.includes(SKILL_MARK)

/** The role ids that have an AgentDeck-written skill in `root`. A missing folder is an empty set. */
export async function installedSkillIds(root: string): Promise<Set<string>> {
  let names: string[]
  try {
    names = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory() && d.name.startsWith(SKILL_PREFIX)).map((d) => d.name)
  } catch {
    return new Set()
  }
  const heads = await Promise.all(names.map(async (n) => [n, await readHead(join(root, n, 'SKILL.md'))] as const))
  return new Set(heads.filter(([, h]) => ours(h?.text)).map(([n]) => n.slice(SKILL_PREFIX.length)))
}

/** Writes one role's skill. Refuses to replace a SKILL.md AgentDeck did not write. */
export async function writeSkill(root: string, role: SkillRole, text: string): Promise<ActionResult> {
  if (!ROLE_ID.test(role.id)) return { ok: false, error: 'That role cannot be a skill.' }
  if (!text.trim()) return { ok: false, error: `“${role.name}” has no text to install.` }
  const dir = join(root, skillName(role.id))
  const file = join(dir, 'SKILL.md')
  const existing = await readHead(file)
  if (existing && !ours(existing.text)) return { ok: false, error: `A skill named ${skillName(role.id)} is already there and AgentDeck did not write it, so it was left alone.` }
  try {
    await mkdir(dir, { recursive: true })
    await writeAtomic(file, skillMarkdown(role, text))
    return { ok: true }
  } catch {
    return { ok: false, error: `AgentDeck could not write ${file}.` }
  }
}

/** Removes one role's skill, and its folder when nothing else is in it. Only a SKILL.md with AgentDeck's mark is removed. */
export async function removeSkill(root: string, roleId: string): Promise<ActionResult> {
  if (!ROLE_ID.test(roleId)) return { ok: false, error: 'That role has no skill.' }
  const dir = join(root, skillName(roleId))
  const file = join(dir, 'SKILL.md')
  const text = await readCapped(file, 1024 * 1024)
  if (text === null) return { ok: true } // already gone
  if (!ours(text)) return { ok: false, error: `AgentDeck did not write ${file}, so it was left alone.` }
  try {
    await removeFile(file)
    await rmdir(dir).catch(() => undefined) // something else is in it: keep the folder
    return { ok: true }
  } catch {
    return { ok: false, error: `AgentDeck could not remove ${file}.` }
  }
}
