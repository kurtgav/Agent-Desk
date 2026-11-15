import type { AgentDef } from '@shared/bridge'
import type { AttentionKind, Snapshot, Status } from '@shared/snapshot'
import type { EodBlocker, EodDay, EodProject, EodReport, EodSession, WorkTask } from '@shared/work'
import { dayKey, shiftDay, startOfDay } from '@/lib/work'

/**
 * Demo tasks and Daily reports (ADR-0011, D-031). Built on demoSnapshot: the same project folders, session names and
 * agents, with times relative to `snapshot.generatedAt`. Today's report is derived from the snapshot and the tasks
 * as they stand, so marking a task done in the demo shows up in it. The five days before it are written out.
 */

const MIN = 60_000

type Key = 'billing' | 'web' | 'dental' | 'portal' | 'deck'
/** A demo session that runs in each project; its folder is the project's. */
const ANCHOR: Record<Key, string> = { billing: 's-billing', web: 's-auth', dental: 's-booking', portal: 's-portal', deck: 's-deck' }
const cwdOf = (snapshot: Snapshot, key: Key): string => snapshot.sessions.find((s) => s.id === ANCHOR[key])?.cwd ?? ''

// ---- Agents ------------------------------------------------------------------------------------------------------

// What the four subagent types the demo's sessions used are for, so the Agents page reads like a real catalogue.
const AGENT_NOTES: Record<string, { description: string; model: string }> = {
  Explore: { description: 'Read-only search agent for broad sweeps across a codebase. It finds the files and answers the question; it never edits.', model: 'haiku' },
  Plan: { description: 'Software architect agent that turns a goal into a step-by-step implementation plan and names the critical files.', model: 'opus' },
  'code-reviewer': { description: 'Reviews code right after it is written for quality, security and maintainability, and reports findings by severity.', model: 'sonnet' },
  'tdd-guide': { description: 'Enforces tests first: writes the failing test, then the smallest change that passes, then checks coverage.', model: 'sonnet' }
}

/** A demo subagent with its description and model filled in; live definitions pass through untouched. */
export function demoAgentNote(a: AgentDef, demo: boolean): AgentDef {
  const note = demo ? AGENT_NOTES[a.name] : undefined
  return note ? { ...a, description: a.description || note.description, model: a.model ?? note.model } : a
}

// ---- Tasks -------------------------------------------------------------------------------------------------------

// [id, title, project, status, created (minutes ago), done (minutes ago), session name]
const TASKS: [string, string, Key | null, WorkTask['status'], number, number | null, string | null][] = [
  ['t-stripe-keys', 'Add idempotency keys to the Stripe webhook handler', 'billing', 'todo', 40, null, null],
  ['t-release', 'Write the 0.1.0 release notes', 'deck', 'todo', 180, null, null],
  ['t-mobile', 'Check the booking form on a phone-width screen', 'dental', 'todo', 1500, null, null],
  ['t-northwind', 'Reply to Northwind about the /v1 route sunset', null, 'todo', 2900, null, null],
  ['t-auth', 'Fix the flaky auth tests on CI', 'web', 'doing', 100, null, 'auth-tests'],
  ['t-portal', 'Move Northwind orders to the v2 API', 'portal', 'doing', 140, null, 'portal-migration'],
  ['t-spacing', 'Tighten the Settings page spacing', 'deck', 'doing', 220, null, null],
  ['t-seo', 'SEO audit of /pricing and /about', 'web', 'done', 400, 170, 'seo-audit'],
  ['t-invoice', 'Review the invoice PDF layout', 'billing', 'done', 600, 95, null],
  ['t-rotate', 'Rotate the staging Stripe keys', 'billing', 'done', 3100, 1500, null]
]

export function demoTasks(snapshot: Snapshot): WorkTask[] {
  const now = snapshot.generatedAt
  const at = (minutesAgo: number): number => Math.round(now - minutesAgo * MIN)
  // Tasks finished within the last ten hours were finished today, even when the demo is opened just after midnight.
  const doneAt = (minutesAgo: number): number => (minutesAgo < 600 ? Math.max(at(minutesAgo), startOfDay(now) + MIN) : at(minutesAgo))
  return TASKS.map(([id, title, key, status, created, done, sessionName]) => ({
    id, title, project: key ? cwdOf(snapshot, key) : null, status, createdAt: at(created), doneAt: done === null ? null : doneAt(done), sessionName
  }))
}

// ---- Reports -----------------------------------------------------------------------------------------------------

