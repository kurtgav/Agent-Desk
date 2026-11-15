import { useEffect, useMemo, useState } from 'react'
import { suggestRoles } from '@shared/role-search'
import type { RoleHit } from '@shared/roles'
import { RoleEmoji } from '../roles/RoleEmoji'
import { Hint } from '../ui'
import { createSuggester, longEnough } from './suggest'
import type { RoleIndex } from './useRoleIndex'

export const SUGGEST_DELAY_MS = 250
export const SUGGEST_SHOWN = 3
/** Ask for more than is shown: some will already be in the message. */
const SUGGEST_ASK = 8
const NONE: RoleHit[] = []

const sameHits = (a: readonly RoleHit[], b: readonly RoleHit[]): boolean => a.length === b.length && a.every((h, i) => h.id === b[i]!.id)

/**
 * Up to three agents that fit what is being typed: ranked over the roles' descriptions (shared/role-search.ts, no model, no network),
 * held for a quarter second after the last key, and dropped when newer text has come. The last suggestions stay until the new ones
 * arrive, so the row does not flash on every key; an unchanged answer changes nothing.
 */
export function useSuggestions(text: string, enabled: boolean, index: RoleIndex, exclude: readonly string[]): RoleHit[] {
  const [hits, setHits] = useState<RoleHit[]>(NONE)
  const suggester = useMemo(
    () =>
      createSuggester<RoleHit[]>({
        delayMs: SUGGEST_DELAY_MS,
        eligible: longEnough,
        run: async (t) => suggestRoles(index.roles, t, SUGGEST_ASK),
        onResult: (v) => setHits((prev) => (sameHits(prev, v ?? NONE) ? prev : (v ?? NONE)))
      }),
    [index]
  )
  useEffect(() => () => suggester.cancel(), [suggester])
  useEffect(() => {
    if (enabled) suggester.push(text)
    else {
      suggester.cancel()
      setHits((prev) => (prev.length ? NONE : prev))
    }
  }, [suggester, enabled, text])
  return enabled ? hits.filter((h) => !exclude.includes(h.id)).slice(0, SUGGEST_SHOWN) : NONE
}

/** The suggestions as chips: one click writes the mention. The reason is on hover and on focus ("matched: database, queries"). */
export function Suggestions({ hits, index, onPick, label = 'Suggested agents' }: { hits: readonly RoleHit[]; index: RoleIndex; onPick(id: string): void; label?: string }) {
  const shown = hits.flatMap((h) => {
    const role = index.get(h.id)
    return role ? [{ role, why: h.matched.length ? `matched: ${h.matched.join(', ')}` : 'matches your words' }] : []
  })
  if (shown.length === 0) return null
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span className="t-meta text-muted">Suggested</span>
      {shown.map(({ role, why }) => (
        <Hint key={role.id} label={why}>
          <button
            type="button"
            aria-label={`Add ${role.name} (${why})`}
            onClick={() => onPick(role.id)}
            className="press anim-fade inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface pl-1 pr-2.5 text-[13px] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent"
          >
            <RoleEmoji role={role} size={20} />
            <span className="max-w-36 truncate">{role.name}</span>
          </button>
        </Hint>
      ))}
    </div>
  )
}
