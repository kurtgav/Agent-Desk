import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { foreignTelemetryKeys, isOurTelemetry, ourTelemetryKeys, stripTelemetry, telemetryEnv, type TelemetryTarget } from './claude-telemetry'
import { inspectTelemetry, planTelemetryOff, planTelemetryOn, previewTelemetry, removeTelemetry, setTelemetry, telemetryState } from './claude-telemetry-install'
import { install, uninstall, type HookPaths } from './hooks'
import { foreignUnchanged } from './hooks-install'

const TARGET: TelemetryTarget = { port: 47821, token: 'a'.repeat(64) }
const OTHER: TelemetryTarget = { port: 47822, token: 'b'.repeat(64) }
const OURS = (t: TelemetryTarget): string => Object.entries(telemetryEnv(t)).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
/** A temp config dir: the real ~/.claude is never written by a test. */
function temp(settings?: string): HookPaths {
  const dir = mkdtempSync(join(tmpdir(), 'agentdeck-telemetry-'))
  dirs.push(dir)
  const file = join(dir, 'settings.json')
  if (settings !== undefined) writeFileSync(file, settings)
  return { settings: file, backups: join(dir, 'backups') }
}
const after = (p: ReturnType<typeof planTelemetryOn>): string => {
  if (!p.ok) throw new Error(p.error)
  return p.after
}