// What each demo session last said, as the report's one line about it.
const SUMMARY: Record<string, string> = {
  's-deck': 'Wiring the Tasks and Daily report pages into the shell.',
  's-auth': 'Two of four auth test files moved to the shared fixture; the rest are next.',
  's-billing': 'Webhook retries and signature checks are in; waiting to push the branch.',
  's-booking': 'The form validates on blur; it needs your OK to edit .env.local.',
  's-portal': 'The v2 orders route is done; it asked whether to keep the legacy /v1 routes.',
  's-invoice': 'The invoice PDF renders; it stopped on a rate limit before the footer totals.',
  's-seo': 'Audited /pricing and /about: fixed 4 missing titles and 2 duplicate descriptions.',
  's-docs': 'Drafted the 0.1.0 release notes.'
}
// Turns that finished today, per session (12 in all, as many as Home counts for today).
const TURNS: Record<string, number> = { 's-deck': 2, 's-auth': 2, 's-billing': 2, 's-booking': 1, 's-portal': 1, 's-invoice': 1, 's-seo': 2, 's-docs': 1 }
const TODAY_WINDOW_MIN = 340

function group(sessions: EodSession[], files: Map<string, number>, turns: Map<string, number>, name: (cwd: string) => string): EodProject[] {
  const byCwd = new Map<string, EodProject>()
  for (const s of sessions) {
    const p = byCwd.get(s.project) ?? { cwd: s.project, name: name(s.project), agentTimeMs: 0, sessions: 0, turns: 0, files: files.get(s.project) ?? 0 }
    byCwd.set(s.project, { ...p, agentTimeMs: p.agentTimeMs + s.agentTimeMs, sessions: p.sessions + 1, turns: p.turns + (turns.get(s.id) ?? 0) })
  }
  return [...byCwd.values()]
}

const tail = (cwd: string): string => cwd.split(/[\\/]+/).filter(Boolean).pop() ?? cwd

function totalsOf(
  sessions: EodSession[], projects: EodProject[], approvals: number, tasksDone: number
): EodReport['totals'] {
  return {
    agentTimeMs: sessions.reduce((n, s) => n + s.agentTimeMs, 0),
    sessions: sessions.length,
    turns: projects.reduce((n, p) => n + p.turns, 0),
    filesChanged: projects.reduce((n, p) => n + p.files, 0),
    approvalsAnswered: approvals,
    tasksDone
  }
}

/** Today: every demo session, the files edited in the last hours, the open items, and the tasks as they stand. */
function liveReport(snapshot: Snapshot, tasks: readonly WorkTask[], notes: string, now: number): EodReport {
  const day = dayKey(now)
  const midnight = startOfDay(now)
  const sessions: EodSession[] = snapshot.sessions.map((s) => {
    const until = s.status === 'working' ? now : (s.waitingSince ?? s.lastEventAt)
    return {
      id: s.id, name: s.name, project: s.cwd, status: s.status, startedAt: s.startedAt, lastEventAt: s.lastEventAt,
      agentTimeMs: Math.max(0, until - s.startedAt), plan: s.plan, summary: SUMMARY[s.id] ?? null
    }
  })
  const sessionCwd = new Map(snapshot.sessions.map((s) => [s.id, s.cwd]))
  const files = new Map<string, number>()
  const seen = new Set<string>()
  for (const f of snapshot.files) {
    const cwd = sessionCwd.get(f.sessionId)
    if (!cwd || now - f.changedAt > TODAY_WINDOW_MIN * MIN || seen.has(f.path)) continue
    seen.add(f.path)
    files.set(cwd, (files.get(cwd) ?? 0) + 1)
  }
  const projects = group(sessions, files, new Map(Object.entries(TURNS)), tail)
  const tasksDone = tasks.filter((t) => t.status === 'done' && (t.doneAt ?? 0) >= midnight)
  const blockers: EodBlocker[] = snapshot.attention
    .filter((a) => a.priority <= 2)
    .map((a) => ({ itemId: a.id, kind: a.kind, title: a.title, sessionId: a.sessionId, project: sessionCwd.get(a.sessionId) ?? '', openedAt: a.openedAt }))
  return {
    day, generatedAt: now, closed: false, totals: totalsOf(sessions, projects, 1, tasksDone.length), projects, sessions, tasksDone,
    carryOver: tasks.filter((t) => t.status !== 'done'), blockers, notes
  }
}

// [session id, name, project, status, starts at, minutes worked, plan, turns, files, summary]
type Row = [string, string, Key, Status, string, number, [number, number] | null, number, number, string]
interface DaySpec {
  ago: number
  file: boolean
  approvals: number
  rows: Row[]
  done: [string, Key | null][]
  carry: [string, Key | null][]
  /** [kind, title, session id, project, opened at] */
  blockers: [AttentionKind, string, string, Key, string][]
  notes: string
}


