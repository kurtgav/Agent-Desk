import { dayParts } from './day'
import { projectName } from './paths'
import type { EodBlocker, EodReport, EodSession, WorkTask } from './work'

/**
 * The Daily report as a GitHub-flavoured markdown file. Pure and deterministic: the same report always gives the same
 * text, in a stable order, and nothing here reads the clock or the locale.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'
]
const KIND_LABEL = { approval: 'Approval', question: 'Question', failed: 'Failed', stuck: 'Stuck', review: 'To review' } as const

/** `2h 14m`, `45m`, `<1m`, `0m`; whole hours read `2h`. Rounds to the minute first, so 59 m 40 s is `1h`. */
export function formatDuration(ms: number): string {
  const minutes = Math.round(Math.max(0, ms) / 60_000)
  if (minutes === 0) return ms > 0 ? '<1m' : '0m'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** Whether the report says anything: agent work, a finished task, or the user's notes. Open tasks alone don't count. */
export function hasContent(r: EodReport): boolean {
  const t = r.totals
  return t.agentTimeMs > 0 || t.sessions > 0 || t.tasksDone > 0 || t.filesChanged > 0 || r.sessions.length > 0 || r.tasksDone.length > 0 || r.notes.trim() !== ''
}

/** Code-unit order, so the output does not depend on the machine's locale. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`
/** One line, whatever the text held: a title with a line break must not break the list around it. */
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()
const inProject = (project: string | null): string => (project ? ` (${projectName(project)})` : '')
/** " as CTO": the role a task was for, by the name it had when it was chosen. */
const asRole = (t: WorkTask): string => (t.roleName ? ` as ${oneLine(t.roleName)}` : '')

function longDay(day: string): string {
  const p = dayParts(day)
  if (!p) return day
  const weekday = WEEKDAYS[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()]
  return `${weekday}, ${p[2]} ${MONTHS[p[1] - 1]} ${p[0]}`
}

function summary(r: EodReport): string {
  const t = r.totals
  if (t.agentTimeMs === 0 && t.sessions === 0 && t.tasksDone === 0 && t.filesChanged === 0) return 'Quiet day: no agent work and no finished tasks.'
  return [
    `${formatDuration(t.agentTimeMs)} agent time`,
    plural(t.sessions, 'session'),
    plural(t.tasksDone, 'task') + ' done',
    plural(t.filesChanged, 'file') + ' changed'
  ].join(' · ')
}

const byDoneAt = (a: WorkTask, b: WorkTask): number => (a.doneAt ?? 0) - (b.doneAt ?? 0) || cmp(a.id, b.id)
const byTimeThenName = (a: { agentTimeMs: number; name: string }, b: { agentTimeMs: number; name: string }): number =>
  b.agentTimeMs - a.agentTimeMs || cmp(a.name, b.name)
/** In progress first, then oldest first. */
const byCarryOver = (a: WorkTask, b: WorkTask): number =>
  Number(b.status === 'doing') - Number(a.status === 'doing') || a.createdAt - b.createdAt || cmp(a.id, b.id)

function finishedLine(s: EodSession): string {
  const where = [s.project ? projectName(s.project) : '', formatDuration(s.agentTimeMs)].filter(Boolean).join(', ')
  return `- **${oneLine(s.name)}** (${where})${s.summary ? `: ${oneLine(s.summary)}` : ''}`
}

const blockerLine = (b: EodBlocker): string => `- **${KIND_LABEL[b.kind]}**${b.project ? ` in ${projectName(b.project)}` : ''}: ${oneLine(b.title)}`

function sections(r: EodReport): string[][] {
  const done = [
    ...[...r.tasksDone].sort(byDoneAt).map((t) => `- [x] ${oneLine(t.title)}${inProject(t.project)}${asRole(t)}`),
    ...r.sessions.filter((s) => s.status === 'done').sort((a, b) => byTimeThenName(a, b) || cmp(a.id, b.id)).map(finishedLine)
  ]
  const work = [...r.projects]
    .sort(byTimeThenName)
    .map((p) => `- **${oneLine(p.name)}** · ${formatDuration(p.agentTimeMs)} · ${plural(p.sessions, 'session')} · ${plural(p.files, 'file')}`)
  const needs = [...r.blockers].sort((a, b) => a.openedAt - b.openedAt || cmp(a.itemId, b.itemId)).map(blockerLine)
  const tomorrow = [...r.carryOver]
    .sort(byCarryOver)
    .map((t) => `- [ ] ${oneLine(t.title)}${inProject(t.project)}${asRole(t)}${t.status === 'doing' ? ' · in progress' : ''}`)
  const notes = r.notes.trimEnd()
  return [
    ['Done', ...done],
    ['Agent work', ...work],
    ['Needs you', ...needs],
    ['Tomorrow', ...tomorrow],
    ['Notes', ...(oneLine(notes) ? [notes] : [])]
  ]
    .filter((s) => s.length > 1)
    .map(([title, ...body]) => [`## ${title}`, '', ...body])
}

/** `# End of day: Friday, 13 November 2026`, a summary line, then only the sections that have something to say. */
export function renderEodMarkdown(report: EodReport): string {
  const blocks = [[`# End of day: ${longDay(report.day)}`], [summary(report)], ...sections(report)]
  return blocks.map((b) => b.join('\n')).join('\n\n') + '\n'
}
