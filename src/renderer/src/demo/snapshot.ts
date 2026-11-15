import type { AuditRow, History, SessionDetail } from '@shared/detail'
import { EMPTY_META, type SessionMetaState } from '@shared/session-meta'
import type { ChangedFile, Session, Snapshot } from '@shared/snapshot'
import { startOfDay } from '@/lib/work'

/**
 * Demo data for M1 (ADR-0011, D-031): sample sessions shaped like the S1 fixtures, with
 * times relative to `now`. Labelled "Demo data" everywhere it shows; never mixed with live.
 * Every figure on Home is derived from these rows by lib/selectors.
 */

const MIN = 60_000
const PATHS = {
  billing: 'D:\\thirdcode\\billing-api',
  web: 'D:\\thirdcode\\thirdcode-web',
  dental: 'D:\\clients\\harbor-dental-site',
  portal: 'D:\\clients\\northwind-portal',
  deck: 'D:\\personal\\agentdeck'
} as const

// [project, path inside it, session, tool, minutes ago]
const EDITS: [keyof typeof PATHS, string, string, string, number][] = [
  ['deck', 'src\\renderer\\src\\App.tsx', 's-deck', 'Write', 1],
  ['billing', 'src\\routes\\webhooks.ts', 's-billing', 'Edit', 3],
  ['web', 'src\\auth\\verify-session.test.ts', 's-auth', 'Edit', 15],
  ['dental', 'app\\booking\\BookingForm.tsx', 's-booking', 'Edit', 31],
  ['billing', 'prisma\\schema.prisma', 's-billing', 'Edit', 40],
  ['portal', 'src\\api\\v2\\orders.ts', 's-portal', 'Write', 52],
  ['deck', 'docs\\UI_MAP.md', 's-deck', 'Edit', 64],
  ['billing', 'src\\pdf\\invoice-template.tsx', 's-invoice', 'Edit', 140],
  ['web', 'app\\pricing\\page.tsx', 's-seo', 'Edit', 190],
  ['web', 'app\\about\\page.tsx', 's-seo', 'Edit', 196],
  ['web', 'public\\sitemap.xml', 's-seo', 'Write', 201],
  ['deck', 'docs\\RELEASE_NOTES.md', 's-docs', 'Write', 335],
  ['dental', 'app\\booking\\schema.ts', 's-booking', 'Edit', 1490],
  ['dental', 'app\\booking\\page.tsx', 's-booking', 'Edit', 1510],
  ['portal', 'src\\api\\v1\\orders.ts', 's-portal', 'Edit', 1620],
  ['portal', 'src\\api\\router.ts', 's-portal', 'Edit', 1640],
  ['billing', 'src\\routes\\checkout.ts', 's-billing', 'Edit', 2880],
  ['billing', 'src\\lib\\stripe.ts', 's-billing', 'Edit', 2905],
  ['web', 'src\\auth\\verify-session.ts', 's-auth', 'Edit', 3010],
  ['web', 'src\\auth\\middleware.ts', 's-auth', 'Edit', 3022],
  ['deck', 'docs\\STATE_MACHINE.md', 's-deck', 'Edit', 4100],
  ['deck', 'docs\\EVENT_SCHEMA.md', 's-deck', 'Edit', 4130],
  ['dental', 'README.md', 's-booking', 'Edit', 4300]
]

// Minutes ago at which a turn finished this week; the first six fall inside the away window.
const TURNS = [12, 23, 38, 51, 67, 88, 130, 178, 240, 300, 420, 610, 760, 900, 1020, 1180, 1300,
  1450, 1600, 1720, 1880, 2050, 2200, 2400, 2600, 2900, 3100, 3300, 3600, 3900, 4200]

/** The demo plan's weekly reset: the next Friday, 1:00 PM local, as claude.ai's Settings › Usage shows one. */
function nextFriday1pm(now: number): number {
  const d = new Date(now)
  d.setHours(13, 0, 0, 0)
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7))
  if (d.getTime() <= now) d.setDate(d.getDate() + 7)
  return d.getTime()
}

