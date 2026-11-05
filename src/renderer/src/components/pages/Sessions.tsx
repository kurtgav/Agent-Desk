import { useState } from 'react'
import { SNAPSHOT_SESSIONS_MAX, type Session, type Status, type Surface } from '@shared/snapshot'
import { pathKey } from '@shared/paths'
import { useUi, type Nav } from '@/store'
import { ago } from '@/lib/format'
import { projectName, recentProjects, recentSessions } from '@/lib/selectors'
import { Avatar } from '../Avatar'
import { SURFACE } from '../SessionDrawer'
import { Card, CardHeader, Inline, StatusPill } from '../ui'
import { Choice, Empty, PageFrame, Segmented } from './Page'

type StatusFilter = 'all' | 'active' | Status
const STATUS_OPTIONS: [StatusFilter, string][] = [
  ['all', 'All'],
  ['active', 'Active'],
  ['needs_you', 'Needs you'],
  ['failed', 'Failed'],
  ['done', 'Done'],
  ['idle', 'Idle']
]
const ALL = 'all'

function matches(s: Session, status: StatusFilter, surface: Surface | typeof ALL, project: string): boolean {
  const okStatus = status === 'all' || (status === 'active' ? s.status === 'working' || s.status === 'needs_you' : s.status === status)
  return okStatus && (surface === ALL || s.surface === surface) && (project === ALL || pathKey(s.cwd) === project)
}

function Row({ session, now }: { session: Session; now: number }) {
  const open = useUi((s) => s.openDrawer)
  return (
    <li className="border-t border-rule px-4 py-[9px]">
      {/* As in Running now: the name is the button and its ::after covers the row. */}
      <div className="relative -mx-2 flex items-center gap-3 rounded-tile px-2 has-[button:hover]:bg-ground">
        <Avatar seed={session.name} size={28} className="flex-none" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium leading-5">
            <button type="button" onClick={() => open(session.id)} className="text-left outline-none after:absolute after:inset-0 after:rounded-tile focus-visible:after:ring-2 focus-visible:after:ring-accent">
              {session.name}
            </button>
          </p>
          <p className="truncate text-[12px] leading-4 text-muted">
            <Inline text={session.activity} /> · {projectName(session.cwd) || 'Folder unknown'} · {SURFACE[session.surface]}
          </p>
        </div>
        <span className="flex-none text-[12px] tabular-nums text-muted">{ago(now - session.lastEventAt)}</span>
        <StatusPill status={session.status} />
      </div>
    </li>
  )
}

/** UI_MAP § Sidebar › Sessions: every session the snapshot holds, filtered by status, surface and project. */
export function SessionsPage({ nav }: { nav: Nav }) {
  const snapshot = useUi((s) => s.snapshot)
  const now = useUi((s) => s.now)
  const [status, setStatus] = useState<StatusFilter>(nav.active ? 'active' : 'all')
  const [surface, setSurface] = useState<Surface | typeof ALL>(ALL)
  const [project, setProject] = useState(nav.project ? pathKey(nav.project) : ALL)
  const sessions = recentSessions(snapshot, snapshot.sessions.length).filter((s) => matches(s, status, surface, project))
  const surfaces = [...new Set(snapshot.sessions.map((s) => s.surface))]
  const projects = recentProjects(snapshot, snapshot.sessions.length)
  return (
    <PageFrame page="sessions" lede={`Live sessions and the ones that ended this week, the newest ${SNAPSHOT_SESSIONS_MAX} by last activity.`}>
      <Card aria-labelledby="sessions-list">
        <CardHeader id="sessions-list" title="Sessions" count={sessions.length} countLabel="shown" />
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          <Segmented<StatusFilter> label="Status" value={status} options={STATUS_OPTIONS} onChange={setStatus} />
          <Choice<Surface | typeof ALL> label="Surface" value={surface} options={[[ALL, 'All'], ...surfaces.map((s): [Surface, string] => [s, SURFACE[s]])]} onChange={setSurface} />
          <Choice label="Project" value={project} options={[[ALL, 'All'], ...projects.map((p): [string, string] => [pathKey(p.cwd), p.name])]} onChange={setProject} />
        </div>
        {sessions.length ? (
          <ul>
            {sessions.map((s) => (
              <Row key={s.id} session={s} now={now} />
            ))}
          </ul>
        ) : (
          <Empty>{snapshot.sessions.length ? 'No session matches these filters.' : 'No sessions this week. Start one in a terminal or with New task.'}</Empty>
        )}
      </Card>
    </PageFrame>
  )
}
