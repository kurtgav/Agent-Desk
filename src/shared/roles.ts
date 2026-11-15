/**
 * Roles: a catalog of personas a conversation or task can take on (CTO, Frontend Developer, SEO Specialist...). Everything here is
 * local files read by main (ADR-0009): the user's clone of msitarzewski/agency-agents (MIT), the agents installed in Claude Code,
 * the user's own roles, and the few that ship with AgentDeck. Nothing is fetched and no model is called to build or search it.
 */

export const ROLE_SOURCES = ['agency', 'installed', 'custom', 'builtin'] as const
export type RoleSource = (typeof ROLE_SOURCES)[number]

export const SOURCE_LABEL: Record<RoleSource, string> = { agency: 'Agency', installed: 'Installed', custom: 'Custom', builtin: 'Built-in' }

/** The three divisions AgentDeck makes up; every other id is a folder name of the clone. */
export const LEADERSHIP_DIVISION = 'leadership'
export const CUSTOM_DIVISION = 'custom'
/** Installed agents that are not in the clone ("Your agents"). */
export const YOURS_DIVISION = 'yours'

/** Limits (D-158). The prompt cap is the same for a role file read from disk and a custom role typed in. */
export const ROLE_NAME_MAX = 60
export const ROLE_DESCRIPTION_MAX = 400
export const ROLE_VIBE_MAX = 140
export const ROLE_PROMPT_MAX = 64 * 1024
/** The detail panel shows this much of the prompt, as plain text. */
export const ROLE_PREVIEW_CHARS = 4_096
/** A role id: lowercase letters, digits and hyphens, never a path. */
export const ROLE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/
/** The command the empty state shows. AgentDeck itself never runs it. */
export const REPO_CLONE_COMMAND = 'git clone https://github.com/msitarzewski/agency-agents.git'

export interface RoleSummary {
  /** A stable slug. Pins and the role chosen for a task are saved by it. */
  id: string
  name: string
  /** A division id: a folder of the clone, or `leadership`, `custom`, `yours`. */
  division: string
  divisionLabel: string
  emoji: string
  /** The division's colour (#rrggbb): the card tints its emoji tile with it. */
  color: string
  /** One line in the role's own voice. */
  vibe: string
  description: string
  source: RoleSource
  /** An agent with this name is in Claude Code's agents folder, so `claude --agent` can use it as it is. Always false for custom and built-in roles. */
  installed: boolean
  /** The exact name for `claude --agent`: set only when `installed` and the name is safe to put on a command line. */
  agentName: string | null
  /** Length of the role's text (everything after the front matter). */
  promptChars: number
}

export interface RoleDivision {
  id: string
  label: string
  /** A Lucide icon name (PascalCase), mapped to a component by the page; unknown names get a fallback. */
  icon: string
  color: string
  count: number
}

export interface RoleCounts {
  /** Roles read from the clone. */
  agency: number
  /** Installed agents the clone does not have ("Your agents"). */
  installed: number
  /** Roles of any source that are installed in Claude Code. */
  installedFlagged: number
  custom: number
  builtin: number
  total: number
  /** Files that named a role already listed (the clone can have two of one name); one of each pair is hidden. */
  duplicates: number
  /** Files that were unreadable, too large or had no name. */
  skipped: number
}

export interface RolesStatus {
  /** The clone in use, or null when none was found. */
  repoPath: string | null
  repoFound: boolean
  /** `config` is the folder the user pointed at; `claude-config` is `CLAUDE_CONFIG_DIR/repos/agency-agents`; `default` is `~/.claude/repos/agency-agents`. */
  repoSource: 'config' | 'claude-config' | 'default' | null
  /** What the user saved, if anything, and whether it exists. */
  configuredPath: string | null
  configuredMissing: boolean
  /** Where `git clone` is suggested to put it. */
  suggestedPath: string
  installedPath: string
  installedFound: boolean
  customPath: string
  counts: RoleCounts
  scannedAt: number
  durationMs: number
}

export interface RolesCatalog {
  roles: RoleSummary[]
  /** Leadership first, then the clone's divisions by label, then Custom and Your agents. */
  divisions: RoleDivision[]
  pinned: string[]
  /** Ids of the roles AgentDeck has written as Claude Code skills (`<skillsPath>/agency-<id>/SKILL.md`). */
  skills: string[]
  /** Claude Code's skills folder. */
  skillsPath: string
  status: RolesStatus
}