export function demoSnapshot(now: number): Snapshot {
  const ago = (minutes: number): number => Math.round(now - minutes * MIN)
  // A session that stopped a couple of hours ago stopped today, even when the demo is opened just after midnight (the Done today lane).
  const stoppedToday = (minutes: number): number => Math.max(ago(minutes), startOfDay(now) + MIN)
  const files: ChangedFile[] = EDITS.map(([project, rel, sessionId, tool, min]) => ({
    path: `${PATHS[project]}\\${rel}`,
    sessionId,
    tool,
    changedAt: ago(min)
  }))

  return {
    mode: 'demo',
    generatedAt: now,
    awaySince: ago(95),
    awayUntil: null,
    sessions: [
      {
        id: 's-deck', bgId: null, name: 'agentdeck-ui', cwd: PATHS.deck, surface: 'desktop', status: 'working',
        startedAt: ago(72), lastEventAt: ago(0.1), activity: 'Editing `src/renderer/src/App.tsx`', plan: null,
        waitingSince: null,
        subagents: [{ id: 'sa-plan', agentType: 'Plan', task: 'Outline the M2 collector tasks', activity: 'Reading `docs/ARCHITECTURE.md`', startedAt: ago(6) }]
      },
      {
        id: 's-auth', bgId: null, name: 'auth-tests', cwd: PATHS.web, surface: 'cli', status: 'working',
        startedAt: ago(22), lastEventAt: ago(0.2), activity: 'Running `npm test -- auth`', plan: { done: 2, total: 4 },
        waitingSince: null,
        subagents: [{ id: 'sa-explore', agentType: 'Explore', task: 'Find callers of verifySession', activity: 'Searching "verifySession"', startedAt: ago(4) }]
      },
      {
        id: 's-billing', bgId: 'a3f09c1e', name: 'stripe-webhooks', cwd: PATHS.billing, surface: 'background',
        status: 'needs_you', startedAt: ago(48), lastEventAt: ago(2), activity: 'Waiting to run `git push`',
        plan: { done: 3, total: 5 }, waitingSince: ago(2), subagents: []
      },
      {
        id: 's-booking', bgId: null, name: 'booking-form', cwd: PATHS.dental, surface: 'cli', status: 'needs_you',
        startedAt: ago(35), lastEventAt: ago(9), activity: 'Waiting to edit `.env.local`', plan: { done: 1, total: 3 },
        waitingSince: ago(9), subagents: []
      },
      {
        id: 's-portal', bgId: 'c71d22b0', name: 'portal-migration', cwd: PATHS.portal, surface: 'background',
        status: 'needs_you', startedAt: ago(64), lastEventAt: ago(26), activity: 'Asked you a question',
        plan: { done: 1, total: 3 }, waitingSince: ago(26), subagents: []
      },
      {
        id: 's-invoice', bgId: 'e4b81f07', name: 'invoice-pdf', cwd: PATHS.billing, surface: 'background',
        status: 'failed', startedAt: ago(190), lastEventAt: stoppedToday(125), activity: 'Stopped: rate limit',
        plan: { done: 2, total: 4 }, waitingSince: null, subagents: []
      },
      {
        id: 's-seo', bgId: '9d2c6a41', name: 'seo-audit', cwd: PATHS.web, surface: 'background', status: 'done',
        startedAt: ago(260), lastEventAt: ago(178), activity: 'Finished', plan: { done: 4, total: 4 },
        waitingSince: null, subagents: []
      },
      {
        id: 's-docs', bgId: null, name: 'release-notes', cwd: PATHS.deck, surface: 'cli', status: 'idle',
        startedAt: ago(400), lastEventAt: ago(330), activity: 'Idle', plan: null, waitingSince: null, subagents: []
      },
      {
        // A session in another agent CLI, watched through its hooks (ADR-0014).
        id: 'codex:019a7c2e-5b1d-7f20-9c4e-2d8f6a1b3c50', bgId: null, name: 'invoice-rounding', cwd: PATHS.billing, surface: 'cli',
        status: 'working', startedAt: ago(9), lastEventAt: ago(1), activity: 'Running `npm test -- invoice`', plan: null,
        waitingSince: null, subagents: [], provider: 'codex', model: 'gpt-5.6-terra'
      }
    ],
    attention: [
      {
        id: 'a-portal-question', priority: 1, kind: 'question', sessionId: 's-portal', toolName: null, hint: null,
        title: 'Keep the legacy `/v1` routes, or remove them in this PR?', riskFlags: [], held: false, openedAt: ago(26)
      },
      {
        id: 'a-booking-env', priority: 1, kind: 'approval', sessionId: 's-booking', toolName: 'Edit', hint: null,
        title: 'Edit `.env.local`', riskFlags: ['.env access'], held: false, openedAt: ago(9)
      },
      {
        id: 'a-billing-push', priority: 1, kind: 'approval', sessionId: 's-billing', toolName: 'Bash', hint: null,
        title: 'Run `git push --force-with-lease origin feat/stripe-webhooks`', riskFlags: ['Force push'], held: true,
        openedAt: ago(2)
      },
      {
        id: 'a-invoice-limit', priority: 2, kind: 'failed', sessionId: 's-invoice', toolName: null,
        title: 'Stopped: rate limit reached', hint: 'Wait for your usage limit to reset, then resume the session.',
        riskFlags: [], held: false, openedAt: ago(125)
      },
      {
        id: 'a-seo-review', priority: 4, kind: 'review', sessionId: 's-seo', toolName: null, hint: null,
        title: 'Finished the SEO audit of /pricing and /about', riskFlags: [], held: false, openedAt: ago(178)
      }
    ],
    files,
    week: { agentTimeMs: (14 * 60 + 25) * MIN, agentTimeLastWeekMs: (11 * 60 + 50) * MIN, finishedTurns: TURNS.map(ago) },
    usage: { todayTokens: 1_840_000, weekTokens: 9_620_000, todayCostUsd: 4.12, weekCostUsd: 23.8, weeklyBudgetUsd: 40 },
    planLimits: { session: { usedPct: 16, resetsAt: Math.round(now + 100 * MIN) }, week: { usedPct: 23, resetsAt: nextFriday1pm(now) }, at: ago(1) },
    recentAgentTypes: ['Explore', 'Plan', 'code-reviewer', 'tdd-guide'],
    agentDefinitionCount: 4 // the Agents page lists the same four in demo, so the sidebar count must match
  }
}

