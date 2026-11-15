import { useState, type ReactNode } from 'react'
import * as Popover from '@radix-ui/react-popover'
import * as Tabs from '@radix-ui/react-tabs'
import { LoaderCircle, RotateCw, Search, Sparkles, X } from 'lucide-react'
import type { CommandInfo, ConsoleCapabilities, McpServerInfo, McpStatus } from '@shared/console'
import { Button, CountBadge, Inline, cn, menuPanel, segList, segTab } from '../ui'
import { cancelMcp, checkMcp, useCaps } from './caps-store'
import { MCP_STATUS, modelLabel } from './options'

type TabId = 'servers' | 'skills' | 'commands' | 'agents' | 'plugins'

/** One sentence per group for someone who has never heard of the word. */
const HELP: Record<TabId, string> = {
  servers: 'MCP servers connect Claude to other apps and services, such as your mail, your files or a design tool. Each one gives Claude tools it can call.',
  skills: 'Skills are saved instructions Claude can follow, like a checklist or a house style. Type / in the message box to run one.',
  commands: 'Commands are shortcuts you type at the start of a message, such as /context. Ones that only work in the interactive terminal are left out.',
  agents: 'Agents are specialists Claude can hand part of the work to. Type @ in the message box to ask for one by name.',
  plugins: 'Plugins bundle skills, commands, agents and servers. Claude Code installs and updates them; AgentDeck only lists what is loaded.'
}

const DOT: Record<McpStatus, string> = { connected: 'var(--done)', pending: 'var(--working)', 'needs-auth': 'var(--needs)', failed: 'var(--failed)', disabled: 'var(--idle)', unknown: 'var(--idle)' }

function ServerRow({ name, status, tools }: { name: string; status: McpStatus; tools: number | null }) {
  const s = MCP_STATUS[status]
  return (
    <li className="flex items-start gap-3 py-2">
      <span aria-hidden className="mt-1.5 size-2 flex-none rounded-full" style={{ background: DOT[status] }} />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2 text-[13px]">
          <span className="truncate font-medium">{name}</span>
          <span className="flex-none text-[12px] text-muted">{s.word}</span>
        </p>
        {s.fix && <p className="mt-0.5 text-pretty text-[12px] leading-4 text-muted"><Inline text={s.fix} /></p>}
      </div>
      {tools !== null && tools > 0 && <span className="flex-none text-[12px] tabular-nums text-muted">{tools} {tools === 1 ? 'tool' : 'tools'}</span>}
    </li>
  )
}

const ago = (at: number, now: number): string => {
  const s = Math.max(0, Math.round((now - at) / 1000))
  return s < 5 ? 'just now' : s < 90 ? `${s} s ago` : `${Math.round(s / 60)} min ago`
}

