import { useRef, useState } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { Ellipsis, Pin, Plus } from 'lucide-react'
import { SNAPSHOT_SESSIONS_MAX, type Session, type Status, type Surface } from '@shared/snapshot'
import { pathKey } from '@shared/paths'
import { useUi, type Nav } from '@/store'
import { ago } from '@/lib/format'
import { projectName, recentProjects, recentSessions } from '@/lib/selectors'
import { groupSessions, isArchived, noteOf, shownIn, type SessionGroup } from '@/lib/sessionMeta'
import { Avatar } from '../Avatar'
import { SURFACE } from '../session/labels'
import { useDialogs } from '../session-menu/dialogStore'
import { useDisplayName } from '../session-menu/hooks'
import { Marks } from '../session-menu/Marks'
import { MoreButton, SessionMenu } from '../session-menu/SessionMenu'
import { Button, CountBadge, Hint, IconButton, Inline, StatusPill, cn, menuItem, menuPanel } from '../ui'
import { Choice, PageFrame, Segmented } from './Page'
import { ColumnHead, ListCard, ResultCount, StateNote, plain } from './kit'

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
/** The Section filter: every session, the ones in no section, or one section (`section:<name>`). */
const NO_SECTION = 'none'
const inSectionFilter = (name: string): string => `section:${name}`
/** The Archived filter: archived sessions stay out of the list, join it, or are all it shows. */
type ArchivedFilter = 'hidden' | 'included' | 'only'
const ARCHIVED_OPTIONS: [ArchivedFilter, string][] = [
  ['hidden', 'Hidden'],
  ['included', 'Included'],
  ['only', 'Only archived']
]

/** Agent and what it is doing, project, surface, last activity, status, and the ⋯ button: the heads and every row share this grid. */
const GRID = 'grid grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_104px_92px_96px_32px]'
/** A session that waits on you or failed gets a quiet edge in its status colour, so those rows are found without reading. */
const EDGE: Partial<Record<Status, string>> = { needs_you: 'var(--needs)', failed: 'var(--failed)' }

function matches(s: Session, status: StatusFilter, surface: Surface | typeof ALL, project: string): boolean {
  const okStatus = status === 'all' || (status === 'active' ? s.status === 'working' || s.status === 'needs_you' : s.status === status)
  return okStatus && (surface === ALL || s.surface === surface) && (project === ALL || pathKey(s.cwd) === project)
}

function Row({ session, now }: { session: Session; now: number }) {
  const open = useUi((s) => s.openSession)
  const name = useDisplayName(session)
  const project = projectName(session.cwd)
  const edge = EDGE[session.status]
  return (
    <SessionMenu session={session}>
      <li className="relative border-t border-rule px-2 py-1">
        {edge && <span aria-hidden className="absolute inset-y-3 left-[5px] w-[3px] rounded-full" style={{ background: edge }} />}
        <div className={`${GRID} items-center gap-x-4 rounded-lg px-2 py-1.5 transition-[background-color] duration-150 has-[button:hover]:bg-hover group-data-[state=open]:bg-hover`}>
          <div className="flex min-w-0 items-center gap-3">
            <Avatar seed={session.name} size={28} className="flex-none" />
            <div className="min-w-0">
              {/* The name is the button and its ::after covers the row, as in Running now. */}
              <p className="truncate text-[14px] font-medium leading-5">
                <button type="button" onClick={() => open(session.id)} className="text-left outline-none after:absolute after:inset-x-2 after:inset-y-1 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-accent">
                  {name}
                </button>
                <Marks id={session.id} />
              </p>
              <p className="truncate text-[12px] leading-4 text-muted" title={plain(session.activity)}>
                <Inline text={session.activity} />
              </p>
            </div>
          </div>
          <p className={`truncate text-[13px] ${project ? '' : 'text-muted'}`} title={session.cwd || undefined}>
            {project || 'Folder unknown'}
          </p>
          <p className="truncate text-[13px] text-muted">{SURFACE[session.surface]}</p>
          <p className="text-[12px] tabular-nums text-muted">{ago(now - session.lastEventAt)}</p>
          <span className="justify-self-end">
            <StatusPill status={session.status} />
          </span>
          <MoreButton session={session} className="-my-1 justify-self-end" />
        </div>
      </li>
    </SessionMenu>
  )
}

/** A section's heading, and for one of the user's own sections the menu that renames or deletes it (its sessions only leave it). */
function GroupHeader({ group, id }: { group: SessionGroup; id: string }) {
  const show = useDialogs((s) => s.show)
  // The menu's own button, remembered when the menu opens, gets focus back after a dialog it opened closes.
  const trigger = useRef<HTMLElement | null>(null)
  const mine = group.kind === 'section' ? group.title : null
  return (
    <header className="flex h-9 items-center gap-2 border-t border-rule px-4 first:border-t-0">
      {group.kind === 'pinned' && <Pin size={13} strokeWidth={1.75} className="text-muted" aria-hidden />}
      <h3 id={id} className={cn('t-label', group.kind === 'rest' ? 'text-muted' : 'text-ink')}>
        {group.title}
      </h3>
      <CountBadge n={group.sessions.length} label="sessions" />
      {mine && (
        <Menu.Root onOpenChange={(open) => open && (trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null)}>
          <Hint label="Rename or delete this section">
            <Menu.Trigger asChild>
              <IconButton aria-label={`Actions for section ${mine}`} className="-mr-2 ml-auto size-7">
                <Ellipsis size={16} strokeWidth={1.75} />
              </IconButton>
            </Menu.Trigger>
          </Hint>
          <Menu.Portal>
            <Menu.Content align="end" sideOffset={6} className={cn(menuPanel, 'min-w-44')} onCloseAutoFocus={(e) => useDialogs.getState().dialog && e.preventDefault()}>
              <Menu.Item className={menuItem} onSelect={() => show({ kind: 'rename-section', section: mine }, trigger.current)}>
                Rename section…
              </Menu.Item>
              <Menu.Item className={cn(menuItem, 'text-[var(--failed-ink)] data-[highlighted]:bg-[var(--failed-bg)]')} onSelect={() => show({ kind: 'delete-section', section: mine }, trigger.current)}>
                Delete section…
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      )}
    </header>
  )
}

