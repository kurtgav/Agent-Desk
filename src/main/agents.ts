import { closeSync, openSync, readdirSync, readSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentDef } from '@shared/bridge'

/** Frontmatter sits at the top; 8 KB holds it for every definition on this machine (346 files). */
const HEAD_BYTES = 8 * 1024

function head(file: string): string {
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(HEAD_BYTES)
    return buf.subarray(0, readSync(fd, buf, 0, HEAD_BYTES, 0)).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

const unquote = (s: string): string => s.trim().replace(/^(['"])(.*)\1$/, '$2')

/**
 * `name`, `description` and `model` from a subagent file's YAML frontmatter (sub-agents § file format), read-only.
 * shortcut: one-line values only (a `>` or `|` block description reads as empty); use a YAML parser if one shows up.
 */
export function parseAgent(text: string, scope: AgentDef['scope']): AgentDef | null {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return null
  const field = (k: string): string | null => {
    const v = new RegExp(`^${k}:[ \\t]*(.*)$`, 'm').exec(m[1]!)?.[1]
    return v === undefined ? null : unquote(v)
  }
  const name = field('name')
  // Names are passed to `claude --agent`; anything that could read as an option or carry spaces is not offered.
  if (!name || !/^[A-Za-z0-9][\w.:-]{0,63}$/.test(name)) return null
  const description = field('description') ?? ''
  return { name, description: /^[>|]/.test(description) ? '' : description.slice(0, 300), model: field('model'), scope }
}

/** Every definition in one agents folder; a missing folder or an unreadable file is skipped. */
export function readAgents(dir: string, scope: AgentDef['scope']): AgentDef[] {
  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md'))
  } catch {
    return []
  }
  return files.flatMap((f) => {
    try {
      return parseAgent(head(join(dir, f)), scope) ?? []
    } catch {
      return []
    }
  })
}

/** Project definitions win over user ones of the same name (sub-agents § scope priority), sorted by name. */
export function agentList(userDir: string, projectDir: string | null): AgentDef[] {
  const byName = new Map<string, AgentDef>()
  for (const a of readAgents(userDir, 'user')) byName.set(a.name, a)
  if (projectDir) for (const a of readAgents(projectDir, 'project')) byName.set(a.name, a)
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}