/** The drawer for a demo session, built from the same rows Home shows (ADR-0011); nothing is invented beyond them. */
export function demoDetail(session: Session, snapshot: Snapshot): SessionDetail {
  const timeline = [
    { id: `${session.id}-now`, ts: session.lastEventAt, kind: 'tool.started', agentType: null, summary: session.activity },
    ...session.subagents.map((a) => ({ id: a.id, ts: a.startedAt, kind: 'subagent.started', agentType: a.agentType, summary: `Started ${a.agentType}: ${a.task}` })),
    { id: `${session.id}-start`, ts: session.startedAt, kind: 'session.prompt', agentType: null, summary: 'You sent a prompt' }
  ].sort((a, b) => b.ts - a.ts)
  const plan = session.plan
  const tasks = plan ? Array.from({ length: plan.total }, (_, i) => ({ id: `${session.id}-t${i}`, subject: `Step ${i + 1}`, done: i < plan.done })) : []
  return { session, timeline, tasks, files: snapshot.files.filter((f) => f.sessionId === session.id), finalMessage: null }
}

/** Activity and the audit log for demo mode: every demo session's timeline, and two sample settled approvals. */
export function demoHistory(snapshot: Snapshot): History {
  const activity = snapshot.sessions
    .flatMap((s) => demoDetail(s, snapshot).timeline.map((e) => ({ ...e, sessionId: s.id })))
    .sort((a, b) => b.ts - a.ts)
  const at = snapshot.generatedAt
  // A sample digest in the real shape (SHA-256, 64 hex digits), so the sample rows read like real ones; the page says they are samples.
  const row = (sessionId: string, title: string, outcome: AuditRow['outcome'], minutes: number, waitSec: number, inputHash: string): AuditRow => ({
    ts: Math.round(at - minutes * MIN), requestedAt: Math.round(at - minutes * MIN - waitSec * 1000), itemId: `${sessionId}-${minutes}`,
    sessionId, agentId: null, toolName: 'Bash', title, riskFlags: [], inputHash, outcome
  })
  return {
    activity,
    audit: [
      row('s-auth', 'Run `npm test -- auth`', 'approved', 14, 6, '9f2c41a7d85e03b6c1f47a92e8d05b3a6c7e14f90d2a85b3c6e1f7a40d9b2c58'),
      row('s-seo', 'Run `npx lighthouse https://example.com/pricing`', 'timed-out', 190, 60, '3b7e90c4a1d62f58e0b9473ca6d15f82e7c04a9b31d6f58c2e07a94b1d3c6f80')
    ]
  }
}

/** The notes the sample sessions carry (demo only, in memory): a pin, a name you gave one, the role each was started as, one unread mark. */
export function demoSessionMeta(): SessionMetaState {
  return {
    ...EMPTY_META,
    sessions: {
      's-deck': { pinned: true, role: 'frontend-developer' },
      's-auth': { role: 'test-automation-engineer' },
      's-billing': { unread: true, role: 'cto' },
      's-booking': { alias: 'Booking form for the dental client', role: 'ui-designer' },
      's-invoice': { role: 'backend-architect' },
      's-seo': { role: 'seo-specialist' }
    }
  }
}
