// ADR-0007: the `env` entries that point Claude Code's usage telemetry at AgentDeck, and how to tell they are ours.
// Pure data and checks, no imports from the settings writer, so hooks-install.ts can use it for its validation.

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Same header the hooks carry (ADR-0010): it is how an entry reads as AgentDeck's. */
export const TELEMETRY_TOKEN_HEADER = 'X-AgentDeck-Token'
const OUR_ENDPOINT = /^http:\/\/127\.0\.0\.1:\d+\/v1\/metrics$/
const EXPORT_INTERVAL_MS = '10000'

export interface TelemetryTarget {
  port: number
  token: string
}

/**
 * Metrics only, OTLP over HTTP JSON (the one the receiver reads, ADR-0007). No logs or traces exporter is asked for, and none
 * of OTEL_LOG_USER_PROMPTS / _ASSISTANT_RESPONSES / _TOOL_DETAILS / _TOOL_CONTENT / _RAW_API_BODIES is set, so prompts, replies
 * and tool content stay off (monitoring-usage § Content logging: all default to off). A test asserts that.
 */
export function telemetryEnv(t: TelemetryTarget): Record<string, string> {
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `http://127.0.0.1:${t.port}/v1/metrics`,
    OTEL_EXPORTER_OTLP_HEADERS: `${TELEMETRY_TOKEN_HEADER}=${t.token}`,
    OTEL_METRIC_EXPORT_INTERVAL: EXPORT_INTERVAL_MS
  }
}

/** Whether a value could be one we wrote (any port, any token): the fixed ones by equality, the other two by shape. */
const OURS: Record<string, (v: unknown) => boolean> = {
  CLAUDE_CODE_ENABLE_TELEMETRY: (v) => v === '1',
  OTEL_METRICS_EXPORTER: (v) => v === 'otlp',
  OTEL_EXPORTER_OTLP_PROTOCOL: (v) => v === 'http/json',
  OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: (v) => typeof v === 'string' && OUR_ENDPOINT.test(v),
  OTEL_EXPORTER_OTLP_HEADERS: (v) => typeof v === 'string' && v.startsWith(`${TELEMETRY_TOKEN_HEADER}=`),
  OTEL_METRIC_EXPORT_INTERVAL: (v) => v === EXPORT_INTERVAL_MS
}

/**
 * The setup is AgentDeck's when the endpoint is a loopback `/v1/metrics` URL and the headers carry our token header. Only then
 * are the other keys judged: a lone `OTEL_METRICS_EXPORTER=otlp` belongs to the user.
 */
export const isOurTelemetry = (env: Json): boolean => OURS.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT!(env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT) && OURS.OTEL_EXPORTER_OTLP_HEADERS!(env.OTEL_EXPORTER_OTLP_HEADERS)

/** The keys of `env` that are ours to remove: none unless the setup is ours, and then only keys still holding our values. */
export const ourTelemetryKeys = (env: Json): string[] => (isOurTelemetry(env) ? Object.entries(OURS).filter(([k, ok]) => k in env && ok(env[k])).map(([k]) => k) : [])

/** Whether `env` holds exactly what `telemetryEnv(target)` would write. */
export const isCurrentTelemetry = (env: Json, target: TelemetryTarget): boolean => Object.entries(telemetryEnv(target)).every(([k, v]) => env[k] === v)

/** Telemetry settings that are not AgentDeck's (R21): the names only, never the values. */
export const foreignTelemetryKeys = (env: Readonly<Record<string, unknown>>): string[] =>
  Object.keys(env).filter((k) => k.startsWith('OTEL_') || k === 'CLAUDE_CODE_ENABLE_TELEMETRY')

/**
 * `root` without our entries, and without an empty `env`: what is left is what the user wrote. The writer compares this
 * before and after an edit (ADR-0005 § 4), so a changed foreign key is caught and the original put back.
 */
export function stripTelemetry(root: Json): Json {
  if (!isObj(root.env)) return root
  const gone = ourTelemetryKeys(root.env)
  const rest = Object.fromEntries(Object.entries(root.env).filter(([k]) => !gone.includes(k)))
  const others = Object.fromEntries(Object.entries(root).filter(([k]) => k !== 'env'))
  return Object.keys(rest).length === 0 ? others : { ...others, env: rest }
}
