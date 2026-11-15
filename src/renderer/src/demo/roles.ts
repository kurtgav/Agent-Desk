import type { ActionResult } from '@shared/bridge'
import { buildCatalog, toSummary, type RawRole } from '@shared/role-catalog'
import { parseFrontMatter, roleMeta } from '@shared/role-parse'
import {
  ROLE_PREVIEW_CHARS, checkCustomRole, cleanLine, slugify,
  type CustomRoleInput, type RoleDetail, type RoleRepoResult, type RoleSaveResult, type RoleSkillsResult, type RolesCatalog
} from '@shared/roles'

/**
 * Demo roles (ADR-0011, D-144): about 40 sample roles across the clone's divisions, three installed agents, one custom role, and
 * the built-in leadership roles read from the same files main reads. Custom CRUD works in memory; nothing is written anywhere.
 */

/** The leadership roles, as the files main reads. Typed here (not through vite/client) so the node tests that load this file compile. */
type Glob = { glob(pattern: string, options: { query: string; import: string; eager: true }): Record<string, string> }
const BUILTIN_FILES = (import.meta as unknown as Glob).glob('../../../../resources/roles/*.md', { query: '?raw', import: 'default', eager: true })

/** [division, name, emoji, one-liner, description]. Short originals, written for the demo. */
const SAMPLE: [string, string, string, string, string][] = [
  ['engineering', 'Frontend Developer', '🖥️', 'Builds responsive, accessible web apps with pixel-perfect precision.', 'Expert frontend developer specializing in modern web technologies, React and Vue frameworks, UI implementation and performance optimization.'],
  ['engineering', 'Backend Architect', '🏗️', 'Designs the services and data your product stands on.', 'Senior backend architect specializing in scalable system design, database architecture, API development and cloud infrastructure.'],
  ['engineering', 'Software Architect', '📐', 'Picks the boundaries that keep a codebase changeable.', 'Expert software architect specializing in system design, domain-driven design, architectural patterns and technical decision-making.'],
  ['engineering', 'Database Optimizer', '🗄️', 'Makes the slow query fast, then makes sure it stays fast.', 'Expert database specialist focusing on schema design, query optimization, indexing strategies and performance tuning for PostgreSQL, MySQL and modern databases.'],
  ['engineering', 'DevOps Automator', '⚙️', 'Automates the path from commit to production.', 'Expert DevOps engineer specializing in infrastructure automation, CI/CD pipeline development and cloud operations.'],
  ['engineering', 'SRE (Site Reliability Engineer)', '📟', 'Treats reliability as a feature with a budget.', 'Expert site reliability engineer specializing in SLOs, error budgets, observability, chaos engineering and toil reduction for production systems.'],
  ['engineering', 'AI Engineer', '🤖', 'Puts models into products without the hand-waving.', 'Expert AI and machine learning engineer specializing in model development, deployment and integration into production systems.'],
  ['engineering', 'Technical Writer', '📝', 'Docs people actually read and trust.', 'Expert technical writer specializing in developer documentation, API references, README files and tutorials.'],
  ['design', 'UI Designer', '🎛️', 'Consistent, accessible interfaces down to the pixel.', 'Expert UI designer specializing in visual design systems, component libraries and pixel-perfect interface creation.'],
  ['design', 'UX Researcher', '🔎', 'Finds out what users do, not what they say they do.', 'Expert user experience researcher specializing in user behavior analysis, usability testing and data-driven design insights.'],
  ['design', 'Brand Guardian', '🛡️', "Your brand's fiercest protector and most passionate advocate.", 'Expert brand strategist specializing in brand identity development, consistency maintenance and strategic brand positioning.'],
  ['design', 'Visual Storyteller', '🎞️', 'Turns complicated information into a picture people remember.', 'Expert visual communication specialist focused on compelling visual narratives, multimedia content and brand storytelling through design.'],
  ['marketing', 'Content Creator', '✍️', 'Writes things people finish reading.', 'Expert content strategist and creator for multi-platform campaigns. Develops editorial calendars, creates compelling copy, manages brand storytelling and optimizes content for engagement.'],
  ['marketing', 'SEO Specialist', '🔍', 'Earns the traffic you would otherwise pay for.', 'Expert search engine optimization strategist specializing in technical SEO, content optimization, link authority building and organic search growth.'],
  ['marketing', 'Growth Hacker', '🚀', 'Runs small experiments until a channel works.', 'Expert growth strategist specializing in rapid user acquisition through data-driven experimentation, viral loops and conversion funnel optimization.'],
  ['marketing', 'Social Media Strategist', '📱', 'A voice for each platform, one plan behind them.', 'Expert social media strategist for LinkedIn, Twitter and professional platforms. Creates cross-platform campaigns and builds communities.'],
  ['marketing', 'Email Marketing Strategist', '📧', 'Lifecycle email that earns the open.', 'Expert email marketing strategist for CRM-driven campaigns, lifecycle automation, segmentation and deliverability.'],
  ['paid-media', 'PPC Campaign Strategist', '🎯', 'Spends the budget where it converts.', 'Senior paid media strategist specializing in search, shopping and performance campaign architecture, budget allocation and bidding strategy.'],
  ['product', 'Product Manager', '🧩', 'Ships the right thing at the right time.', 'Holistic product leader who owns the lifecycle from discovery and strategy through roadmap, stakeholder alignment, go-to-market and outcome measurement.'],
  ['product', 'Sprint Prioritizer', '📊', 'Turns a long backlog into a sprint that fits.', 'Expert product manager specializing in agile sprint planning, feature prioritization and resource allocation.'],
  ['product', 'Feedback Synthesizer', '💬', 'Hears the pattern across a hundred comments.', 'Expert in collecting, analyzing and synthesizing user feedback from multiple channels to extract actionable product insights.'],
  ['project-management', 'Project Shepherd', '🐑', 'Keeps many teams moving the same way.', 'Expert project manager specializing in cross-functional coordination, timeline management and stakeholder alignment.'],
  ['sales', 'Sales Coach', '🏆', 'Makes every rep and every deal better.', 'Expert sales coaching specialist focused on rep development, pipeline review facilitation, call coaching and forecast accuracy.'],
  ['sales', 'Outbound Strategist', '📬', 'Research-led prospecting, not volume.', 'Signal-based outbound specialist who designs multi-channel prospecting sequences and defines ideal customer profiles.'],
  ['sales', 'Deal Strategist', '♟️', 'Qualifies hard and plans the win.', 'Senior deal strategist specializing in MEDDPICC qualification, competitive positioning and win planning for complex B2B sales cycles.'],
  ['security', 'Application Security Engineer', '🔐', 'Makes secure code the default.', 'AppSec specialist who secures the software lifecycle through threat modeling, secure code review and developer security education.'],
  ['security', 'Penetration Tester', '🕵️', 'Breaks it first, with permission.', 'Offensive security specialist conducting authorized penetration tests and vulnerability assessments across networks, web applications and cloud.'],
  ['security', 'Incident Responder', '🚨', 'Contains it, explains it, makes sure it stays fixed.', 'Digital forensics and incident response specialist who leads breach investigations and writes post-mortems that prevent recurrence.'],
  ['testing', 'Test Automation Engineer', '🧪', 'Tests that fail for real reasons only.', 'Expert end-to-end test automation engineer for Playwright and Cypress: resilient selectors, flake elimination and CI parallelization.'],
  ['testing', 'Accessibility Auditor', '♿', 'If it was not tested with a screen reader, it is not accessible.', 'Expert accessibility specialist who audits interfaces against WCAG standards and tests with assistive technologies.'],
  ['testing', 'Evidence Collector', '📸', 'Screenshots or it did not happen.', 'Screenshot-obsessed QA specialist who reports reproducible issues with evidence and marks untested scope honestly.'],
  ['support', 'Support Responder', '🛟', 'Fixes the problem and keeps the customer.', 'Expert customer support specialist delivering issue resolution, multi-channel support and proactive customer care.'],
  ['finance', 'Financial Analyst', '📈', 'Turns the numbers into a decision.', 'Expert financial analyst specializing in financial modeling, forecasting and scenario analysis for decision support.'],
  ['research', 'Research Synthesist', '📚', 'Weighs the evidence and says what it supports.', 'Expert in literature review, source evaluation and evidence synthesis: a structured, honestly weighted map of what the evidence supports.'],
  ['game-development', 'Game Designer', '🎲', 'Loops, economies and the reason to come back.', 'Systems and mechanics architect who writes design documents, balances economies and designs gameplay loops.'],
  ['specialized', 'Prompt Engineer', '🧠', 'Makes the model do the same good thing every time.', 'Specialist in crafting, testing and optimizing prompts for language models into reliable, production-grade behavior.'],
  ['specialized', 'Chief of Staff', '🗂️', 'Filters the noise so the boss can think.', 'Master coordinator for founders and executives: owns processes, routes decisions and positions outputs for impact.'],
  ['academic', 'Historian', '🏛️', 'Puts a claim in its period and checks the sources.', 'Expert in historical analysis, periodization and historiography who validates historical coherence.']
]

