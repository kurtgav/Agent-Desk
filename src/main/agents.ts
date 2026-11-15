import { open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentDef } from '@shared/bridge'

/** Frontmatter sits at the top; 8 KB holds it for every definition on this machine (346 files). */
const HEAD_BYTES = 8 * 1024

/** Async: main runs the window, and 346 sync reads would stall it each time a picker opens. */
async function head(file: string): Promise<string> {
  const fh = await open(file, 'r')
  try {
    const buf = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0)
    return buf.subarray(0, bytesRead).toString('utf8')
  } finally {
    await fh.close()
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
export async function readAgents(dir: string, scope: AgentDef['scope']): Promise<AgentDef[]> {
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith('.md'))
  } catch {
    return []
  }
  const read = await Promise.all(files.map((f) => head(join(dir, f)).then((t) => parseAgent(t, scope), () => null)))
  return read.filter((a): a is AgentDef => a !== null)
}

/** Project definitions win over user ones of the same name (sub-agents § scope priority), sorted by name. */
export async function agentList(userDir: string, projectDir: string | null): Promise<AgentDef[]> {
  const [user, project] = await Promise.all([readAgents(userDir, 'user'), projectDir ? readAgents(projectDir, 'project') : []])
  const byName = new Map<string, AgentDef>()
  for (const a of [...user, ...project]) byName.set(a.name, a)
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}
