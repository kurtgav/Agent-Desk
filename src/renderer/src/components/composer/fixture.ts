import type { RoleDivision, RoleSummary } from '@shared/roles'

/** A small synthetic catalog for the composer's tests: the shapes of the real one, none of its size. */
const DIVISIONS: RoleDivision[] = [
  { id: 'leadership', label: 'Leadership', icon: 'Crown', color: '#F59E0B', count: 0 },
  { id: 'engineering', label: 'Engineering', icon: 'Code', color: '#3B82F6', count: 0 },
  { id: 'testing', label: 'Testing', icon: 'Bug', color: '#10B981', count: 0 },
  { id: 'marketing', label: 'Marketing', icon: 'Megaphone', color: '#EC4899', count: 0 },
  { id: 'specialized', label: 'Specialized', icon: 'Sparkles', color: '#8B5CF6', count: 0 }
]

const SEED: [string, string, string, string, string][] = [
  ['leadership', 'CTO', '🧭', 'Calm, plain-spoken, and always asking which decision this actually unblocks.', 'Technology leader who turns business goals into engineering decisions. Weighs architecture, build versus buy, hiring, risk and cost.'],
  ['leadership', 'Founding Engineer', '🛠️', 'Ships the first version before the meeting ends.', 'Generalist engineer for the first months of a product: prototype, mvp, full stack.'],
  ['specialized', 'Chief of Staff', '🗂️', 'Filters the noise so the boss can think.', 'Master coordinator for founders and executives: owns processes, routes decisions.'],
  ['marketing', 'Content Creator', '✍️', 'Writes things people finish reading.', 'Expert content strategist for multi-platform campaigns, editorial calendars and copy.'],
  ['engineering', 'CMS Developer', '🧱', 'Themes, plugins and content models.', 'Drupal and WordPress specialist for theme development and custom plugins.'],
  ['engineering', 'Frontend Developer', '🖥️', 'Builds responsive, accessible web apps with pixel-perfect precision.', 'Expert frontend developer specializing in modern web technologies, React and Vue, UI implementation and performance optimization.'],
  ['engineering', 'Backend Architect', '🏗️', 'Designs the services and data your product stands on.', 'Senior backend architect for scalable system design, database architecture and API development.'],
  ['engineering', 'Database Optimizer', '🗄️', 'Makes the slow query fast, then makes sure it stays fast.', 'Expert database specialist focusing on schema design, query optimization, indexing strategies and performance tuning for PostgreSQL and MySQL.'],
  ['engineering', 'Code Reviewer', '🔍', 'Reviews what was just written.', 'Expert code reviewer who gives constructive, actionable feedback on correctness and maintainability.'],
  ['testing', 'Test Automation Engineer', '🧪', 'Tests that fail for real reasons only.', 'Expert end-to-end test automation engineer for Playwright and Cypress.'],
  ['testing', 'Accessibility Auditor', '♿', 'If it was not tested with a screen reader, it is not accessible.', 'Expert accessibility specialist who audits interfaces against WCAG standards.'],
  ['testing', 'GIS QA Engineer', '🗺️', 'Checks maps before anyone trusts them.', 'Quality assurance specialist who validates geospatial data integrity.'],
  ['testing', 'Evidence Collector', '📸', 'Screenshots or it did not happen.', 'Screenshot-obsessed QA specialist who reports reproducible issues with evidence.'],
  ['marketing', 'SEO Specialist', '🔎', 'Earns the traffic you would otherwise pay for.', 'Expert search engine optimization strategist for technical SEO and organic growth.'],
  ['marketing', 'Growth Hacker', '🚀', 'Runs small experiments until a channel works.', 'Expert growth strategist for user acquisition through data-driven experimentation and conversion funnels.']
]

export function fixtureRoles(over: { installed?: string[] } = {}): RoleSummary[] {
  const installed = new Set(over.installed ?? ['cto', 'frontend-developer'])
  return SEED.map(([division, name, emoji, vibe, description]): RoleSummary => {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const d = DIVISIONS.find((x) => x.id === division)!
    return {
      id, name, division, divisionLabel: d.label, emoji, color: d.color, vibe, description,
      source: division === 'leadership' ? 'builtin' : 'agency', installed: installed.has(id), agentName: installed.has(id) ? name : null, promptChars: 1_000
    }
  })
}

export function fixtureDivisions(roles: readonly RoleSummary[] = fixtureRoles()): RoleDivision[] {
  return DIVISIONS.map((d) => ({ ...d, count: roles.filter((r) => r.division === d.id).length }))
}
