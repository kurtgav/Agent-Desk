// Synthetic Claude Code transcript lines for the usage-log tests. Generated here, never copied from a real file; the shape
// (field names) is the one Claude Code writes, learned from the real logs read-only. Sentinel strings stand for content.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export const SENTINELS = [
  'SECRET_PROMPT_TEXT',
  'SECRET_REPLY_TEXT',
  'SECRET_TOOL_INPUT',
  'SECRET_TOOL_OUTPUT',
  'SECRET_FILE_CONTENTS',
  'SECRET_THINKING',
  'SECRET_CWD_PATH',
  'SECRET_BRANCH',
  'SECRET_SESSION_SLUG',
  'SECRET_EMAIL@example.com'
] as const

export interface Msg {
  id: string
  req?: string | null
  /** ms epoch */
  ts: number
  model?: string
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  cache1h?: number
  sidechain?: boolean
  speed?: string
}

/** One assistant line, full of content a reader must never keep. */
export function assistant(m: Msg): string {
  const write = m.cacheWrite ?? 0
  return JSON.stringify({
    parentUuid: 'p-1',
    isSidechain: m.sidechain ?? false,
    type: 'assistant',
    uuid: `u-${m.id}`,
    timestamp: new Date(m.ts).toISOString(),
    cwd: `C:\\${SENTINELS[6]}\\project`,
    gitBranch: SENTINELS[7],
    slug: SENTINELS[8],
    sessionId: 'session-1',
    requestId: m.req === null ? undefined : (m.req ?? `req_${m.id}`),
    message: {
      id: m.id,
      type: 'message',
      role: 'assistant',
      model: m.model ?? 'claude-sonnet-5-5',
      content: [
        { type: 'thinking', thinking: SENTINELS[5] },
        { type: 'text', text: `${SENTINELS[1]} ${SENTINELS[9]}` },
        { type: 'tool_use', id: 'tool-1', name: 'Write', input: { file_path: 'a.txt', content: `${SENTINELS[2]} ${SENTINELS[4]}` } }
      ],
      usage: {
        input_tokens: m.input ?? 10,
        output_tokens: m.output ?? 20,
        cache_read_input_tokens: m.cacheRead ?? 100,
        cache_creation_input_tokens: write,
        cache_creation: { ephemeral_5m_input_tokens: write - (m.cache1h ?? 0), ephemeral_1h_input_tokens: m.cache1h ?? 0 },
        service_tier: 'standard',
        inference_geo: 'global',
        speed: m.speed ?? 'standard'
      }
    }
  })
}

/** A user line (a prompt) and a tool result: no usage, full of content. */
export const userLine = (): string =>
  JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: `${SENTINELS[0]} usage` } })
export const toolResultLine = (): string =>
  JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: [{ type: 'tool_result', content: `${SENTINELS[3]} "usage"` }] } })

/** A temp `projects` folder with the given files (name → text). Returns its path; the caller removes the parent. */
export function projects(files: Record<string, string> = {}): { root: string; parent: string } {
  const parent = mkdtempSync(join(tmpdir(), 'agentdeck-ulog-'))
  const root = join(parent, 'projects')
  mkdirSync(root, { recursive: true })
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), text)
  }
  return { root, parent }
}

export const lines = (...l: string[]): string => `${l.join('\n')}\n`
