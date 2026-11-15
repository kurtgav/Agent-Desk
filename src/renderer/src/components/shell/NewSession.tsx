import { ArrowRight, CircleCheck, Compass, FlaskConical, GitCompare, type LucideIcon } from 'lucide-react'
import { useUi } from '@/store'
import { shortAgo, listable, type SessionEntry } from '@/lib/sessionList'
import { greeting } from '@/lib/profile'
import { needsOkCount } from '@/lib/selectors'
import { Avatar } from '../Avatar'
import { NeedsYou } from '../NeedsYou'
import { STARTERS } from '../console/options'
import { NEW, focusComposer, setText } from '../console/store'
import { ComposerSlot } from './ComposerSlot'
import { StatusMark } from './StatusMark'
import { useEntries } from './useEntries'
import { useRoleIndex } from './useRoleIndex'
import { Skeleton } from '../ui'

const RECENT_SHOWN = 5
const ICON: LucideIcon[] = [Compass, FlaskConical, GitCompare]

/** Three ways to begin for someone with no sessions yet: they fill the box, nothing is sent. */
function Starters() {
  return (
    <ul className="mt-2 grid gap-2" aria-label="Ways to begin">
      {STARTERS.map((s, i) => {
        const I = ICON[i]!
        return (
          <li key={s.title}>
            <button
              type="button"
              onClick={() => {
                setText(NEW, s.prompt)
                focusComposer()
              }}
              className="press group flex w-full items-center gap-3 rounded-tile border border-line bg-surface px-4 py-3 text-left hover:bg-hover"
            >
              <span className="grid size-8 flex-none place-items-center rounded-lg bg-well text-muted">
                <I size={16} strokeWidth={1.75} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="t-label block">{s.title}</span>
                <span className="block text-[13px] leading-5 text-muted">{s.detail}</span>
              </span>
              <ArrowRight size={15} strokeWidth={1.75} aria-hidden className="flex-none text-muted transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function Recent({ entries, now }: { entries: SessionEntry[]; now: number }) {
  const open = useUi((s) => s.openSession)
  const roles = useRoleIndex()
  return (
    <ul className="mt-1.5 flex flex-col" aria-label="Recent sessions">
      {entries.map((e) => (
        <li key={e.key} className="border-t border-rule first:border-t-0">
          <button type="button" onClick={() => open(e.key)} className="press flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent">
            <Avatar seed={e.session.name} size={28} className="flex-none" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className={e.unread ? 'truncate text-[14px] font-semibold' : 'truncate text-[14px] font-medium'}>{e.name}</span>
                {e.role && roles.get(e.role) && <span aria-label={roles.get(e.role)!.name} className="flex-none text-[13px] leading-none">{roles.get(e.role)!.emoji}</span>}
              </span>
              <span className="block truncate text-[12px] leading-4 text-muted">
                {e.project || 'No folder'}
                {e.origin === 'watching' ? ' · Watching' : ''} · {e.session.activity.replaceAll('`', '')}
              </span>
            </span>
            <StatusMark status={e.session.status} />
            <span className="w-8 flex-none text-right text-[12px] tabular-nums text-muted">{shortAgo(e.at, now)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * The new session screen, what opens on launch and on Ctrl+N (IA § 5): one composer, then the agents suggested from what you type,
 * then whether anything needs you, then the sessions you were last in. The Needs-you list itself lives in the sidebar, so it is not
 * drawn twice; this screen says "Everything is calm" when nothing waits, and points at the sidebar when something does.
 */
export function NewSession() {
  const name = useUi((s) => s.profile.name)
  const now = useUi((s) => s.now)
  const link = useUi((s) => s.link)
  const collapsed = useUi((s) => s.sidebarCollapsed)
  const waiting = useUi((s) => needsOkCount(s.snapshot) + s.snapshot.attention.filter((a) => a.priority > 1).length)
  const meta = useUi((s) => s.sessionMeta)
  const entries = useEntries()
  const recent = listable(entries, meta).slice(0, RECENT_SHOWN)

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col px-8 pb-10 pt-[clamp(32px,9vh,96px)]">
      <h1 className="t-display text-balance [overflow-wrap:anywhere]">{greeting(new Date(now).getHours(), name)}</h1>
      <p className="mt-1.5 text-pretty text-[15px] leading-6 text-muted">What should Claude work on? Describe it below. Pick an agent from the sidebar, or type @ to mention one.</p>

      {/* The composer is its own card here (with its suggested agents under it, and Advanced inside it). */}
      <div className="mt-6">
        <ComposerSlot variant="new" />
      </div>

      <div className="mt-8">
        {waiting > 0 ? (
          collapsed ? (
            <NeedsYou />
          ) : (
            <p role="status" className="flex items-center gap-2 text-[13px] text-muted">
              <span aria-hidden className="size-2 rounded-full" style={{ background: 'var(--needs)' }} />
              {waiting === 1 ? '1 thing needs you' : `${waiting} things need you`}, in the sidebar.
            </p>
          )
        ) : (
          link === 'up' && (
            <p role="status" className="flex items-center gap-2 text-[13px] text-muted">
              <CircleCheck size={15} strokeWidth={1.75} aria-hidden className="text-[var(--done)]" />
              Everything is calm. Nothing needs you right now.
            </p>
          )
        )}
      </div>

      <section aria-labelledby="recent-sessions" className="mt-6">
        <h2 id="recent-sessions" className="text-[12px] font-medium text-muted">
          Recent sessions
        </h2>
        {link === 'connecting' && recent.length === 0 ? (
          <div role="status" aria-label="Loading sessions" className="mt-2 flex flex-col gap-2">
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </div>
        ) : recent.length ? (
          <Recent entries={recent} now={now} />
        ) : (
          <Starters />
        )}
      </section>
    </div>
  )
}
