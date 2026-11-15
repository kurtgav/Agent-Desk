import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { IPC, type HooksPreview, type HooksResult } from '@shared/bridge'
import type { ClaudeLink } from '@shared/work'
import { cleanEnv, resolveClaude, run } from '../collector/cli'
import { readAuth, type AuthRead } from './claude-auth'
import { foreignTelemetryKeys, type TelemetryTarget } from './claude-telemetry'
import { previewStatusLine, setStatusLine, statusLineState } from './claude-statusline-install'
import { previewTelemetry, setTelemetry, telemetryState } from './claude-telemetry-install'
import { readConfig } from './config'
import { readLogsOn } from './settings-model'
import type { Dispose, MainCtx } from './ctx'
import type { HookPaths } from './hooks'
import { settingsPath } from './hooks-install'

/** A few seconds, so Settings, the sidebar and the composer opening together cost one probe (R6: every probe starts claude.exe). */
const CACHE_MS = 5_000
const VERSION_TIMEOUT_MS = 3_000
const DAY_MS = 86_400_000
const VERSION = /^(\d+\.\d+\.\d+)\b/

const DEMO_REFUSED = 'Turn demo data off first.'
const NOT_READY = 'AgentDeck is still starting its collector. Try again in a moment.'

/** Demo data speaks for the sample user (D-014): a plausible link, nothing read from this PC. */
const DEMO_LINK: ClaudeLink = {
  cli: { found: true, path: 'C:\\Users\\Kurt\\.local\\bin\\claude.exe', version: '2.1.323' },
  signIn: 'subscription',
  plan: 'Max',
  usage: { enabled: true, receiving: true, readLogs: true },
  planUsage: 'on'
}

/** What an error leaves: nothing is claimed, and the page shows its "could not tell" wording. */
const NOT_KNOWN: ClaudeLink = { cli: { found: false, path: null, version: null }, signIn: 'unknown', plan: null, usage: { enabled: false, receiving: false, readLogs: false } }

export interface LinkDeps {
  now(): number
  /** The CLI path (ADR-0008), or null when none is installed. */
  cli(): Promise<string | null>
  version(cli: string): Promise<string | null>
  auth(cli: string): Promise<AuthRead>
  usage(): Promise<ClaudeLink['usage']>
  /** AGENTDECK_POLL=0 (smoke tests, safe runs): never start the real CLI. The link then says nothing is known and no fix is asked of the user. */
  quiet?: boolean
}

/** Runs a probe that must not take the link down with it. */
async function safely<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch {
    return fallback
  }
}

async function probe(d: LinkDeps): Promise<ClaudeLink> {
  if (d.quiet) return { cli: { found: true, path: null, version: null }, signIn: 'unknown', plan: null, usage: await safely(() => d.usage(), NOT_KNOWN.usage) }
  const [path, usage] = await Promise.all([safely(() => d.cli(), null), safely(() => d.usage(), NOT_KNOWN.usage)])
  if (!path) return { ...NOT_KNOWN, usage }
  const [version, auth] = await Promise.all([safely(() => d.version(path), null), safely(() => d.auth(path), { signIn: 'unknown' as const, plan: null })])
  return { cli: { found: true, path, version }, signIn: auth.signIn, plan: auth.plan, usage }
}

/** `read` never rejects and answers from the last probe for a few seconds; probes that overlap share one run. */
export function createLinkReader(d: LinkDeps): { read(): Promise<ClaudeLink>; invalidate(): void } {
  let cached: { at: number; link: ClaudeLink } | null = null
  let running: Promise<ClaudeLink> | null = null
  return {
    read: () => {
      if (cached && d.now() - cached.at < CACHE_MS) return Promise.resolve(cached.link)
      running ??= probe(d)
        .then((link) => {
          cached = { at: d.now(), link }
          return link
        })
        .finally(() => {
          running = null
        })
      return running
    },
    invalidate: () => {
      cached = null
    }
  }
}

const versionOf = (stdout: string): string | null => VERSION.exec(stdout.trim())?.[1] ?? null