/** Agents in the sample user's agents folder that the clone does not have. */
const YOURS: [string, string, string, string][] = [
  ['planner', '🗺️', 'Plans before anything is built.', 'Expert planning specialist for complex features and refactoring.'],
  ['code-reviewer', '🔍', 'Reviews what was just written.', 'Expert code review specialist. Reviews code for quality, security and maintainability.'],
  ['tdd-guide', '🔴', 'Tests first, then the code.', 'Test-driven development specialist enforcing write-tests-first methodology.']
]

/** Which sample roles the sample user has installed: most of them, so both states show. */
const NOT_INSTALLED = new Set(['Penetration Tester', 'Historian', 'Game Designer', 'Social Media Strategist', 'Deal Strategist', 'Feedback Synthesizer'])

const DEMO_REPO = 'C:\\Users\\Kurt\\.claude\\repos\\agency-agents'
const DEMO_SKILLS = 'C:\\Users\\Kurt\\.claude\\skills'

interface Stored {
  stem: string
  name: string
  emoji: string
  vibe: string
  description: string
  prompt: string
}

const SEED_CUSTOM: readonly Stored[] = [
  {
    stem: 'release-notes-writer',
    name: 'Release Notes Writer',
    emoji: '🧾',
    vibe: 'Turns a diff into notes a customer would read.',
    description: 'Writes release notes from merged changes: what is new, what is fixed, and what to do about it.',
    prompt: '# Release Notes Writer\n\nYou turn a list of merged changes into release notes for customers.\n\n## Rules\n- Lead with what the customer can now do.\n- Group by new, improved and fixed.\n- Never invent a change that is not in the list.\n'
  }
]
const SEED_PINNED = ['frontend-developer', 'cto']
let custom: Stored[] = [...SEED_CUSTOM]
let pinned: string[] = [...SEED_PINNED]
/** Roles "installed" as skills: in memory only, like every demo write (D-130). */
let skills: string[] = []

