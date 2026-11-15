import type { ChildProcess } from 'node:child_process'
import spawn from 'cross-spawn'
import type { McpListResult, McpListed, McpStatus } from '@shared/console'
import { cap, maskSecrets } from '../collector/redact'
import { stripAnsi } from './actions'
import { killProcessTree, type ClaudeCommand } from './console-proc'

/**
 * `claude mcp list` (2.1.323): "Checking MCP server health…", a blank line, then one line per server,
 * `<name>: <command or url> - <✔ Connected | ! Needs authentication | ✘ Failed to connect — <reason>>`.
 * The command, URL, arguments and reason can carry secrets (tokens in a query string, env values, headers), so none of them is kept:
 * only the name and the status leave this file, and a line that does not look like that is dropped. If nothing is understood the
 * caller says so and shows nothing raw.
 */

const MAX_SERVERS = 100
const NAME_MAX = 100
const OUTPUT_MAX = 256 * 1024
export const MCP_LIST_TIMEOUT_MS = 20_000
export const MCP_LIST_CACHE_MS = 60_000

const STATUS_LINE = /^(.*) - ([✔✓✘✗!⚠⏸])\s*(.*)$/u
const hasControl = (s: string): boolean => [...s].some((c) => c.charCodeAt(0) < 32)
const SYMBOL: Record<string, McpStatus> = { '✔': 'connected', '✓': 'connected', '✘': 'failed', '✗': 'failed', '⏸': 'pending' }

function statusOf(symbol: string, words: string): McpStatus {
  if (symbol === '!' || symbol === '⚠') return /auth|sign|login/i.test(words) ? 'needs-auth' : 'failed'
  return SYMBOL[symbol] ?? 'unknown'
}

/** The servers in `claude mcp list` output, or null when the output is not in a shape we understand. */
export function parseMcpList(raw: string): McpListed[] | null {
  const text = stripAnsi(raw)
  if (/no mcp servers/i.test(text)) return []
  const servers: McpListed[] = []
  for (const line of text.split('\n')) {
    const row = line.trim()
    const at = row.indexOf(': ')
    if (at < 1) continue
    const status = STATUS_LINE.exec(row.slice(at + 2))
    if (!status) continue
    const name = row.slice(0, at).trim()
    // A name that is a URL, has an assignment in it, or changes when secrets are masked is not a name we show.
    if (name.length > NAME_MAX || /:\/\/|=/.test(name) || hasControl(name) || maskSecrets(name) !== name) continue
    servers.push({ name: cap(name, NAME_MAX), status: statusOf(status[2]!, status[3] ?? '') })
    if (servers.length >= MAX_SERVERS) break
  }
  return servers.length > 0 ? servers : null
}

const UNREADABLE = 'Could not read the list.'

/** One `claude mcp list` at a time, kept for a minute, stoppable. It does not call a model; it health-checks servers and can take many seconds. */
export class McpList {
  private cache = new Map<string, { at: number; servers: McpListed[] }>()
  private running: { key: string; child: ChildProcess; promise: Promise<McpListResult>; stop(): void } | null = null

  constructor(
    private readonly timeoutMs = MCP_LIST_TIMEOUT_MS,
    private readonly cacheMs = MCP_LIST_CACHE_MS,
    private readonly now: () => number = Date.now
  ) {}

  list(cmd: ClaudeCommand, cwd: string | null, env: NodeJS.ProcessEnv): Promise<McpListResult> {
    const key = cwd ?? ''
    const hit = this.cache.get(key)
    if (hit && this.now() - hit.at < this.cacheMs) return Promise.resolve({ ok: true, servers: hit.servers, at: hit.at, cached: true })
    if (this.running?.key === key) return this.running.promise
    this.cancel()
    return this.start(cmd, cwd, env, key)
  }

  /** Stops the check that is running, if any. */
  cancel(): void {
    this.running?.stop()
  }

  private start(cmd: ClaudeCommand, cwd: string | null, env: NodeJS.ProcessEnv, key: string): Promise<McpListResult> {
    let stopped: string | null = null
    let child: ChildProcess
    try {
      child = spawn(cmd.file, [...cmd.args, 'mcp', 'list'], { cwd: cwd ?? undefined, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      return Promise.resolve({ ok: false, error: 'AgentDeck could not start Claude Code.' })
    }
    let out = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (c: string) => {
      out = (out + c).slice(0, OUTPUT_MAX)
    })
    const timer = setTimeout(() => stop(`Claude Code did not finish checking in ${this.timeoutMs / 1000} s.`), this.timeoutMs)
    const stop = (why: string): void => {
      stopped ??= why
      killProcessTree(child)
    }
    const promise = new Promise<McpListResult>((resolve) => {
      const done = (r: McpListResult): void => {
        clearTimeout(timer)
        if (this.running?.child === child) this.running = null
        resolve(r)
      }
      child.on('error', () => done({ ok: false, error: 'AgentDeck could not start Claude Code.' }))
      child.on('close', (code) => {
        if (stopped) return done({ ok: false, error: stopped })
        if (code !== 0) return done({ ok: false, error: `Claude Code could not list its MCP servers (exit code ${code ?? 'none'}).` })
        const servers = parseMcpList(out)
        if (!servers) return done({ ok: false, error: UNREADABLE })
        const at = this.now()
        this.cache.set(key, { at, servers })
        done({ ok: true, servers, at, cached: false })
      })
    })
    this.running = { key, child, promise, stop: () => stop('Cancelled.') }
    return promise
  }
}
