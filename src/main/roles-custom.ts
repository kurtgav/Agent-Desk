import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { checkCustomRole, cleanLine, slugify, type CustomRoleInput } from '@shared/roles'
import { removeFile, writeAtomic } from './roles-fs'

/**
 * The user's own roles: `<userData>/roles/<stem>.md`, in the same front matter format as every other role, so the file can be
 * edited by hand. A role's id comes from its file name, which never changes after it is created, so renaming a role keeps its pins.
 */

const STEM = /^[a-z0-9][a-z0-9-]{0,63}$/

/** The role as a file. JSON.stringify makes valid YAML double-quoted strings, escapes and all. */
export function serializeRole(input: CustomRoleInput): string {
  const vibe = cleanLine(input.vibe ?? '')
  const lines = [
    '---',
    `name: ${JSON.stringify(cleanLine(input.name))}`,
    `description: ${JSON.stringify(cleanLine(input.description))}`,
    `emoji: ${JSON.stringify(input.emoji.trim())}`,
    ...(vibe ? [`vibe: ${JSON.stringify(vibe)}`] : []),
    '---',
    '',
    input.prompt.trim().replace(/\r\n?/g, '\n'),
    ''
  ]
  return lines.join('\n')
}

export type SaveOutcome = { ok: true; stem: string } | { ok: false; error: string; field?: 'name' | 'emoji' | 'vibe' | 'description' | 'prompt' }

export interface SaveContext {
  dir: string
  /** The file stem of the role being edited, or null when creating. */
  editing: string | null
  /** The ids every other role in the catalog uses. A new name may not slug to one of them. */
  otherIds: ReadonlySet<string>
  /** Stems already used in `dir`. */
  stems: ReadonlySet<string>
}

/** Validates, picks the file name and writes it. The caller rescans afterwards. */
export async function saveCustomRole(input: CustomRoleInput, ctx: SaveContext): Promise<SaveOutcome> {
  const problem = checkCustomRole(input)[0]
  if (problem) return { ok: false, error: problem.message, field: problem.field }
  const name = cleanLine(input.name)
  const slug = slugify(name)
  const taken = ctx.otherIds.has(slug) || (ctx.editing === null ? ctx.stems.has(slug) : slug !== ctx.editing && ctx.stems.has(slug))
  if (taken) return { ok: false, error: `There is already a role called “${name}”. Pick another name, or edit that one.`, field: 'name' }
  const stem = ctx.editing ?? slug
  if (!STEM.test(stem)) return { ok: false, error: 'AgentDeck could not make a file name from that name. Use letters and numbers.', field: 'name' }
  try {
    await mkdir(ctx.dir, { recursive: true })
    await writeAtomic(join(ctx.dir, `${stem}.md`), serializeRole(input))
    return { ok: true, stem }
  } catch {
    return { ok: false, error: 'AgentDeck could not save the role. Check that its folder can be written to.' }
  }
}

export async function deleteCustomRole(dir: string, stem: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!STEM.test(stem)) return { ok: false, error: 'That is not a custom role.' }
  try {
    await removeFile(join(dir, `${stem}.md`))
    return { ok: true }
  } catch {
    return { ok: false, error: 'AgentDeck could not delete the role file.' }
  }
}

/** "Name (copy)", then "Name (copy 2)": the first that no role uses yet. Cut so the whole name still fits 60 characters. */
export function copyName(name: string, nameTaken: (candidate: string) => boolean, max = 60): string {
  const cut = (suffix: string): string => `${cleanLine(name).slice(0, max - suffix.length).trimEnd()}${suffix}`
  for (let n = 1; ; n++) {
    const candidate = cut(n === 1 ? ' (copy)' : ` (copy ${n})`)
    if (!nameTaken(candidate) || n > 99) return candidate
  }
}