/** A role's Claude Code skill folder: `frontend-developer` → `agency-frontend-developer`, cut to Claude Code's 64-character name limit. */
export function skillName(roleId: string): string {
  return `agency-${roleId}`.slice(0, 64).replace(/-+$/, '')
}

/** After installing or removing skills: the ids installed now, and why any of them failed. */
export type RoleSkillsResult = { ok: true; skills: string[] } | { ok: false; skills: string[]; error: string }

export interface RoleDetail extends RoleSummary {
  /** The first ROLE_PREVIEW_CHARS of the role's text. Plain text: the page never renders it as HTML. */
  preview: string
  previewTruncated: boolean
  /** Only custom roles can be edited or deleted; the rest are duplicated first. */
  editable: boolean
  /** Custom roles only: the text to edit. */
  prompt: string | null
}

export interface RoleHit {
  id: string
  score: number
  /** The words of the query that found it, for "matched: database, queries". */
  matched: string[]
}

export interface CustomRoleInput {
  /** Absent when creating. The id of an existing custom role when saving over it. */
  id?: string | null
  name: string
  emoji: string
  vibe?: string
  description: string
  prompt: string
}

export type RoleField = 'name' | 'emoji' | 'vibe' | 'description' | 'prompt'
export type RoleSaveResult = { ok: true; role: RoleSummary } | { ok: false; error: string; field?: RoleField }
export type RoleRepoResult = { ok: true; catalog: RolesCatalog } | { ok: false; error: string }

/** URL-safe, ASCII, and never a path: `Frontend Developer` becomes `frontend-developer`. */
export function slugify(text: string): string {
  const s = text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '')
  return s || 'role'
}

/** Control, bidi and zero-width characters: they can reorder or hide text in a name. Joiners stay: emoji sequences need them. */
const INVISIBLE = /(?!\p{Join_Control})[\p{Cc}\p{Cf}]/gu

/** One line of text for a name, vibe or description: invisibles removed, whitespace collapsed. */
export function cleanLine(text: string): string {
  return text.replace(/\s+/g, ' ').replace(INVISIBLE, '').trim()
}

/**
 * A name that is safe to give `claude --agent` as it is: it starts with a letter or digit (so it can never read as an option) and
 * carries nothing a command interpreter acts on (quotes, `%`, `^`, `!`, `<`, `>`, `|`, `` ` ``, `$`, `;`, `\`).
 */
export function isSafeAgentName(name: string): boolean {
  return /^[\p{L}\p{N}][\p{L}\p{N} _.:,&()+/'’-]{0,79}$/u.test(name) && name === cleanLine(name)
}

/** A first grapheme that is a picture (emoji, a flag), one or two of them. */
export function isEmojiLike(text: string): boolean {
  const t = text.trim()
  if (!t || t.length > 16) return false
  const graphemes = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(t)]
  return graphemes.length <= 2 && graphemes.every((g) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(g.segment))
}

export interface RoleProblem {
  field: RoleField
  message: string
}

/**
 * The checks a custom role passes before it is saved. The form runs them live; main runs the same ones again and is the authority.
 * Messages say what to change, in the voice of the rest of the app.
 */
export function checkCustomRole(input: CustomRoleInput): RoleProblem[] {
  const out: RoleProblem[] = []
  const name = cleanLine(input.name)
  if (!name) out.push({ field: 'name', message: 'Give the role a name.' })
  else if (name.length > ROLE_NAME_MAX) out.push({ field: 'name', message: `Keep the name to ${ROLE_NAME_MAX} characters.` })
  if (!isEmojiLike(input.emoji)) out.push({ field: 'emoji', message: 'Pick an emoji for the card.' })
  if ((input.vibe ?? '').length > ROLE_VIBE_MAX) out.push({ field: 'vibe', message: `Keep the one-liner to ${ROLE_VIBE_MAX} characters.` })
  const description = cleanLine(input.description)
  if (!description) out.push({ field: 'description', message: 'Say in a sentence what this role is for.' })
  else if (description.length > ROLE_DESCRIPTION_MAX) out.push({ field: 'description', message: `Keep the description to ${ROLE_DESCRIPTION_MAX} characters.` })
  const prompt = input.prompt.trim()
  if (!prompt) out.push({ field: 'prompt', message: 'Write the role: who it is, what it does, how it works.' })
  else if (new TextEncoder().encode(prompt).length > ROLE_PROMPT_MAX) out.push({ field: 'prompt', message: 'The role text is over 64 KB. Shorten it.' })
  return out
}
