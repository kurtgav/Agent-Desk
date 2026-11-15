import type { ChildProcess } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import spawn from 'cross-spawn'
import type { ModelInfo, ModelListResult } from '@shared/console'
import { cap, maskSecrets } from '../collector/redact'
import { arr, isRec, str } from './console-text'
import { killProcessTree, type ClaudeCommand } from './console-proc'

/**
 * The models Claude Code offers this account, exactly as its own picker lists them: the `models` of the `initialize` control
 * response (2.1.325: [{value, resolvedModel, displayName, description, supportsEffort, supportedEffortLevels}]). One short
 * `claude -p` that is never sent a prompt, so no model runs; hooks are off for it (`disableAllHooks`), so it never shows up as a
 * session. It runs in AgentDeck's own folder (never a shared temp folder, whose project settings or CLAUDE.md anyone could plant), and
 * the no-hooks setting goes in as a file there, which survives the claude.cmd wrapper's quoting. Only the listed fields leave this
 * file, masked and clipped.
 */

export const MODELS_TIMEOUT_MS = 20_000
export const MODELS_CACHE_MS = 10 * 60_000
const MODELS_MAX = 60
const OUTPUT_MAX = 512 * 1024
const REQUEST_ID = 'agentdeck-models'
const VALUE = /^[A-Za-z0-9][A-Za-z0-9._[\]-]{0,63}$/

const clip = (s: string, max: number): string => cap(maskSecrets(s.trim().replace(/\s+/g, ' ')), max)

/** The models in one stdout line, or null when the line is not our initialize answer. */
export function parseModels(line: string): ModelInfo[] | null {
  let m: unknown
  try {
    m = JSON.parse(line)
  } catch {
    return null
  }
  if (!isRec(m) || m.type !== 'control_response' || !isRec(m.response) || str(m.response.request_id) !== REQUEST_ID) return null
  const body = isRec(m.response.response) ? m.response.response : {}
  return arr(body.models)
    .filter(isRec)
    .filter((x) => VALUE.test(str(x.value)))
    .slice(0, MODELS_MAX)
    .map((x) => ({
      value: str(x.value),
      label: clip(str(x.displayName) || str(x.value), 60),
      description: clip(str(x.description), 120),
      efforts: x.supportsEffort === true ? arr(x.supportedEffortLevels).map(str).filter((e) => /^[a-z]{1,12}$/.test(e)) : []
    }))
}

const FAILED = 'AgentDeck could not read the model list from Claude Code.'

/** One read at a time, kept ten minutes (the list changes with the CLI version or the account, not by the minute). */
export class ModelList {
  private cache: { at: number; models: ModelInfo[] } | null = null
  private running: Promise<ModelListResult> | null = null
  private child: ChildProcess | null = null

  constructor(
    private readonly timeoutMs = MODELS_TIMEOUT_MS,
    private readonly cacheMs = MODELS_CACHE_MS,
    private readonly now: () => number = Date.now
  ) {}

  /** `dir`: a folder only AgentDeck writes to; the read runs there. */
  list(cmd: ClaudeCommand, env: NodeJS.ProcessEnv, dir: string): Promise<ModelListResult> {
    if (this.cache && this.now() - this.cache.at < this.cacheMs) return Promise.resolve({ ok: true, models: this.cache.models, at: this.cache.at })
    this.running ??= this.read(cmd, env, dir).finally(() => {
      this.running = null
    })
    return this.running
  }

  /** Stops a read that is running (at shutdown). */
  cancel(): void {
    if (this.child) killProcessTree(this.child)
  }

  private async read(cmd: ClaudeCommand, env: NodeJS.ProcessEnv, dir: string): Promise<ModelListResult> {
    const settings = join(dir, 'no-hooks.json')
    let child: ChildProcess
    try {
      await mkdir(dir, { recursive: true })
      await writeFile(settings, JSON.stringify({ disableAllHooks: true }))
      const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--settings', settings]
      child = spawn(cmd.file, [...cmd.args, ...args], { cwd: dir, env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
    } catch {
      return { ok: false, error: 'AgentDeck could not start Claude Code.' }
    }
    this.child = child
    return new Promise<ModelListResult>((resolve) => {
      let out = ''
      let settled = false
      const done = (r: ModelListResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        killProcessTree(child)
        if (this.child === child) this.child = null
        resolve(r)
      }
      const timer = setTimeout(() => done({ ok: false, error: `Claude Code did not answer in ${this.timeoutMs / 1000} s.` }), this.timeoutMs)
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (c: string) => {
        out = (out + c).slice(-OUTPUT_MAX)
        const lines = out.split('\n')
        out = lines.pop() ?? ''
        for (const line of lines) {
          const models = parseModels(line)
          if (!models) continue
          if (models.length === 0) return done({ ok: false, error: FAILED })
          const at = this.now()
          this.cache = { at, models }
          return done({ ok: true, models, at })
        }
      })
      child.on('error', () => done({ ok: false, error: 'AgentDeck could not start Claude Code.' }))
      child.on('close', () => done({ ok: false, error: FAILED }))
      child.stdin?.on('error', () => undefined)
      child.stdin?.write(`${JSON.stringify({ type: 'control_request', request_id: REQUEST_ID, request: { subtype: 'initialize' } })}\n`)
    })
  }
}
