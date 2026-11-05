import { useEffect, useState } from 'react'
import type { AgentDef } from '@shared/bridge'
import { pathKey } from '@shared/paths'
import { useUi, type Nav } from '@/store'
import { loadAgents } from '@/lib/act'
import { projectName, recentProjects } from '@/lib/selectors'
import { Avatar } from '../Avatar'
import { focusComposer } from '../Sidebar'
import { Button, Card, CardHeader } from '../ui'
import { Empty, PageFrame, SearchBox } from './Page'

/** A definition and where it lives: `~/.claude/agents`, or one recent project's `.claude/agents`. */
type Listed = AgentDef & { cwd: string | null; where: string }

/** User definitions once, plus each recent project's own (sub-agents § Choose the subagent scope). Read when the page opens. */
function useCatalog(): Listed[] | null {
  const snapshot = useUi((s) => s.snapshot)
  // Sorted, so a change in which of the five is most recent doesn't re-read them; only a different set does.
  const key = recentProjects(snapshot, 5)
    .map((p) => p.cwd)
    .sort((a, b) => pathKey(a).localeCompare(pathKey(b)))
    .join('|')
  const [got, setGot] = useState<Listed[] | null>(null)
  useEffect(() => {
    let current = true
    const cwds = key ? key.split('|') : []
    void Promise.all([loadAgents(null), ...cwds.map((cwd) => loadAgents(cwd))]).then(([user = [], ...perProject]) => {
      if (!current) return
      const list: Listed[] = [
        ...user.map((a) => ({ ...a, cwd: null, where: 'User' })),
        ...perProject.flatMap((defs, i) => defs.filter((a) => a.scope === 'project').map((a) => ({ ...a, cwd: cwds[i]!, where: projectName(cwds[i]!) })))
      ]
      setGot(list.sort((a, b) => a.name.localeCompare(b.name)))
    })
    return () => {
      current = false
    }
  }, [key])
  return got // the previous list stays on screen while a new set of projects is read
}

/** UI_MAP § Sidebar › All agents: your subagent definitions, read-only. "Start a task" picks one in the composer. */
export function AgentsPage({ nav }: { nav: Nav }) {
  const catalog = useCatalog()
  const [q, setQ] = useState(nav.query ?? '')
  const needle = q.trim().toLowerCase()
  const shown = (catalog ?? []).filter((a) => !needle || a.name.toLowerCase().includes(needle) || a.description.toLowerCase().includes(needle))
  const start = (a: Listed): void => {
    const ui = useUi.getState()
    ui.setComposerAgent(a.name)
    if (a.cwd) ui.setComposerCwd(a.cwd) // a project's agent runs in that project
    focusComposer()
  }
  return (
    <PageFrame page="agents" lede="Subagents defined in ~/.claude/agents and in your recent projects' .claude/agents. Read-only.">
      <Card aria-labelledby="agents-list">
        <CardHeader id="agents-list" title="Subagents" count={catalog ? shown.length : undefined} countLabel="shown" action={<SearchBox label="Filter subagents" value={q} onChange={setQ} />} />
        {catalog === null ? (
          <Empty>Reading subagent definitions…</Empty>
        ) : shown.length ? (
          <ul>
            {shown.map((a) => (
              <li key={`${a.cwd ?? ''}/${a.name}`} className="flex items-center gap-3 border-t border-rule px-4 py-2.5">
                <Avatar seed={a.name} size={28} className="flex-none" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-[14px] font-medium leading-5">
                    <span className="truncate">{a.name}</span>
                    <span className="flex-none rounded-md bg-well px-1.5 text-[12px] font-normal text-muted">{a.where}</span>
                    {a.model && <span className="flex-none rounded-md bg-well px-1.5 text-[12px] font-normal text-muted">{a.model}</span>}
                  </p>
                  {a.description && <p className="line-clamp-2 text-pretty text-[12px] leading-4 text-muted">{a.description}</p>}
                </div>
                <Button variant="ghost" size="sm" aria-label={`Start a task with ${a.name}`} onClick={() => start(a)}>
                  Start a task
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          // The sidebar lists subagents by the type sessions ran, which includes built-ins (Explore, Plan) with no file.
          <Empty>{catalog.length ? `No definition file matches “${q.trim()}”. Subagents built into Claude Code, such as Explore and Plan, have none.` : 'No subagent definitions found.'}</Empty>
        )}
      </Card>
    </PageFrame>
  )
}
