// docs/EVENT_SCHEMA.md § Redaction: applied before insert and before any preview.

const MASK = '•••'
/** Bounds regex work per string (hook bodies are ≤ 1 MB, but one huge `command` must not stall ingest). */
const SCAN_MAX = 16_384
/** Deeper than any real hook body; a hostile one can't blow the stack. */
const DEPTH_MAX = 32

// Quantifiers are bounded ({0,40}) so no pattern goes quadratic on a long run of word characters.
const KEY = String.raw`\w{0,40}(?:api[_-]?key|token|secret|passw(?:or)?d|authorization|credentials?)\w{0,40}`
const SECRETS: [RegExp, string][] = [
  // A key cut off by a cap has no END line: mask to the end of the string.
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, MASK],
  // `KEY=v`, `key: v`, `"password": "v"`, escaped JSON `\"token\":\"v\"`, `Authorization: Bearer v` (the token goes, not the word).
  [new RegExp(String.raw`(\b${KEY}(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?)(?:bearer\s+)?[^\s"'\\,;}]+`, 'gi'), `$1${MASK}`],
  // `--password v`, `--api-key v`
  [/(--\w{0,40}(?:passw(?:or)?d|token|secret|api-?key)\w{0,40}\s+)[^\s-]\S*/gi, `$1${MASK}`],
  [/\bsk-ant-[\w-]+/g, MASK], // Anthropic
  [/\bsk-[\w-]{20,}/g, MASK], // OpenAI sk-… and sk-proj-…
  [/\b[rs]k_(?:live|test)_[A-Za-z0-9]{10,}/g, MASK], // Stripe
  [/\bgh[pousr]_[A-Za-z0-9]{36,}/g, MASK],
  [/\bgithub_pat_\w+/g, MASK],
  [/\bglpat-[\w-]{20,}/g, MASK],
  [/\bnpm_[A-Za-z0-9]{36}\b/g, MASK],
  [/\bhf_[A-Za-z0-9]{30,}/g, MASK],
  [/\bAIza[\w-]{35}/g, MASK], // Google API key
  [/\bxox[abprs]-[\w-]+/g, MASK],
  [/\bAKIA[0-9A-Z]{16}\b/g, MASK],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, MASK],
  // Anchored on "://" (a leading \w+ was quadratic); userinfo has no "/", so each try stops at the next one.
  [/(:\/\/[^:\s/@]{1,256}:)[^@\s/]+@/g, `$1${MASK}@`]
]
const SECRET_KEY = new RegExp(`^${KEY}$`, 'i')

export function maskSecrets(s: string): string {
  return SECRETS.reduce((acc, [re, to]) => acc.replace(re, to), cap(s, SCAN_MAX))
}

/** Masks every string at any depth, and every string value whose key names a secret (`{"password": "x"}`). */
export function redactDeep(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return maskSecrets(v)
  if (depth >= DEPTH_MAX && v && typeof v === 'object') return '<nested too deep>'
  if (Array.isArray(v)) return v.map((x) => redactDeep(x, depth + 1))
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, typeof x === 'string' && SECRET_KEY.test(k) ? MASK : redactDeep(x, depth + 1)])
    )
  }
  return v
}

export function cap(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/** File bodies are never kept: only their size (Write.content, Edit.old_string/new_string, …). */
const BODY_FIELDS = new Set(['content', 'old_string', 'new_string', 'new_source'])
const size = (s: string): string => `<${s.length} chars>`

export function slimToolInput(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  return Object.fromEntries(
    Object.entries(input).map(([k, v]) => {
      if (BODY_FIELDS.has(k) && typeof v === 'string') return [k, size(v)]
      if (k === 'edits' && Array.isArray(v)) return [k, v.map(slimToolInput)] // MultiEdit
      return [k, v]
    })
  )
}

/** File tools echo file contents in their response, so only the size survives (before masking: nothing is left to mask). */
const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
export const RESPONSE_MAX = 2048

export function slimToolResponse(toolName: string | null, response: unknown): unknown {
  if (response === undefined || !toolName || !FILE_TOOLS.has(toolName)) return response
  return size(typeof response === 'string' ? response : JSON.stringify(response))
}

/** Other responses keep their first 2 KB. Run after masking. */
export function capResponse(response: unknown): unknown {
  if (response === undefined) return undefined
  const json = typeof response === 'string' ? response : JSON.stringify(response)
  return json.length > RESPONSE_MAX ? cap(json, RESPONSE_MAX) : response
}