function Group({ group, now, index }: { group: SessionGroup; now: number; index: number }) {
  const id = `sessions-group-${index}`
  return (
    <section aria-labelledby={group.title ? id : undefined}>
      {group.title !== null && <GroupHeader group={group} id={id} />}
      {group.sessions.length ? (
        <ul className="pb-1">
          {group.sessions.map((s) => (
            <Row key={s.id} session={s} now={now} />
          ))}
        </ul>
      ) : (
        <p className="border-t border-rule px-4 py-3 text-[13px] text-muted">No sessions here. Use Move to section on a session’s menu.</p>
      )}
    </section>
  )
}

/** UI_MAP § Sidebar › Sessions: every session the snapshot holds, filtered by status, surface and project, grouped by the user's sections. */
export function SessionsPage({ nav }: { nav: Nav }) {
  const snapshot = useUi((s) => s.snapshot)
  const now = useUi((s) => s.now)
  const meta = useUi((s) => s.sessionMeta)
  const [status, setStatus] = useState<StatusFilter>(nav.active ? 'active' : 'all')
  const [surface, setSurface] = useState<Surface | typeof ALL>(ALL)
  const [project, setProject] = useState(nav.project ? pathKey(nav.project) : ALL)
  const [section, setSection] = useState(ALL)
  const [archived, setArchived] = useState<ArchivedFilter>('hidden')
  const sectionFilter = section === ALL || section === NO_SECTION || meta.sections.some((n) => inSectionFilter(n) === section) ? section : ALL
  const everything = recentSessions(snapshot, snapshot.sessions.length)
  const sessions = everything.filter((s) => {
    const off = isArchived(meta, s.id)
    if (archived === 'only' ? !off : archived === 'hidden' && !shownIn('sessions', s, meta)) return false
    const filed = noteOf(meta, s.id)?.section
    const okSection = sectionFilter === ALL || (sectionFilter === NO_SECTION ? filed === undefined : inSectionFilter(filed ?? '') === sectionFilter)
    return okSection && matches(s, status, surface, project)
  })
  const surfaces = [...new Set(snapshot.sessions.map((s) => s.surface))]
  const projects = recentProjects(snapshot, snapshot.sessions.length)
  const anyArchived = everything.some((s) => isArchived(meta, s.id))
  // A section with nothing in it still shows (so it can be renamed or deleted), unless a filter is narrowing the list.
  const narrowed = status !== 'all' || surface !== ALL || project !== ALL || sectionFilter !== ALL || archived !== 'hidden'
  const groups = groupSessions(sessions, meta).filter((g) => g.sessions.length > 0 || (g.kind === 'section' && !narrowed))
  return (
    <PageFrame
      page="sessions"
      lede={`Live sessions and the ones that ended this week, the newest ${SNAPSHOT_SESSIONS_MAX} by last activity.`}
      filters={
        <>
          <Segmented<StatusFilter> label="Status" value={status} options={STATUS_OPTIONS} onChange={setStatus} />
          <Choice<Surface | typeof ALL> label="Surface" value={surface} options={[[ALL, 'All'], ...surfaces.map((s): [Surface, string] => [s, SURFACE[s]])]} onChange={setSurface} />
          <Choice label="Project" value={project} options={[[ALL, 'All'], ...projects.map((p): [string, string] => [pathKey(p.cwd), p.name])]} onChange={setProject} />
          {meta.sections.length > 0 && (
            <Choice
              label="Section"
              value={sectionFilter}
              options={[[ALL, 'All'], ...meta.sections.map((n): [string, string] => [inSectionFilter(n), n]), [NO_SECTION, 'No section']]}
              onChange={setSection}
            />
          )}
          {(anyArchived || archived !== 'hidden') && <Choice<ArchivedFilter> label="Archived" value={archived} options={ARCHIVED_OPTIONS} onChange={setArchived} />}
          <ResultCount n={sessions.length} one="session" many="sessions" />
        </>
      }
      actions={
        <Button onClick={() => useDialogs.getState().show({ kind: 'new-section', sessionId: null }, document.activeElement instanceof HTMLElement ? document.activeElement : null)}>
          <Plus size={14} strokeWidth={1.75} />
          New section
        </Button>
      }
    >
      <ListCard label="Sessions">
        {sessions.length || groups.length ? (
          <>
            <ColumnHead grid={GRID}>
              <span className="pl-10">Session</span>
              <span>Project</span>
              <span>Surface</span>
              <span>Last activity</span>
              <span className="justify-self-end">Status</span>
              <span />
            </ColumnHead>
            {groups.map((g, i) => (
              <Group key={g.key} group={g} now={now} index={i} />
            ))}
          </>
        ) : snapshot.sessions.length ? (
          <StateNote title="No session matches these filters">Try another status, surface, project or section.</StateNote>
        ) : (
          <StateNote title="No sessions this week">Start one in a terminal or with New task.</StateNote>
        )}
      </ListCard>
    </PageFrame>
  )
}
