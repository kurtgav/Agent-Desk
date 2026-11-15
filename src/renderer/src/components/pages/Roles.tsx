import { useEffect, useRef, useState } from 'react'
import { Plus, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react'
import type { RoleDetail, RoleSummary } from '@shared/roles'
import { useUi, type Nav } from '@/store'
import { Button, Hint, IconButton, Kbd, Skeleton, cn } from '../ui'
import { DivisionRail, type RailChoice } from '../roles/DivisionRail'
import { ALL_ROLES, applyView, sectionsFor, type InstallFilter, type RolesView } from '../roles/logic'
import { RoleBrowser } from '../roles/RoleBrowser'
import { RoleDrawer } from '../roles/RoleDrawer'
import { RoleForm } from '../roles/RoleForm'
import { RepoSetup, SourcesDialog } from '../roles/Sources'
import { useRolesCatalog, useRolesStore } from '../roles/store'
import { PageFrame } from './Page'
import { ResultCount, StateNote } from './kit'

type FormMode = { kind: 'create' } | { kind: 'edit'; role: RoleDetail } | null

const INSTALL_CHIPS: [InstallFilter, string][] = [
  ['installed', 'Installed in Claude Code'],
  ['not-installed', 'Not installed']
]

const railChoice = (v: RolesView): RailChoice => (v.pinnedOnly ? { kind: 'pinned' } : v.division ? { kind: 'division', id: v.division } : { kind: 'all' })

/** A filter you turn on or off: pressed is filled, like the drawer's segmented tabs. */
function Chip({ pressed, onClick, children }: { pressed: boolean; onClick(): void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'press h-7 rounded-full border px-3 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent',
        pressed ? 'border-transparent bg-active text-ink' : 'border-control bg-surface text-muted hover:text-ink'
      )}
    >
      {children}
    </button>
  )
}

/**
 * UI_MAP § Sidebar › Roles: every persona a conversation or task can take on. A division rail on the left, a big search on top
 * (a name, a title like "cto", or a task in plain words), a grid of role cards, and one drawer for the detail.
 */
