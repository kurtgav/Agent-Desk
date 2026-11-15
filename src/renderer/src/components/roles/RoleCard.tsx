import { CircleCheck, Pin } from 'lucide-react'
import { SOURCE_LABEL, type RoleSummary } from '@shared/roles'
import { Hint, Tag, cn } from '../ui'
import { RoleEmoji } from './RoleEmoji'

/**
 * What a card says: name first, then the one-liner, then two lines of what it does, then where it comes from. The same face is the
 * card on the page and the live preview in the create form.
 */
export function CardFace({ role, showDivision, matched, descId }: { role: RoleSummary; showDivision: boolean; matched?: string[]; descId?: string }) {
  return (
    <>
      <span className="flex items-start gap-3">
        <RoleEmoji role={role} size={40} />
        <span className="min-w-0 flex-1">
          <span className="t-title block truncate pr-8">{role.name || 'Untitled role'}</span>
          <span className="t-meta line-clamp-2 text-muted">{role.vibe || role.divisionLabel}</span>
        </span>
      </span>
      <span id={descId} className="line-clamp-2 text-pretty text-[13px] leading-5 text-muted">
        {role.description || 'No description.'}
      </span>
      <span className="mt-auto flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1">
        <Tag>{SOURCE_LABEL[role.source]}</Tag>
        {showDivision && role.source !== 'custom' && role.source !== 'builtin' && <span className="t-meta truncate text-muted">{role.divisionLabel}</span>}
        {role.installed && role.source !== 'installed' && (
          <span className="t-meta inline-flex items-center gap-1 text-[var(--done-ink)]">
            <CircleCheck size={13} strokeWidth={1.75} aria-hidden />
            Installed
          </span>
        )}
      </span>
      {matched && matched.length > 0 && <span className="t-meta -mt-1 truncate text-muted">{`matched: ${matched.join(', ')}`}</span>}
    </>
  )
}

export interface RoleCardProps {
  role: RoleSummary
  pinned: boolean
  /** The one card in the page that is a tab stop (arrow keys move it). */
  active: boolean
  /** The words that found it, under a search. */
  matched?: string[]
  /** The division is shown on the card when the list mixes divisions. */
  showDivision: boolean
  onOpen(): void
  onPin(): void
}

/**
 * One role. The whole card opens its detail; the pin is a second button in its corner, visible when pinned, pointed at or focused.
 * Flat on the surface with a hairline, like every card in the app.
 */
export function RoleCard({ role, pinned, active, matched, showDivision, onOpen, onPin }: RoleCardProps) {
  const descId = `role-desc-${role.id}`
  return (
    <li className="group relative">
      <button
        type="button"
        data-role-card={role.id}
        tabIndex={active ? 0 : -1}
        aria-describedby={descId}
        aria-keyshortcuts="P"
        onClick={onOpen}
        className="flex h-full min-h-[168px] w-full flex-col gap-3 rounded-card border border-line bg-surface p-4 text-left transition-[border-color,background-color] duration-150 hover:border-control hover:bg-hover"
      >
        <CardFace role={role} showDivision={showDivision} matched={matched} descId={descId} />
      </button>
      <Hint label={pinned ? 'Unpin' : 'Pin to the top (P)'} side="top">
        <button
          type="button"
          tabIndex={active ? 0 : -1}
          aria-pressed={pinned}
          aria-label={`${pinned ? 'Unpin' : 'Pin'} ${role.name}`}
          onClick={onPin}
          className={cn(
            'press absolute right-2.5 top-2.5 flex size-8 items-center justify-center rounded-full outline-none transition-opacity focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent group-focus-within:opacity-100 group-hover:opacity-100',
            pinned ? 'text-accent opacity-100' : 'text-muted opacity-0 hover:bg-active hover:text-ink'
          )}
        >
          <Pin size={15} strokeWidth={1.75} className={pinned ? 'fill-current' : undefined} aria-hidden />
        </button>
      </Hint>
    </li>
  )
}
