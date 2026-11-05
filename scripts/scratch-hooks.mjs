// Dev only: points the scratch project's hooks at a running AgentDeck (M2 live check), or at the
// M0 capture server with --capture. Writes spikes/scratch/.claude/settings.local.json (gitignored:
// it holds the real token). Never touches ~/.claude; the user-level install is M3 (ADR-0005).
// Usage: npm run scratch:hooks [-- --capture] [-- --user-data <dir>]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// The HTTP-capable events (hooks § Prompt-based hooks: not SessionStart or Setup), as captured in S1.
const EVENTS = [
  'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied',
  'Notification', 'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop', 'TaskCreated', 'TaskCompleted',
  'PreCompact', 'CwdChanged', 'SessionEnd'
]
const OUT = join('spikes', 'scratch', '.claude', 'settings.local.json')

function arg(name) {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}

function endpoint() {
  if (process.argv.includes('--capture')) return { port: 47821, token: 'spike-token-0001' } // capture-server defaults
  const userData = arg('--user-data') ?? process.env.AGENTDECK_USER_DATA ?? join(process.env.APPDATA ?? '', 'AgentDeck')
  const file = join(userData, 'config.json')
  let config
  try {
    config = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new Error(`No AgentDeck config at ${file}. Start AgentDeck in live mode once, then run this again.`)
  }
  if (!Number.isInteger(config.collectorPort) || !/^[0-9a-f]{64}$/.test(config.token ?? '')) {
    throw new Error(`${file} has no collectorPort or token yet. Is AgentDeck running in live mode?`)
  }
  return { port: config.collectorPort, token: config.token }
}

const { port, token } = endpoint()
// F4: timeout 2 s; a refused connection, timeout or non-2xx is non-blocking by default (hooks § HTTP response handling).
const entry = { type: 'http', url: `http://127.0.0.1:${port}/hooks`, timeout: 2, headers: { 'X-AgentDeck-Token': token } }
// S4's hold mode keeps PermissionRequest open 8 s, so the capture setup gave it 20 s.
const timeoutFor = (e) => (e === 'PermissionRequest' && process.argv.includes('--capture') ? 20 : entry.timeout)
const settings = { hooks: Object.fromEntries(EVENTS.map((e) => [e, [{ hooks: [{ ...entry, timeout: timeoutFor(e) }] }]])) }
mkdirSync(join('spikes', 'scratch', '.claude'), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(settings, null, 2)}\n`)
console.log(`Wrote ${OUT}: ${EVENTS.length} events → 127.0.0.1:${port}`)