/** Before a conversation (or beside it): ask Claude Code which servers are up. It health-checks them, so it can take many seconds. */
function McpCheck({ cwd }: { cwd: string | null }) {
  const mcp = useCaps((s) => s.mcp)
  const [now] = useState(() => Date.now())
  return (
    <div className="rounded-tile bg-well px-3 py-2.5">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[12px] leading-4 text-muted">
          {mcp.state === 'checking' ? 'Asking Claude Code. Each server is checked, which can take up to 20 seconds.' : 'Ask Claude Code which of your MCP servers are up right now.'}
        </p>
        {mcp.state === 'checking' ? (
          <Button size="sm" onClick={cancelMcp}>
            <LoaderCircle size={13} strokeWidth={2} className="animate-spin motion-reduce:animate-none" aria-hidden /> Cancel
          </Button>
        ) : (
          <Button size="sm" onClick={() => void checkMcp(cwd)}>
            <RotateCw size={13} strokeWidth={1.75} aria-hidden /> {mcp.state === 'idle' ? 'Check now' : 'Check again'}
          </Button>
        )}
      </div>
      {mcp.state === 'failed' && <p role="alert" className="mt-2 text-[12px] leading-4 text-[var(--failed-ink)]">{mcp.error}</p>}
      {mcp.state === 'done' && (
        <>
          <p className="t-meta mt-2 text-muted">
            Checked {mcp.result.cached ? `${ago(mcp.result.at, now)} (kept for a minute)` : 'just now'}
          </p>
          {mcp.result.servers.length === 0 ? (
            <p className="mt-1 text-[13px] text-muted">Claude Code has no MCP servers set up.</p>
          ) : (
            <ul className="mt-1 divide-y divide-rule">
              {mcp.result.servers.map((s) => (
                <ServerRow key={s.name} name={s.name} status={s.status} tools={null} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

const matches = (q: string, ...fields: string[]): boolean => !q || fields.some((f) => f.toLowerCase().includes(q))

function Names({ rows, q }: { rows: { name: string; detail: string; tag?: string }[]; q: string }) {
  const shown = rows.filter((r) => matches(q, r.name, r.detail))
  const MAX = 150
  return (
    <>
      <ul className="divide-y divide-rule">
        {shown.slice(0, MAX).map((r) => (
          <li key={r.name} className="flex items-baseline gap-2 py-1.5 text-[13px]">
            <span className="flex-none font-medium">{r.name}</span>
            {r.tag && <span className="flex-none text-[12px] text-muted">{r.tag}</span>}
            <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{r.detail}</span>
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p className="py-3 text-[13px] text-muted">{q ? 'Nothing matches.' : 'None loaded.'}</p>}
      {shown.length > MAX && <p className="t-meta pt-2 text-muted">{shown.length - MAX} more. Type to narrow the list.</p>}
    </>
  )
}

const commandRow = (c: CommandInfo) => ({ name: `/${c.name}`, detail: c.description, tag: c.hint })

/**
 * "What Claude can use here": the model in use, MCP servers (with status in words and the fix), skills, commands, agents and plugins, each
 * with a sentence of help. It shows this conversation's own list, or the last one seen, and can ask Claude Code about the servers.
 */
export function CapabilitiesButton({ caps, source, asked, cwd }: { caps: ConsoleCapabilities | null; source: 'this' | 'last'; asked: string | null; cwd: string | null }) {
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<TabId>('servers')
  const skills = caps?.commands.filter((c) => c.kind === 'skill') ?? []
  const commands = caps?.commands.filter((c) => c.kind === 'command') ?? []
  const servers = caps?.mcpServers ?? []
  const ready = servers.filter((s) => s.status === 'connected').length
  const counts: Record<TabId, number> = { servers: servers.length, skills: skills.length, commands: commands.length, agents: caps?.agents.length ?? 0, plugins: caps?.plugins.length ?? 0 }
  const q1 = q.trim().toLowerCase()

  const panel = (id: TabId, body: ReactNode) => (
    <Tabs.Content value={id} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 outline-none">
      <p className="text-pretty py-3 text-[13px] leading-5 text-muted">{HELP[id]}</p>
      {body}
    </Tabs.Content>
  )

  return (
    <Popover.Root onOpenChange={(o) => !o && setQ('')}>
      <Popover.Trigger asChild>
        <Button variant="quiet" aria-label="Capabilities: what Claude can use here">
          <Sparkles size={14} strokeWidth={1.75} aria-hidden /> Capabilities
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} collisionPadding={16} aria-label="What Claude can use here" className={cn(menuPanel, 'flex max-h-[min(78vh,640px)] w-[560px] max-w-[calc(100vw-32px)] flex-col p-0')}>
          <div className="flex-none px-4 pb-3 pt-4">
            <h3 className="t-heading">What Claude can use here</h3>
            <p className="mt-1 text-[13px] leading-5 text-muted">
              Model in use: <span className="font-medium text-ink">{caps?.model ?? 'not known yet'}</span>
              {asked !== null && asked !== caps?.model && <span> (asked for {modelLabel(asked)})</span>}
              {caps?.claudeVersion && <span> · Claude Code {caps.claudeVersion}</span>}
            </p>
            {source === 'last' && caps && <p className="t-meta mt-1 text-muted">From your last conversation. A new one reads its own list when it starts.</p>}
            {!caps && <p className="t-meta mt-1 text-muted">Nothing is loaded yet: a conversation shows what it can use as soon as it starts.</p>}
            <div className="relative mt-3 text-muted focus-within:text-ink">
              <Search size={14} strokeWidth={1.75} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search servers, skills, commands, agents"
                aria-label="Search what Claude can use"
                className="h-8 w-full rounded-full bg-well pl-8 pr-8 text-[13px] text-ink outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent"
              />
              {q && (
                <button type="button" aria-label="Clear search" onClick={() => setQ('')} className="press absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full hover:bg-active">
                  <X size={13} strokeWidth={1.75} />
                </button>
              )}
            </div>
          </div>
          <Tabs.Root value={tab} onValueChange={(v) => setTab(v as TabId)} className="flex min-h-0 flex-1 flex-col">
            <Tabs.List aria-label="Groups" className={cn(segList, 'mx-4 max-w-full flex-none flex-wrap rounded-2xl')}>
              {(Object.keys(HELP) as TabId[]).map((id) => (
                <Tabs.Trigger key={id} value={id} className={cn(segTab, 'inline-flex items-center gap-1.5 px-2.5 capitalize')}>
                  {id}
                  <CountBadge n={counts[id]} label={id} />
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            {panel(
              'servers',
              <div className="space-y-3">
                {servers.length > 0 && <p className="t-meta text-muted">{ready} of {servers.length} ready{source === 'last' ? ', as of your last conversation' : ''}</p>}
                <ul className="divide-y divide-rule">
                  {servers.filter((s: McpServerInfo) => matches(q1, s.name, MCP_STATUS[s.status].word)).map((s) => (
                    <ServerRow key={s.name} name={s.name} status={s.status} tools={s.tools} />
                  ))}
                </ul>
                {servers.length === 0 && <p className="text-[13px] text-muted">No servers reported yet.</p>}
                {source !== 'this' && <McpCheck cwd={cwd} />}
                <p className="t-meta text-pretty text-muted">
                  Adding or removing a server is done in Claude Code: run <Inline text="`claude mcp add`" /> in a terminal. AgentDeck only shows them.
                </p>
              </div>
            )}
            {panel('skills', <Names q={q1} rows={skills.map(commandRow)} />)}
            {panel(
              'commands',
              <>
                <Names q={q1} rows={commands.map(commandRow)} />
                {caps && caps.terminalOnly.length > 0 && (
                  <p className="t-meta text-pretty pt-3 text-muted">Only in the interactive terminal, so not available here: {caps.terminalOnly.map((c) => `/${c}`).join(', ')}.</p>
                )}
              </>
            )}
            {panel('agents', <Names q={q1} rows={(caps?.agents ?? []).map((a) => ({ name: a.name, detail: a.description }))} />)}
            {panel('plugins', <Names q={q1} rows={(caps?.plugins ?? []).map((p) => ({ name: p.name, detail: p.version ? `version ${p.version}` : '' }))} />)}
          </Tabs.Root>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