export function RolesPage({ nav }: { nav: Nav }) {
  const { catalog, phase, refreshing } = useRolesCatalog()
  const [query, setQuery] = useState(nav.query ?? '')
  const [view, setView] = useState<Omit<RolesView, 'query'>>({ division: null, pinnedOnly: false, install: 'any' })
  const [open, setOpen] = useState<string | null>(nav.role ?? null)
  const [form, setForm] = useState<FormMode>(null)
  const [sources, setSources] = useState(false)
  /** The exact set of roles whose "add as skills" (or remove) waits for a confirm, or is running. */
  const [bulk, setBulk] = useState<{ key: string; busy: boolean } | null>(null)
  /** Where focus goes on the next render: Cancel when the confirm opens, the trigger when it closes. Spent by that render. */
  const focusTo = useRef<'confirm' | 'trigger' | null>(null)
  useEffect(() => {
    focusTo.current = null
  })
  const search = useRef<HTMLInputElement>(null)

  // "/" jumps to the search from anywhere on the page that is not a field or a dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]')) return
      e.preventDefault()
      search.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!catalog) {
    return (
      <PageFrame page="roles" lede="Personas a conversation or task can take on, read from files on this PC.">
        {phase === 'error' ? (
          <div className="rounded-card border border-line bg-surface">
            <StateNote tone="error" title="AgentDeck could not read its roles">
              Something stopped the read. Try again; your roles are files on this PC and nothing was changed.
            </StateNote>
            <div className="flex justify-center pb-6">
              <Button onClick={() => void useRolesStore.getState().load()}>Try again</Button>
            </div>
          </div>
        ) : (
          <div role="status" aria-label="Loading roles" className="grid grid-cols-[repeat(auto-fill,minmax(264px,1fr))] gap-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-[168px] rounded-card" />
            ))}
          </div>
        )}
      </PageFrame>
    )
  }

  const { roles, divisions, pinned, status } = catalog
  const full: RolesView = { ...view, query }
  const shown = applyView(roles, pinned, full)
  const filtering = query.trim() !== '' || view.division !== null || view.pinnedOnly || view.install !== 'any'
  const grouped = !filtering
  const sections = grouped ? sectionsFor(roles, divisions, pinned) : null
  const c = status.counts

  const choose = (choice: RailChoice): void => setView((v) => ({ ...v, division: choice.kind === 'division' ? choice.id : null, pinnedOnly: choice.kind === 'pinned' }))
  const clear = (): void => {
    setQuery('')
    setView({ ...ALL_ROLES })
  }
  const edit = (d: RoleDetail): void => {
    setOpen(null)
    setForm({ kind: 'edit', role: d })
  }
  // A chosen division's roles can become skills in one go: the roles shown that are not skills yet, or, when all are, removed.
  const divisionLabel = view.division ? divisions.find((d) => d.id === view.division)?.label : undefined
  const shownIds = shown.roles.map((r) => r.id)
  const missing = shownIds.filter((id) => !catalog.skills.includes(id))
  const bulkOn = missing.length > 0
  const bulkIds = bulkOn ? missing : shownIds
  const bulkN = bulkIds.length
  // The confirm belongs to this exact set: a new search, filter, division or skill change drops it (a running one finishes).
  const bulkKey = `${view.division}|${bulkOn}|${bulkIds.join(',')}`
  if (bulk && !bulk.busy && bulk.key !== bulkKey) setBulk(null)
  const confirming = bulk?.key === bulkKey
  const focusOn =
    (target: 'confirm' | 'trigger') =>
    (el: HTMLElement | null): void => {
      if (!el || focusTo.current !== target) return
      focusTo.current = null
      el.querySelector('button')?.focus()
    }
  const openBulk = (): void => {
    focusTo.current = 'confirm'
    setBulk({ key: bulkKey, busy: false })
  }
  const cancelBulk = (): void => {
    focusTo.current = 'trigger'
    setBulk(null)
  }
  const runBulk = async (): Promise<void> => {
    const key = bulkKey
    setBulk({ key, busy: true })
    const r = await useRolesStore.getState().setSkills(bulkIds, bulkOn)
    // The confirm that had focus is gone; hand it to the trigger, unless you have moved on to something else meanwhile.
    const at = document.activeElement
    if (!at || at === document.body || at.closest('#bulk-skills-confirm')) focusTo.current = 'trigger'
    setBulk((b) => (b?.key === key ? null : b))
    if (r.ok) useUi.getState().notify(bulkOn ? `Added ${bulkN} ${divisionLabel} ${bulkN === 1 ? 'role as a Claude Code skill' : 'roles as Claude Code skills'}.` : `Removed ${bulkN} ${divisionLabel} ${bulkN === 1 ? 'skill' : 'skills'}.`)
    else useUi.getState().notify(r.error, 'error')
  }
  const saved = (r: RoleSummary): void => {
    setForm(null)
    setOpen(r.id)
  }

  const empty = (
    <div className="rounded-card border border-line bg-surface">
      {view.pinnedOnly && !query.trim() ? (
        <StateNote title="Nothing pinned yet">Pin a role with the pin on its card, or press P on a focused card. Pinned roles stay at the top of the page.</StateNote>
      ) : view.division === 'custom' && !query.trim() ? (
        <StateNote title="You have no roles of your own yet">A role is a name, a one-liner and the text Claude Code works from. Make one and it shows here.</StateNote>
      ) : (
        <StateNote title={query.trim() ? `No role matches “${query.trim()}”` : 'No role fits these filters'}>
          Try fewer words, or describe the task, like “write landing page copy” or “our postgres queries are slow”.
        </StateNote>
      )}
      <div className="flex justify-center gap-2 pb-6">
        {filtering && <Button onClick={clear}>Clear search and filters</Button>}
        <Button variant="primary" onClick={() => setForm({ kind: 'create' })}>
          <Plus size={14} strokeWidth={2} aria-hidden />
          Create a role
        </Button>
      </div>
    </div>
  )

  return (
    <PageFrame
      page="roles"
      lede={`Pick who a conversation or task works as. ${c.total} roles, all read from files on this PC.`}
      filters={
        <div className="flex w-full flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 max-w-[640px] flex-1 text-muted focus-within:text-ink">
              <Search size={16} strokeWidth={1.75} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                ref={search}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && query) {
                    e.preventDefault()
                    e.stopPropagation()
                    setQuery('')
                  }
                }}
                placeholder="Search roles, or describe a task: “write landing page copy”"
                aria-label="Search roles"
                aria-keyshortcuts="/"
                className="h-11 w-full rounded-xl border border-control bg-surface pl-10 pr-12 text-[14px] text-ink outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-search-cancel-button]:hidden"
              />
              {query ? (
                <button type="button" aria-label="Clear search" onClick={() => { setQuery(''); search.current?.focus() }} className="press absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-active hover:text-ink">
                  <X size={14} strokeWidth={1.75} aria-hidden />
                </button>
              ) : (
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" aria-hidden>
                  <Kbd>/</Kbd>
                </span>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Hint label="Reload roles">
                <IconButton aria-label="Reload roles" className="border border-control bg-surface" disabled={refreshing} onClick={() => void useRolesStore.getState().reload()}>
                  <RefreshCw size={15} strokeWidth={1.75} className={cn(refreshing && 'animate-spin motion-reduce:animate-none')} aria-hidden />
                </IconButton>
              </Hint>
              <Button variant="primary" className="h-9" onClick={() => setForm({ kind: 'create' })}>
                <Plus size={15} strokeWidth={2} aria-hidden />
                Create a role
              </Button>
            </div>
          </div>
          <div className="flex min-h-7 flex-wrap items-center gap-2" role="group" aria-label="Filters">
            <SlidersHorizontal size={14} strokeWidth={1.75} aria-hidden className="text-muted" />
            {INSTALL_CHIPS.map(([value, label]) => (
              <Chip key={value} pressed={view.install === value} onClick={() => setView((v) => ({ ...v, install: v.install === value ? 'any' : value }))}>
                {label}
              </Chip>
            ))}
            {shown.mode === 'suggest' && <span className="t-meta text-muted">Ranked by fit for the task you described</span>}
            {filtering && (
              <button type="button" onClick={clear} className="t-meta text-muted underline-offset-2 hover:text-ink hover:underline">
                Clear
              </button>
            )}
            {filtering ? <ResultCount n={shown.roles.length} one="role" many="roles" /> : <ResultCount n={roles.length} one="role" many="roles" />}
            {divisionLabel && shownIds.length > 0 &&
              (confirming ? (
                <span
                  ref={focusOn('confirm')}
                  id="bulk-skills-confirm"
                  className="ml-auto flex items-center gap-2"
                  role="group"
                  aria-labelledby="bulk-skills-question"
                  onKeyDown={(e) => {
                    if (e.key !== 'Escape' || bulk.busy) return
                    e.preventDefault()
                    e.stopPropagation()
                    cancelBulk()
                  }}
                >
                  <span id="bulk-skills-question" className="text-[13px] text-muted">
                    {bulkOn
                      ? `Add ${bulkN} ${divisionLabel} ${bulkN === 1 ? 'role as a skill? It adds its' : 'roles as skills? Each adds its'} description to every Claude Code session.`
                      : `Remove the ${bulkN} ${divisionLabel} ${bulkN === 1 ? 'skill' : 'skills'} AgentDeck wrote?`}
                  </span>
                  <Button size="sm" disabled={bulk.busy} onClick={cancelBulk}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    className={cn(!bulkOn && 'bg-[var(--failed-solid)] enabled:hover:bg-[var(--failed-solid)]')}
                    disabled={bulk.busy}
                    onClick={() => void runBulk()}
                  >
                    {bulkOn ? 'Add' : 'Remove'}
                  </Button>
                </span>
              ) : (
                <span className="ml-auto" ref={focusOn('trigger')}>
                  {/* Disabled while a run for another set finishes, so two never overlap. */}
                  <Button variant="quiet" size="sm" disabled={bulk?.busy} onClick={openBulk}>
                    {bulkOn ? `Add ${bulkN} as ${bulkN === 1 ? 'a skill' : 'skills'}` : `Remove ${bulkN} ${bulkN === 1 ? 'skill' : 'skills'}`}
                  </Button>
                </span>
              ))}
          </div>
        </div>
      }
    >
      {!status.repoFound && <RepoSetup status={status} />}
      <div className="flex items-start gap-6">
        <DivisionRail
          divisions={divisions}
          total={roles.length}
          pinned={pinned.filter((id) => roles.some((r) => r.id === id)).length}
          current={railChoice(full)}
          onChoose={choose}
          footer={
            <div className="flex flex-col gap-1.5 px-1">
              <p className="t-meta text-muted">
                {c.agency} agency · {c.installed} yours · {c.builtin} built-in{c.custom ? ` · ${c.custom} custom` : ''}
              </p>
              <Button variant="quiet" size="sm" className="-ml-2.5 w-fit" onClick={() => setSources(true)}>
                Sources and updates
              </Button>
            </div>
          }
        />
        <RoleBrowser
          sections={sections}
          flat={shown.roles}
          hits={shown.hits}
          pinned={pinned}
          showDivision={view.division === null}
          onOpen={setOpen}
          onPin={(id) => void useRolesStore.getState().togglePin(id)}
          onSeeAll={(id) => setView((v) => ({ ...v, division: id }))}
          empty={empty}
        />
      </div>
      <RoleDrawer
        id={open}
        pinned={open !== null && pinned.includes(open)}
        skill={open !== null && catalog.skills.includes(open)}
        skillsPath={catalog.skillsPath}
        onClose={() => setOpen(null)}
        onEdit={edit}
        onCopied={(r) => setOpen(r.id)}
      />
      <RoleForm mode={form} onClose={() => setForm(null)} onSaved={saved} />
      <SourcesDialog open={sources} status={status} onClose={() => setSources(false)} />
    </PageFrame>
  )
}
