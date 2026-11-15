// How the local Claude Code CLI says it is signed in, from its own `claude auth status` (2.1.323: JSON by default).
// ADR-0009: AgentDeck never reads credentials, ~/.claude.json or the account. That command also prints an email address,
// an organisation id and name; none of them is read here. Only the method and plan words below are picked out, the rest
// of the output is dropped unread, and nothing from it is ever logged. No electron import: unit-testable.
import type { ClaudeLink, SignInState } from '@shared/work'
import { cleanEnv, run } from '../collector/cli'

const STATUS_TIMEOUT_MS = 3_000

export interface AuthRead {
  signIn: SignInState
  plan: ClaudeLink['plan']
}

const UNKNOWN: AuthRead = { signIn: 'unknown', plan: null }

/** Words the CLI is known to use for `subscriptionType`; anything else is not shown (it could be anything). */
const PLANS: Readonly<Record<string, string>> = { pro: 'Pro', max: 'Max', ultra: 'Ultra', team: 'Team', enterprise: 'Enterprise', free: 'Free' }
/** `planTier` for Max: "max_5x", "max_20x". */
const MAX_TIER = /^max_(5|20)x$/
const API_KEY_METHOD = /api[_ -]?key|console/i

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The plan, as a word, only for a subscription; never anything that names a person or an organisation. */
function planOf(j: Record<string, unknown>): string | null {
  const tier = MAX_TIER.exec(text(j.planTier))
  if (tier) return `Max ${tier[1]}x`
  return PLANS[text(j.subscriptionType).toLowerCase()] ?? null
}

/**
 * Reads the output of `claude auth status --json` (exit 0 signed in, exit 1 signed out: the body is read either way).
 * Anything it can't make sense of, an older CLI without the command included, is `unknown`: that is said, not guessed.
 */
export function parseAuth(stdout: string): AuthRead {
  let j: unknown
  try {
    j = JSON.parse(stdout.trim())
  } catch {
    return UNKNOWN
  }
  if (typeof j !== 'object' || j === null || Array.isArray(j)) return UNKNOWN
  const status = j as Record<string, unknown>
  if (status.loggedIn === false) return { signIn: 'signed-out', plan: null }
  if (status.loggedIn !== true) return UNKNOWN
  // Bedrock, Vertex and the like: neither a subscription nor an Anthropic API key, so AgentDeck doesn't say which.
  const provider = text(status.apiProvider)
  if (provider && provider !== 'firstParty') return UNKNOWN
  const method = text(status.authMethod)
  if (method === 'claude.ai') return { signIn: 'subscription', plan: planOf(status) }
  if (API_KEY_METHOD.test(method)) return { signIn: 'api-key', plan: null }
  return UNKNOWN
}

/** One spawn through the scrubbed environment (ADR-0008) with its own 3 s limit. Never throws. */
export async function readAuth(cli: string): Promise<AuthRead> {
  const r = await run(cli, ['auth', 'status', '--json'], STATUS_TIMEOUT_MS, cleanEnv())
  return r.code === null ? UNKNOWN : parseAuth(r.stdout)
}