const synthesized = (name: string, description: string): string =>
  `# ${name}\n\n${description}\n\n## Mission\nThis is sample text for the demo. With the agency-agents folder on this PC, the real role appears here: identity and memory, mission, operating rules, deliverables and how it communicates.\n`

function builtinRaws(): { raws: RawRole[]; texts: Map<string, string> } {
  const raws: RawRole[] = []
  const texts = new Map<string, string>()
  for (const [path, text] of Object.entries(BUILTIN_FILES)) {
    const fm = parseFrontMatter(text)
    const meta = fm ? roleMeta(fm.fields) : null
    if (!fm || !meta) continue
    const stem = path.split('/').pop()!.replace(/\.md$/i, '')
    raws.push({ source: 'builtin', key: `builtin:${stem}.md`, stem, ...meta, division: 'leadership', promptChars: fm.body.trim().length })
    texts.set(`builtin:${stem}.md`, fm.body.trim())
  }
  return { raws, texts }
}

function build(): { catalog: RolesCatalog; texts: Map<string, string> } {
  const { raws, texts } = builtinRaws()
  for (const [division, name, emoji, vibe, description] of SAMPLE) {
    const stem = `${division}-${slugify(name)}`
    const base = { stem, name, emoji, vibe, description, division, promptChars: 6_000 + name.length * 91 }
    raws.push({ ...base, source: 'agency', key: `agency:${division}/${stem}.md` })
    texts.set(`agency:${division}/${stem}.md`, synthesized(name, description))
    if (!NOT_INSTALLED.has(name)) raws.push({ ...base, source: 'installed', key: `installed:${stem}.md`, division: 'yours' })
  }
  for (const [name, emoji, vibe, description] of YOURS) {
    raws.push({ source: 'installed', key: `installed:${name}.md`, stem: name, name, emoji, vibe, description, division: 'yours', promptChars: 4_800 })
    texts.set(`installed:${name}.md`, synthesized(name, description))
  }
  for (const c of custom) {
    raws.push({ source: 'custom', key: `custom:${c.stem}.md`, stem: c.stem, name: c.name, emoji: c.emoji, vibe: c.vibe, description: c.description, division: 'custom', promptChars: c.prompt.length })
    texts.set(`custom:${c.stem}.md`, c.prompt)
  }
  const built = buildCatalog(raws)
  const now = Date.now()
  const catalog: RolesCatalog = {
    roles: built.roles.map(toSummary),
    divisions: built.divisions,
    pinned,
    skills,
    skillsPath: DEMO_SKILLS,
    status: {
      repoPath: DEMO_REPO,
      repoFound: true,
      repoSource: 'default',
      configuredPath: null,
      configuredMissing: false,
      suggestedPath: DEMO_REPO,
      installedPath: 'C:\\Users\\Kurt\\.claude\\agents',
      installedFound: true,
      customPath: 'C:\\Users\\Kurt\\AppData\\Roaming\\AgentDeck\\roles',
      counts: {
        agency: built.roles.filter((r) => r.source === 'agency').length,
        installed: built.roles.filter((r) => r.source === 'installed').length,
        installedFlagged: built.roles.filter((r) => r.installed).length,
        custom: built.roles.filter((r) => r.source === 'custom').length,
        builtin: built.roles.filter((r) => r.source === 'builtin').length,
        total: built.roles.length,
        duplicates: 0,
        skipped: 0
      },
      scannedAt: now,
      durationMs: 38
    }
  }
  // The text by role id, so `get` can find it.
  return { catalog, texts: new Map(built.roles.map((r) => [r.id, texts.get(r.key) ?? ''])) }
}