const PAST: DaySpec[] = [
  { // yesterday: a full day, nothing left waiting
    ago: 1, file: true, approvals: 6, notes: '',
    rows: [
      ['s-billing', 'stripe-webhooks', 'billing', 'idle', '09:10', 85, [2, 5], 3, 4, 'Signature verification and the retry queue are in; the push waits for review.'],
      ['s-auth', 'auth-tests', 'web', 'idle', '10:30', 70, [1, 4], 2, 3, 'Found the shared fixture that makes four tests order-dependent.'],
      ['ci-cache', 'ci-cache', 'web', 'done', '11:45', 30, [3, 3], 1, 2, 'Cut CI install time from 4m 10s to 1m 20s with a lockfile cache.'],
      ['s-portal', 'portal-migration', 'portal', 'idle', '13:00', 55, null, 2, 3, 'Mapped every /v1 route to its v2 replacement.'],
      ['s-booking', 'booking-form', 'dental', 'idle', '15:20', 40, [1, 3], 1, 2, 'Added the date picker; validation is next.'],
      ['s-deck', 'agentdeck-ui', 'deck', 'idle', '16:10', 75, null, 2, 5, 'Built the Sessions, Files and Activity pages.']
    ],
    done: [['Rotate the staging Stripe keys', 'billing'], ['Cache dependencies in CI', 'web'], ['Map the Northwind /v1 routes', 'portal']],
    carry: [['Check the booking form on a phone-width screen', 'dental'], ['Reply to Northwind about the /v1 route sunset', null], ['Add the booking confirmation step', 'dental']],
    blockers: []
  },
  { // a lighter day
    ago: 2, file: false, approvals: 2, notes: '',
    rows: [
      ['s-deck', 'agentdeck-ui', 'deck', 'idle', '10:00', 95, null, 3, 6, 'Added the command palette and the g-then-letter shortcuts.'],
      ['s-portal', 'portal-migration', 'portal', 'idle', '14:30', 50, null, 1, 2, 'Read through the v1 handlers and listed their callers.'],
      ['sitemap-fix', 'sitemap-fix', 'web', 'done', '16:00', 25, [2, 2], 1, 1, 'Regenerated the sitemap; /about was missing.']
    ],
    done: [['Fix the missing /about entry in the sitemap', 'web'], ['Write the palette shortcut table', 'deck']],
    carry: [['Reply to Northwind about the /v1 route sunset', null], ['List the callers of the v1 handlers', 'portal']],
    blockers: []
  },
  { // failures and blockers
    ago: 3, file: true, approvals: 4, notes: 'Two runs stopped on limits, not on the code. Ask for a higher limit before the Stripe push.',
    rows: [
      ['s-billing', 'stripe-webhooks', 'billing', 'failed', '09:00', 110, [2, 5], 3, 4, 'Stopped: the signature test kept failing against the sandbox clock.'],
      ['s-invoice', 'invoice-pdf', 'billing', 'failed', '11:40', 65, [2, 4], 2, 3, 'Stopped: rate limit reached before the footer totals.'],
      ['s-auth', 'auth-tests', 'web', 'idle', '13:00', 80, [1, 4], 2, 2, 'Started moving the auth tests to the shared fixture.'],
      ['s-portal', 'portal-migration', 'portal', 'idle', '14:20', 45, [1, 3], 1, 2, 'Waiting on a decision about the CSV export.'],
      ['lint-sweep', 'lint-sweep', 'deck', 'done', '15:10', 30, [2, 2], 2, 6, 'Cleared 14 lint warnings; no behaviour changed.'],
      ['s-booking', 'booking-form', 'dental', 'idle', '16:00', 25, null, 1, 1, 'Sketched the confirmation step.'],
      ['seed-data', 'seed-data', 'portal', 'done', '16:40', 20, null, 1, 2, 'Seeded 40 sample orders for the migration tests.']
    ],
    done: [['Clear the lint warnings', 'deck']],
    carry: [['Raise the Stripe usage limit', 'billing'], ['Decide on the old CSV export', 'portal'], ['Re-run the signature test against the live clock', 'billing']],
    blockers: [
      ['failed', 'Stopped: rate limit reached', 's-invoice', 'billing', '12:45'],
      ['approval', 'Run `git push --force-with-lease origin feat/stripe-webhooks`', 's-billing', 'billing', '16:20'],
      ['question', 'Keep the old CSV export in the portal, or drop it?', 's-portal', 'portal', '15:05']
    ]
  },
  { // a quiet day
    ago: 4, file: true, approvals: 0, notes: '',
    rows: [['s-docs', 'release-notes', 'deck', 'done', '11:20', 38, null, 1, 2, 'Collected what changed since the first spike.']],
    done: [], carry: [['Raise the Stripe usage limit', 'billing'], ['Decide on the old CSV export', 'portal']], blockers: []
  },
  {
    ago: 5, file: true, approvals: 3, notes: 'Pricing page copy still needs legal sign-off. Ask on Monday.',
    rows: [
      ['s-deck', 'agentdeck-ui', 'deck', 'done', '09:30', 100, null, 3, 7, 'Home now fits the reference window without scrolling.'],
      ['pricing-page', 'pricing-page', 'web', 'done', '11:30', 60, [3, 3], 2, 4, 'Rebuilt the pricing page on the new plan table.'],
      ['harbor-nav', 'harbor-nav', 'dental', 'done', '14:00', 55, [2, 2], 2, 3, 'The navigation collapses under 640px.'],
      ['migrate-orders', 'migrate-orders', 'portal', 'done', '15:30', 30, null, 1, 2, 'Moved the orders table to the new schema.']
    ],
    done: [['Rebuild the pricing page', 'web'], ['Collapse the Harbor Dental navigation on phones', 'dental'], ['Move the orders table to the new schema', 'portal']],
    carry: [['Get legal sign-off on the pricing copy', 'web']], blockers: []
  }
]

