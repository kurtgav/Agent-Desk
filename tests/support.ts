import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, test, type ElectronApplication, type Page } from '@playwright/test'
import { fixture } from '../src/collector/fixtures'
import type { AgentDeckBridge } from '../src/shared/bridge'
import type { TaskResult, WorkTask } from '../src/shared/work'

/** What the work-live, uninstall and packaged specs share: an isolated profile, the collector's endpoint, hook posts, the bridge. */

export const MAIN = 'out/main/index.js'

/** A throwaway profile folder. It is also CLAUDE_CONFIG_DIR, so nothing here can reach the real `~/.claude`. */
export const tempDir = (prefix: string): string => mkdtempSync(join(tmpdir(), `agentdeck-${prefix}-`))

export const removeDir = (dir: string): void => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })

/**
 * This machine runs inside Claude Code; none of its CLAUDE* vars may leak into the app. The app runs live but must not
 * poll the real sessions (AGENTDECK_POLL=0), and its Claude config dir is the temp profile.
 */
export function isolatedEnv(userData: string, configDir = userData): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('CLAUDE')) env[k] = v
  return { ...env, AGENTDECK_USER_DATA: userData, AGENTDECK_POLL: '0', AGENTDECK_THEME: 'light', CLAUDE_CONFIG_DIR: configDir }
}

/** Apps started by a spec, closed (and their profiles removed) by `cleanup`. */
const started: ElectronApplication[] = []
const profiles: string[] = []

export interface Launched {
  app: ElectronApplication
  page: Page
  /** Console errors and warnings, and uncaught page errors, since launch. */
  errors: string[]
}

export interface LaunchOptions {
  /** `out/main/index.js` for the dev build; an executable path launches the packaged app. */
  executablePath?: string
  /** The main script to start, when it is not `out/main/index.js` (a wrapper that loads it). */
  main?: string
  /** Extra command-line arguments after the entry script. */
  args?: string[]
  /** Extra environment for the app, on top of the isolated one. */
  env?: Record<string, string>
}

/** Starts the app on `userData` and waits for its window. Live mode needs `collectorReady` too. */
export async function launch(userData: string, opts: LaunchOptions = {}): Promise<Launched> {
  const extra = opts.args ?? []
  const app = await electron.launch({
    ...(opts.executablePath ? { executablePath: opts.executablePath, args: extra } : { args: [opts.main ?? MAIN, ...extra] }),
    env: { ...isolatedEnv(userData), ...opts.env }
  })
  started.push(app)
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!
    w.unmaximize()
    w.setSize(1440, 924)
    w.center()
  })
  return { app, page, errors }
}

/** A profile folder that `cleanup` removes. */
export function profile(prefix: string): string {
  const dir = tempDir(prefix)
  profiles.push(dir)
  return dir
}

/** Quits every app this spec started (through app.quit(), so hooks are taken out and the collector stops), keeping the profiles. */
export async function closeApps(): Promise<void> {
  await Promise.all(started.splice(0).map((app) => app.close().catch(() => undefined)))
}

export async function cleanup(): Promise<void> {
  await closeApps()
  for (const dir of profiles.splice(0)) removeDir(dir)
}

export interface Endpoint {
  port: number
  token: string
}

/** The collector writes its port to config.json once it listens (the same file the installer reads). */
export function readEndpoint(userData: string): Endpoint | null {
  try {
    const c = JSON.parse(readFileSync(join(userData, 'config.json'), 'utf8')) as { collectorPort?: number; token?: string }
    return c.collectorPort && c.token ? { port: c.collectorPort, token: c.token } : null
  } catch {
    return null // not written yet, or caught mid-write
  }
}

/** The port the *previous* run wrote is still in config.json on a relaunch, so wait for one that answers /health. */
export function health(e: Endpoint): Promise<number> {
  return new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port: e.port, path: '/health', headers: { 'x-agentdeck-token': e.token }, timeout: 2_000 }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode ?? 0))
    })
    req.on('error', () => resolve(0))
    req.on('timeout', () => req.destroy())
    req.end()
  })
}

/** Resolves with the collector's endpoint once it answers /health with the token. */
export async function collectorReady(userData: string): Promise<Endpoint> {
  let endpoint: Endpoint | null = null
  await test.step('collector answers /health', async () => {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      endpoint = readEndpoint(userData)
      if (endpoint && (await health(endpoint)) === 200) return
      await new Promise((r) => setTimeout(r, 150))
    }
    throw new Error('The collector did not answer /health within 30 s.')
  })
  return endpoint!
}