export function demoRolesCatalog(): RolesCatalog {
  return build().catalog
}

const wait = <T>(value: T): Promise<T> => Promise.resolve(value)

/** The same shape as the bridge's roles methods, kept in memory. */
export const demoRolesApi = {
  list: (): Promise<RolesCatalog> => wait(build().catalog),
  reload: (): Promise<RolesCatalog> => wait(build().catalog),
  get: (id: string): Promise<RoleDetail | null> => {
    const { catalog, texts } = build()
    const role = catalog.roles.find((r) => r.id === id)
    if (!role) return wait(null)
    const text = texts.get(id) ?? ''
    return wait({ ...role, preview: text.slice(0, ROLE_PREVIEW_CHARS), previewTruncated: text.length > ROLE_PREVIEW_CHARS, editable: role.source === 'custom', prompt: role.source === 'custom' ? text : null })
  },
  save: (input: CustomRoleInput): Promise<RoleSaveResult> => {
    const problem = checkCustomRole(input)[0]
    if (problem) return wait({ ok: false, error: problem.message, field: problem.field })
    const { catalog } = build()
    const editing = input.id ? catalog.roles.find((r) => r.id === input.id && r.source === 'custom') : undefined
    const name = cleanLine(input.name)
    const slug = slugify(name)
    if (catalog.roles.some((r) => r.id === slug && r.id !== editing?.id)) return wait({ ok: false, error: `There is already a role called “${name}”. Pick another name, or edit that one.`, field: 'name' })
    const stem = editing ? custom.find((c) => slugify(c.stem) === editing.id)?.stem ?? slug : slug
    const next: Stored = { stem, name, emoji: input.emoji.trim(), vibe: cleanLine(input.vibe ?? ''), description: cleanLine(input.description), prompt: input.prompt.trim() }
    custom = [...custom.filter((c) => c.stem !== stem), next]
    const role = build().catalog.roles.find((r) => r.source === 'custom' && r.name === name)
    return wait(role ? { ok: true, role } : { ok: false, error: 'The role could not be saved.' })
  },
  remove: (id: string): Promise<ActionResult> => {
    const role = build().catalog.roles.find((r) => r.id === id && r.source === 'custom')
    if (!role) return wait({ ok: false, error: 'Only your own roles can be deleted.' })
    custom = custom.filter((c) => slugify(c.stem) !== id)
    pinned = pinned.filter((p) => p !== id)
    return wait({ ok: true })
  },
  duplicate: async (id: string): Promise<RoleSaveResult> => {
    const detail = await demoRolesApi.get(id)
    if (!detail) return { ok: false, error: 'That role no longer exists.' }
    const taken = new Set(build().catalog.roles.map((r) => r.name.toLowerCase()))
    let name = `${detail.name} (copy)`
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${detail.name} (copy ${n})`
    return demoRolesApi.save({ name: name.slice(0, 60), emoji: detail.emoji, vibe: detail.vibe, description: detail.description.slice(0, 400), prompt: detail.preview || detail.description })
  },
  setPinned: (id: string, on: boolean): Promise<string[]> => {
    pinned = on ? [...pinned.filter((p) => p !== id), id] : pinned.filter((p) => p !== id)
    return wait(pinned)
  },
  setSkills: (ids: string[], on: boolean): Promise<RoleSkillsResult> => {
    skills = on ? [...new Set([...skills, ...ids])] : skills.filter((s) => !ids.includes(s))
    return wait({ ok: true, skills })
  },
  setRepo: (): Promise<RoleRepoResult> => wait({ ok: false, error: 'Turn demo data off first.' }),
  browse: (): Promise<string | null> => wait(null)
}

/** For tests: back to the sample data. */
export function resetDemoRoles(): void {
  custom = [...SEED_CUSTOM]
  pinned = [...SEED_PINNED]
  skills = []
}