describe('what AgentDeck asks Claude Code to export (ADR-0007)', () => {
  const env = telemetryEnv(TARGET)

  it('is metrics over OTLP/HTTP JSON to our loopback receiver, with our token', () => {
    expect(env).toEqual({
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      OTEL_METRICS_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'http://127.0.0.1:47821/v1/metrics',
      OTEL_EXPORTER_OTLP_HEADERS: `X-AgentDeck-Token=${'a'.repeat(64)}`,
      OTEL_METRIC_EXPORT_INTERVAL: '10000'
    })
  })

  it('asks for no logs, no traces, and never turns prompt, response or tool content on', () => {
    const keys = Object.keys(env)
    expect(keys.filter((k) => /LOG|TRACE|PROMPT|RESPONSE|TOOL|RAW|BETA/i.test(k))).toEqual([])
    for (const forbidden of ['OTEL_LOGS_EXPORTER', 'OTEL_TRACES_EXPORTER', 'OTEL_LOG_USER_PROMPTS', 'OTEL_LOG_ASSISTANT_RESPONSES', 'OTEL_LOG_TOOL_DETAILS', 'OTEL_LOG_TOOL_CONTENT', 'OTEL_LOG_RAW_API_BODIES', 'ENABLE_BETA_TRACING_DETAILED']) {
      expect(env).not.toHaveProperty(forbidden)
    }
  })

  it('knows its own entries by the loopback metrics URL and the token header, whatever the port', () => {
    expect(isOurTelemetry(telemetryEnv(OTHER))).toBe(true)
    expect(ourTelemetryKeys(telemetryEnv(OTHER))).toHaveLength(6)
    // A lone OTEL_METRICS_EXPORTER is the user's own.
    expect(isOurTelemetry({ OTEL_METRICS_EXPORTER: 'otlp', CLAUDE_CODE_ENABLE_TELEMETRY: '1' })).toBe(false)
    expect(ourTelemetryKeys({ OTEL_METRICS_EXPORTER: 'otlp' })).toEqual([])
    // Their collector on loopback is not ours: no token header.
    expect(isOurTelemetry({ OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'http://127.0.0.1:4318/v1/metrics', OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer x' })).toBe(false)
  })

  it('only removes a key that still holds our value', () => {
    expect(ourTelemetryKeys({ ...telemetryEnv(TARGET), OTEL_METRIC_EXPORT_INTERVAL: '5000' })).not.toContain('OTEL_METRIC_EXPORT_INTERVAL')
  })

  it('names the user’s own telemetry settings, never their values', () => {
    expect(foreignTelemetryKeys({ OTEL_LOGS_EXPORTER: 'otlp', CLAUDE_CODE_ENABLE_TELEMETRY: '1', PATH: 'x', ANTHROPIC_MODEL: 'y' }).sort()).toEqual(['CLAUDE_CODE_ENABLE_TELEMETRY', 'OTEL_LOGS_EXPORTER'])
  })
})

describe('planTelemetryOn / planTelemetryOff', () => {
  const user = '{\n  "model": "opus",\n  "env": {\n    "FOO": "bar"\n  },\n  "permissions": { "allow": ["Read"] }\n}\n'

  it('adds the six keys after the user’s, and takes them out again byte for byte', () => {
    const on = after(planTelemetryOn(user, TARGET))
    expect(JSON.parse(on).env).toEqual({ FOO: 'bar', ...telemetryEnv(TARGET) })
    expect(on).toContain(`"FOO": "bar",\n${OURS(TARGET)}\n  }`)
    expect(after(planTelemetryOff(on))).toBe(user)
  })

  it('creates the env block when there is none, and removes it again when it empties', () => {
    const plain = '{\n  "model": "opus"\n}\n'
    const on = after(planTelemetryOn(plain, TARGET))
    expect(JSON.parse(on)).toEqual({ model: 'opus', env: telemetryEnv(TARGET) })
    expect(after(planTelemetryOff(on))).toBe(plain)
  })

  it('makes a settings file out of nothing, and nothing out of it', () => {
    const on = after(planTelemetryOn(null, TARGET))
    expect(JSON.parse(on)).toEqual({ env: telemetryEnv(TARGET) })
    expect(JSON.parse(after(planTelemetryOff(on)))).toEqual({})
  })

  it('changes nothing when it is already on, or already off', () => {
    const on = after(planTelemetryOn(user, TARGET))
    expect(planTelemetryOn(on, TARGET)).toMatchObject({ ok: true, changed: false, after: on })
    expect(planTelemetryOff(user)).toMatchObject({ ok: true, changed: false })
  })

  it('moves a stale port and token to the current ones, leaving the user’s keys', () => {
    const stale = after(planTelemetryOn(user, OTHER))
    expect(inspectTelemetry(stale, TARGET)).toMatchObject({ state: 'stale' })
    const fresh = after(planTelemetryOn(stale, TARGET))
    expect(JSON.parse(fresh).env).toEqual({ FOO: 'bar', ...telemetryEnv(TARGET) })
    expect(inspectTelemetry(fresh, TARGET)).toMatchObject({ state: 'on' })
  })

  it('keeps a CRLF file CRLF and the user’s indentation', () => {
    const crlf = '{\r\n\t"model": "opus"\r\n}\r\n'
    const on = after(planTelemetryOn(crlf, TARGET))
    expect(on.replace(/\r\n/g, '')).not.toContain('\n')
    expect(on).toContain('\r\n\t"env": {')
    expect(after(planTelemetryOff(on))).toBe(crlf)
  })

  it('does not override telemetry the user set up (R21): it says which keys, not their values', () => {
    const theirs = '{\n  "env": {\n    "OTEL_METRICS_EXPORTER": "otlp",\n    "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer s3cret"\n  }\n}\n'
    const p = planTelemetryOn(theirs, TARGET)
    expect(p).toMatchObject({ ok: false })
    const error = (p as { error: string }).error
    expect(error).toContain('OTEL_METRICS_EXPORTER')
    expect(error).not.toContain('s3cret')
    expect(planTelemetryOff(theirs)).toMatchObject({ ok: true, changed: false })
    expect(inspectTelemetry(theirs, TARGET)).toMatchObject({ ok: true, state: 'elsewhere', foreign: ['OTEL_METRICS_EXPORTER', 'OTEL_EXPORTER_OTLP_HEADERS'] })
  })

  it('does not override telemetry in the environment AgentDeck was started from', () => {
    expect(planTelemetryOn(user, TARGET, ['OTEL_SDK_DISABLED'])).toMatchObject({ ok: false })
    // Once ours is in, an environment variable no longer blocks an update.
    expect(planTelemetryOn(after(planTelemetryOn(user, OTHER)), TARGET, ['OTEL_SDK_DISABLED'])).toMatchObject({ ok: true })
  })

  it('leaves a file it can’t make sense of alone', () => {
    expect(planTelemetryOn('{ "env": ', TARGET)).toMatchObject({ ok: false })
    expect(planTelemetryOn('{ "env": [] }', TARGET)).toMatchObject({ ok: false, error: '"env" in settings.json is not an object' })
    expect(planTelemetryOff('{ "env": "x" }')).toMatchObject({ ok: false })
  })

  it('is judged by the writer’s own check: foreign keys equal before and after', () => {
    const on = after(planTelemetryOn(user, TARGET))
    expect(foreignUnchanged(user, on)).toBe(true)
    expect(foreignUnchanged(on, user)).toBe(true)
    expect(foreignUnchanged(user, on.replace('"bar"', '"baz"'))).toBe(false)
    expect(foreignUnchanged('{\n  "env": {}\n}\n', after(planTelemetryOn('{\n  "env": {}\n}\n', TARGET)))).toBe(true)
  })
})

describe('the preview (what the dialog shows)', () => {
  it('shows keys and the address, and hides the token and every value of the user’s', () => {
    const paths = temp('{\n  "env": {\n    "SECRET_THING": "hunter2"\n  }\n}\n')
    const p = previewTelemetry(paths, true, TARGET)
    if (!p.ok) throw new Error(p.error)
    expect(p.changed).toBe(true)
    expect(p.diff).toContain('"OTEL_EXPORTER_OTLP_METRICS_ENDPOINT": "http://127.0.0.1:47821/v1/metrics"')
    expect(p.diff).toContain('"OTEL_METRICS_EXPORTER": "otlp"')
    expect(p.diff).toContain('"OTEL_EXPORTER_OTLP_HEADERS": "•••"')
    expect(p.diff).not.toContain('a'.repeat(64))
    expect(p.diff).not.toContain('hunter2')
    expect(p.diff).not.toMatch(/OTEL_LOG|PROMPT|TOOL/)
  })

  it('says why it can’t, and does not wait on a collector that isn’t there', () => {
    expect(previewTelemetry(temp('{ "env": '), true, TARGET)).toMatchObject({ ok: false })
    expect(previewTelemetry(temp('{}'), true, null)).toMatchObject({ ok: false })
    expect(previewTelemetry(temp('{}'), false, null)).toMatchObject({ ok: true, changed: false })
  })
})

describe('writing settings.json (ADR-0005 writer)', () => {
  it('backs the file up, writes it, and reads back as on; off restores the original bytes', () => {
    const original = '{\n  "model": "opus"\n}\n'
    const paths = temp(original)
    expect(telemetryState(paths, TARGET)).toBe('off')
    expect(setTelemetry(paths, true, TARGET)).toEqual({ ok: true })
    expect(telemetryState(paths, TARGET)).toBe('on')
    expect(telemetryState(paths, OTHER)).toBe('stale')
    expect(readdirSync(paths.backups)).toHaveLength(1)
    expect(readFileSync(join(paths.backups, readdirSync(paths.backups)[0]!), 'utf8')).toBe(original)
    expect(setTelemetry(paths, false, null)).toEqual({ ok: true })
    expect(readFileSync(paths.settings, 'utf8')).toBe(original)
  })

  it('writes nothing, and no backup, when nothing changes', () => {
    const paths = temp('{}\n')
    expect(setTelemetry(paths, false, null)).toEqual({ ok: true })
    expect(existsSync(paths.backups)).toBe(false)
  })

  it('refuses without a collector, and refuses telemetry that is not ours', () => {
    const paths = temp('{}\n')
    expect(setTelemetry(paths, true, null)).toMatchObject({ ok: false })
    const theirs = temp('{"env":{"CLAUDE_CODE_ENABLE_TELEMETRY":"1"}}\n')
    expect(setTelemetry(theirs, true, TARGET)).toMatchObject({ ok: false })
    expect(readFileSync(theirs.settings, 'utf8')).toBe('{"env":{"CLAUDE_CODE_ENABLE_TELEMETRY":"1"}}\n')
  })

  it('creates the file and its folder when Claude Code has not made one yet', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentdeck-telemetry-'))
    dirs.push(dir)
    const paths: HookPaths = { settings: join(dir, 'nested', 'settings.json'), backups: join(dir, 'backups') }
    expect(setTelemetry(paths, true, TARGET)).toEqual({ ok: true })
    expect(JSON.parse(readFileSync(paths.settings, 'utf8')).env).toEqual(telemetryEnv(TARGET))
  })

  it('shares the file with the hook entries: each goes without touching the other', () => {
    const paths = temp('{\n  "model": "opus"\n}\n')
    expect(install(paths, TARGET)).toEqual({ ok: true })
    expect(setTelemetry(paths, true, TARGET)).toEqual({ ok: true })
    const both = JSON.parse(readFileSync(paths.settings, 'utf8')) as { hooks: Record<string, unknown>; env: unknown; model: string }
    expect(Object.keys(both.hooks).length).toBeGreaterThan(5)
    expect(both.env).toEqual(telemetryEnv(TARGET))

    // Quit takes the hooks out; the telemetry stays (ADR-0007).
    expect(uninstall(paths)).toEqual({ ok: true })
    const quit = JSON.parse(readFileSync(paths.settings, 'utf8')) as Record<string, unknown>
    expect(quit.hooks).toBeUndefined()
    expect(quit.env).toEqual(telemetryEnv(TARGET))
    expect(quit.model).toBe('opus')

    // The installer's uninstall step takes the telemetry out too.
    expect(install(paths, TARGET)).toEqual({ ok: true })
    expect(removeTelemetry(paths)).toEqual({ ok: true })
    const gone = JSON.parse(readFileSync(paths.settings, 'utf8')) as Record<string, unknown>
    expect(gone.env).toBeUndefined()
    expect(gone.hooks).toBeDefined()
    expect(uninstall(paths)).toEqual({ ok: true })
    expect(readFileSync(paths.settings, 'utf8')).toBe('{\n  "model": "opus"\n}\n')
  })

  it('reads a broken or missing file as off without throwing', () => {
    expect(telemetryState(temp('{ nope'), TARGET)).toBe('off')
    expect(telemetryState(temp(), TARGET)).toBe('off')
  })
})

describe('stripTelemetry', () => {
  it('drops ours and an env left empty, and nothing of the user’s', () => {
    expect(stripTelemetry({ a: 1, env: telemetryEnv(TARGET) })).toEqual({ a: 1 })
    expect(stripTelemetry({ a: 1, env: { ...telemetryEnv(TARGET), FOO: 'x' } })).toEqual({ a: 1, env: { FOO: 'x' } })
    expect(stripTelemetry({ env: { OTEL_METRICS_EXPORTER: 'otlp' } })).toEqual({ env: { OTEL_METRICS_EXPORTER: 'otlp' } })
  })
})
