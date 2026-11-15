import type { Diagnostics } from '@shared/work'

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The folders that are "home": `C:\Users\<name>` as it stands, and whatever precedes `\AppData` in a path (profiles elsewhere). */
export function homesIn(paths: readonly (string | null)[]): string[] {
  const homes = new Set<string>()
  for (const p of paths) {
    if (!p) continue
    const users = /^[A-Za-z]:[\\/]Users[\\/][^\\/]+/i.exec(p)
    const appData = /^(.+?)[\\/]AppData[\\/]/i.exec(p)
    if (users) homes.add(users[0])
    if (appData?.[1]) homes.add(appData[1])
  }
  return [...homes].sort((a, b) => b.length - a.length)
}

/** Every home folder becomes `~`, whichever slash and case the path used, and a 64-digit hex run (the shape of the token) is hidden. */
export function redact(text: string, homes: readonly string[]): string {
  const withHomes = homes.reduce((t, home) => t.replace(new RegExp(esc(home).replace(/\\\\|\//g, '[\\\\/]'), 'gi'), '~'), text)
  return withHomes.replace(/\b[0-9a-f]{64}\b/gi, '[hidden]')
}

export function formatBytes(n: number | null): string {
  if (n === null) return 'not created yet'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const COLLECTOR = { up: 'running', down: 'not running', demo: 'not used (demo data)' } as const

/** Plain text to paste into a bug report. Nothing in it is secret: no token, no settings.json contents. */
export function diagnosticsReport(d: Diagnostics): string {
  const lines = [
    'AgentDeck diagnostics',
    `Version: ${d.version} (Electron ${d.electron}, Node ${d.node})`,
    `System: ${d.os}`,
    `Started: ${new Date(d.startedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    `Collector: ${COLLECTOR[d.collector]}${d.port !== null ? `, port ${d.port}` : ''}`,
    `Hooks: ${d.hooks}`,
    `Claude Code: ${d.claudeVersion ?? 'not found'}${d.claudePath ? ` at ${d.claudePath}` : ''}`,
    `Data folder: ${d.userData}`,
    `Database: ${d.dbPath} (${formatBytes(d.dbBytes)})`,
    '',
    'Checks',
    ...d.checks.map((c) => `[${c.ok ? 'ok' : 'needs attention'}] ${c.label}: ${c.detail}`)
  ]
  return redact(lines.join('\n'), homesIn([d.userData, d.dbPath, d.claudePath]))
}