export function postHook(e: Endpoint, body: unknown): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: e.port, method: 'POST', path: '/hooks', headers: { 'x-agentdeck-token': e.token, 'content-type': 'application/json' } },
      (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode ?? 0))
      }
    )
    req.on('error', reject)
    req.end(typeof body === 'string' ? body : JSON.stringify(body))
  })
}

type Bridge = Record<string, (...args: unknown[]) => Promise<unknown>>

/** One call on `window.agentdeck`, from the renderer, exactly as the app's own pages make it. */
export function bridge<K extends keyof AgentDeckBridge>(page: Page, method: K, ...args: Parameters<AgentDeckBridge[K]>): Promise<Awaited<ReturnType<AgentDeckBridge[K]>>> {
  return page.evaluate(([m, a]) => (globalThis as unknown as { agentdeck: Bridge }).agentdeck[m as string]!(...(a as unknown[])), [method, args] as const) as Promise<
    Awaited<ReturnType<AgentDeckBridge[K]>>
  >
}

/** A bridge call with arguments the types would refuse (wrong shapes, oversized values). */
export function rawBridge(page: Page, method: keyof AgentDeckBridge, ...args: unknown[]): Promise<unknown> {
  return page.evaluate(([m, a]) => (globalThis as unknown as { agentdeck: Bridge }).agentdeck[m as string]!(...(a as unknown[])), [method, args] as const)
}

export function taskOf(r: TaskResult): WorkTask {
  if (!r.ok) throw new Error(`Expected a task, got: ${r.error}`)
  return r.task
}

/**
 * A spec that reads "today" must not straddle local midnight. Within `window` ms of it, wait until just after midnight
 * (and extend the test timeout by that wait), so the whole test sees one local day.
 */
export async function clearOfMidnight(window = 120_000): Promise<void> {
  const now = new Date()
  const wait = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime()
  if (wait > window) return
  test.setTimeout(test.info().timeout + wait + 5_000)
  await new Promise((r) => setTimeout(r, wait + 1_000))
}

export const SESSION_ID = 'work-live-session'
export const SESSION_CWD = 'C:\\clients\\acme-billing'
/** The first turn's final message, whose first line becomes the session's summary in the report. */
export const FIRST_SUMMARY = 'Added the invoice export.'

/**
 * One session as Claude Code reports it (the real 2.1.318 payloads, with this cwd): a prompt, a Write and an Edit on two
 * files, a finished turn; then `turns - 1` more prompts that finish at once. Resolves once every POST was answered 200.
 */
export async function playSession(e: Endpoint, turns = 2, id = SESSION_ID, cwd = SESSION_CWD): Promise<void> {
  const send = async (name: string, extra: Record<string, unknown> = {}): Promise<void> => {
    const status = await postHook(e, { ...fixture(name), session_id: id, cwd, ...extra })
    if (status !== 200) throw new Error(`${name} was answered ${status}`)
  }
  const Write = `${cwd}\\src\\invoice.ts`
  const Edit = `${cwd}\\README.md`
  await send('UserPromptSubmit-1', { prompt: 'Add the invoice export' })
  await send('PreToolUse-3', { tool_input: { file_path: Write, content: 'export {}' } })
  await send('PostToolUse-2', { tool_input: { file_path: Write, content: 'export {}' } })
  await send('PostToolUse-3', { tool_input: { file_path: Edit, old_string: 'a', new_string: 'b' }, tool_use_id: 'toolu_work_live_edit' })
  await send('Stop-1', { last_assistant_message: `${FIRST_SUMMARY}\n\n- touched two files` })
  for (let turn = 2; turn <= turns; turn++) {
    await send('UserPromptSubmit-1', { prompt: `Follow-up number ${turn}` })
    await send('Stop-2', { last_assistant_message: `Follow-up ${turn} done.` })
  }
}

/** The collector's own process id, from GET /health. */
export function collectorPid(e: Endpoint): Promise<number> {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port: e.port, path: '/health', headers: { 'x-agentdeck-token': e.token } }, (res) => {
      let body = ''
      res.on('data', (d: Buffer) => (body += d.toString()))
      res.on('end', () => done((JSON.parse(body) as { pid: number }).pid))
    })
    req.on('error', fail)
    req.end()
  })
}