/**
 * The Claude Code link: sign-in state from the CLI's own `claude auth status`, and the opt-in that points Claude Code's usage
 * telemetry at AgentDeck (ADR-0007, ADR-0009), and the status line that saves the plan's limits (ADR-0009 amendment). Registers
 * IPC.getClaudeLink, previewUsageTelemetry, setUsageTelemetry, previewPlanUsage and setPlanUsage.
 * Telemetry entries and the status line stay in settings.json when AgentDeck quits; `--uninstall-integration` removes them.
 */
export function registerClaude(ctx: MainCtx): Dispose {
  let cliPath: string | null = null

  const paths = (): HookPaths => ({ settings: settingsPath(process.env, homedir()), backups: join(ctx.userData(), 'backups') })

  /** The running collector's port and the last time figures reached it; null while it isn't answering. */
  async function collectorStatus(): Promise<{ lastAt: number | null; port: number | null } | null> {
    const m = await ctx.collector()?.request((reqId) => ({ type: 'usageStatus', reqId }))
    return m?.type === 'usageStatus' ? { lastAt: m.lastAt, port: m.port } : null
  }

  /** The collector's own port, the token from config.json (ADR-0010): never anything from the renderer. */
  function targetAt(port: number | null | undefined): TelemetryTarget | null {
    const token = readConfig(ctx.configFile()).token
    return typeof port === 'number' && typeof token === 'string' && /^[0-9a-f]{64}$/.test(token) ? { port, token } : null
  }
  const target = async (): Promise<TelemetryTarget | null> => targetAt((await collectorStatus())?.port)

  const reader = createLinkReader({
    now: Date.now,
    quiet: process.env.AGENTDECK_POLL === '0',
    cli: async () => {
      if (cliPath && existsSync(cliPath)) return cliPath
      const override = readConfig(ctx.configFile()).claudePath
      cliPath = await resolveClaude(typeof override === 'string' ? override : undefined)
      return cliPath
    },
    version: async (cli) => {
      const r = await run(cli, ['--version'], VERSION_TIMEOUT_MS, cleanEnv())
      return r.code === 0 ? versionOf(r.stdout) : null
    },
    auth: readAuth,
    usage: async () => {
      const status = await collectorStatus()
      return {
        enabled: telemetryState(paths(), targetAt(status?.port)) === 'on',
        receiving: status?.lastAt != null && Date.now() - status.lastAt < DAY_MS,
        readLogs: readLogsOn(readConfig(ctx.configFile()))
      }
    }
  })

  const refused = (): { ok: false; path: string; error: string } => ({ ok: false, path: paths().settings, error: DEMO_REFUSED })

  async function preview(on: boolean): Promise<HooksPreview> {
    if (ctx.demo()) return refused()
    return previewTelemetry(paths(), on, on ? await target() : null, foreignTelemetryKeys(process.env))
  }

  async function set(on: boolean): Promise<HooksResult> {
    if (ctx.demo()) return { ok: false, error: DEMO_REFUSED }
    const t = on ? await target() : null
    if (on && !t) return { ok: false, error: NOT_READY }
    const r = setTelemetry(paths(), on, t, foreignTelemetryKeys(process.env))
    reader.invalidate() // the Settings page and the sidebar read the new state at once
    return r
  }

  /** AgentDeck's status line script and what it saves (ADR-0009 amendment). */
  const statusDir = (): string => join(ctx.userData(), 'statusline')

  // The status line state is one read of settings.json, so it is looked at on every ask, outside the probe's cache.
  ctx.handle(IPC.getClaudeLink, async () => (ctx.demo() ? DEMO_LINK : { ...(await reader.read()), planUsage: statusLineState(paths(), statusDir()) }))
  ctx.handle(IPC.previewUsageTelemetry, (_e, on) => preview(z.boolean().parse(on)))
  ctx.handle(IPC.setUsageTelemetry, (_e, on) => set(z.boolean().parse(on)))
  ctx.handle(IPC.previewPlanUsage, (_e, on) => (ctx.demo() ? refused() : previewStatusLine(paths(), statusDir(), z.boolean().parse(on))))
  ctx.handle(IPC.setPlanUsage, (_e, on) => (ctx.demo() ? { ok: false, error: DEMO_REFUSED } : setStatusLine(paths(), statusDir(), z.boolean().parse(on))))
  return reader.invalidate
}