function pastReport(spec: DaySpec, snapshot: Snapshot, today: string, notes: string): EodReport {
  const day = shiftDay(today, -spec.ago)
  const [y = 1970, mo = 1, d = 1] = day.split('-').map(Number)
  const at = (hhmm: string): number => new Date(y, mo - 1, d, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3))).getTime()
  const sessions: EodSession[] = spec.rows.map(([id, name, key, status, start, mins, plan, , , summary]) => ({
    id, name, project: cwdOf(snapshot, key), status, startedAt: at(start), lastEventAt: at(start) + (mins + 6) * MIN,
    agentTimeMs: mins * MIN, plan: plan ? { done: plan[0], total: plan[1] } : null, summary
  }))
  const files = new Map<string, number>()
  spec.rows.forEach(([, , key, , , , , , n]) => files.set(cwdOf(snapshot, key), (files.get(cwdOf(snapshot, key)) ?? 0) + n))
  const projects = group(sessions, files, new Map(spec.rows.map((r): [string, number] => [r[0], r[7]])), tail)
  const task = (title: string, key: Key | null, status: WorkTask['status'], i: number): WorkTask => ({
    id: `past-${spec.ago}-${status}-${i}`, title, project: key ? cwdOf(snapshot, key) : null, status,
    createdAt: at('08:00') - 24 * 60 * MIN, doneAt: status === 'done' ? at('16:30') + i * 20 * MIN : null, sessionName: null
  })
  const tasksDone = spec.done.map(([title, key], i) => task(title, key, 'done', i))
  return {
    day, generatedAt: at('18:00'), closed: true, totals: totalsOf(sessions, projects, spec.approvals, tasksDone.length), projects, sessions, tasksDone,
    carryOver: spec.carry.map(([title, key], i) => task(title, key, i === 0 ? 'doing' : 'todo', i)),
    blockers: spec.blockers.map(([kind, title, sessionId, key, opened], i) => ({
      itemId: `past-${spec.ago}-b${i}`, kind, title, sessionId, project: cwdOf(snapshot, key), openedAt: at(opened)
    })),
    notes
  }
}

/** One day's report, or null for a day the demo has none of. `savedNotes` are what was typed in this run. */
export function demoEod(day: string, snapshot: Snapshot, tasks: readonly WorkTask[], savedNotes: ReadonlyMap<string, string>, now = snapshot.generatedAt): EodReport | null {
  const today = dayKey(now)
  if (day === today) return liveReport(snapshot, tasks, savedNotes.get(day) ?? '', now)
  const spec = PAST.find((p) => shiftDay(today, -p.ago) === day)
  return spec ? pastReport(spec, snapshot, today, savedNotes.get(day) ?? spec.notes) : null
}

/** The history list: today and the five days before it. */
export function demoEodDays(snapshot: Snapshot, tasks: readonly WorkTask[], now = snapshot.generatedAt): EodDay[] {
  const today = dayKey(now)
  const noNotes = new Map<string, string>()
  const own = (day: string, file: boolean): EodDay => {
    const r = demoEod(day, snapshot, tasks, noNotes, now)
    return { day, agentTimeMs: r?.totals.agentTimeMs ?? 0, sessions: r?.totals.sessions ?? 0, tasksDone: r?.totals.tasksDone ?? 0, hasFile: file }
  }
  return [own(today, false), ...PAST.map((p) => own(shiftDay(today, -p.ago), p.file))]
}
