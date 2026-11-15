import { describe, expect, it } from 'vitest'
import { formatDuration, hasContent, renderEodMarkdown } from './eod-markdown'
import type { EodReport, EodSession, WorkTask } from './work'

const MIN = 60_000
const HOUR = 60 * MIN

const empty = (day = '2026-11-13'): EodReport => ({
  day,
  generatedAt: 0,
  closed: false,
  totals: { agentTimeMs: 0, sessions: 0, turns: 0, filesChanged: 0, approvalsAnswered: 0, tasksDone: 0 },
  projects: [],
  sessions: [],
  tasksDone: [],
  carryOver: [],
  blockers: [],
  notes: ''
})

const task = (over: Partial<WorkTask>): WorkTask => ({
  id: 't1', title: 'A task', project: null, status: 'todo', createdAt: 1, doneAt: null, sessionName: null, ...over
})
const session = (over: Partial<EodSession>): EodSession => ({
  id: 's1', name: 'api', project: 'D:\\code\\agentdeck', status: 'done', startedAt: 0, lastEventAt: 0, agentTimeMs: HOUR, plan: null, summary: null, ...over
})

// A day that is over; today's report is the same shape with `closed: false`.
const full: EodReport = {
  ...empty(),
  closed: true,
  totals: { agentTimeMs: 2 * HOUR + 14 * MIN, sessions: 3, turns: 9, filesChanged: 12, approvalsAnswered: 4, tasksDone: 2 },
  projects: [
    { cwd: 'D:\\code\\site', name: 'site', agentTimeMs: 20 * MIN, sessions: 1, turns: 2, files: 1 },
    { cwd: 'D:\\code\\agentdeck', name: 'agentdeck', agentTimeMs: 1 * HOUR + 54 * MIN, sessions: 2, turns: 7, files: 11 }
  ],
  sessions: [
    session({ id: 's2', name: 'refactor', agentTimeMs: 54 * MIN, summary: 'Moved the routes to the new router.' }),
    session({ id: 's1', name: 'api', agentTimeMs: HOUR, summary: 'Added the tasks table.' }),
    session({ id: 's3', name: 'wip', project: 'D:\\code\\site', status: 'working', agentTimeMs: 20 * MIN })
  ],
  tasksDone: [
    task({ id: 'b', title: 'Ship the\nreport', project: 'D:\\code\\agentdeck', status: 'done', doneAt: 200 }),
    task({ id: 'a', title: 'Fix login', status: 'done', doneAt: 100 })
  ],
  carryOver: [
    task({ id: 'c', title: 'Write docs', createdAt: 5 }),
    task({ id: 'd', title: 'Review PR', project: 'D:\\code\\site', status: 'doing', createdAt: 9 })
  ],
  blockers: [
    { itemId: 'i1', kind: 'approval', title: 'Run `git push --force`', sessionId: 's1', project: 'D:\\code\\agentdeck', openedAt: 10 },
    { itemId: 'i2', kind: 'review', title: 'wip finished', sessionId: 's3', project: '', openedAt: 5 }
  ],
  notes: 'Talked to Sam.\n\n- follow up Monday\n'
}

describe('formatDuration', () => {
  it('reads like 2h 14m', () => {
    expect(formatDuration(2 * HOUR + 14 * MIN)).toBe('2h 14m')
    expect(formatDuration(45 * MIN)).toBe('45m')
    expect(formatDuration(HOUR)).toBe('1h')
    expect(formatDuration(0)).toBe('0m')
    expect(formatDuration(20_000)).toBe('<1m')
    expect(formatDuration(59 * MIN + 40_000)).toBe('1h')
    expect(formatDuration(-5)).toBe('0m')
  })
})

describe('renderEodMarkdown', () => {
  it('writes every section in a stable order', () => {
    expect(renderEodMarkdown(full)).toBe(`# End of day: Friday, 13 November 2026

2h 14m agent time · 3 sessions · 2 tasks done · 12 files changed

## Done

- [x] Fix login
- [x] Ship the report (agentdeck)
- **api** (agentdeck, 1h): Added the tasks table.
- **refactor** (agentdeck, 54m): Moved the routes to the new router.

## Agent work

- **agentdeck** · 1h 54m · 2 sessions · 11 files
- **site** · 20m · 1 session · 1 file

## Needs you

- **To review**: wip finished
- **Approval** in agentdeck: Run \`git push --force\`

## Tomorrow

- [ ] Review PR (site) · in progress
- [ ] Write docs

## Notes

Talked to Sam.

- follow up Monday
`)
  })

  it('does not depend on the order of the input', () => {
    const shuffled: EodReport = {
      ...full,
      projects: [...full.projects].reverse(),
      sessions: [...full.sessions].reverse(),
      tasksDone: [...full.tasksDone].reverse(),
      carryOver: [...full.carryOver].reverse(),
      blockers: [...full.blockers].reverse()
    }
    expect(renderEodMarkdown(shuffled)).toBe(renderEodMarkdown(full))
  })

  it('reads the same for a day in progress and a day that is over: `closed` is not printed', () => {
    expect(renderEodMarkdown({ ...full, closed: false })).toBe(renderEodMarkdown({ ...full, closed: true }))
  })

  it('is the same text every time', () => {
    expect(renderEodMarkdown(full)).toBe(renderEodMarkdown(structuredClone(full)))
  })

  it('says so on an empty day and writes no sections', () => {
    expect(renderEodMarkdown(empty('2026-02-01'))).toBe(`# End of day: Sunday, 1 February 2026

Quiet day: no agent work and no finished tasks.
`)
  })

  it('omits empty sections and keeps the notes section only when there are notes', () => {
    const md = renderEodMarkdown({ ...empty(), carryOver: [task({ title: 'Later' })], notes: '   \n' })
    expect(md).toContain('## Tomorrow')
    for (const gone of ['## Done', '## Agent work', '## Needs you', '## Notes']) expect(md).not.toContain(gone)
  })

  it('counts one of each in the singular and lists only finished sessions under Done', () => {
    const md = renderEodMarkdown({
      ...empty(),
      totals: { ...empty().totals, agentTimeMs: 5 * MIN, sessions: 1, filesChanged: 1, tasksDone: 1 },
      sessions: [session({ status: 'idle' })]
    })
    expect(md).toContain('5m agent time · 1 session · 1 task done · 1 file changed')
    expect(md).not.toContain('## Done')
  })

  it('falls back to the raw key for a day it cannot read', () => {
    expect(renderEodMarkdown(empty('not-a-day'))).toContain('# End of day: not-a-day')
  })
})

describe('hasContent', () => {
  it('is false for an empty day or one with only open tasks, true once something happened or was noted', () => {
    expect(hasContent(empty())).toBe(false)
    expect(hasContent({ ...empty(), carryOver: [task({})] })).toBe(false)
    expect(hasContent({ ...empty(), notes: 'x' })).toBe(true)
    expect(hasContent({ ...empty(), sessions: [session({})] })).toBe(true)
    expect(hasContent({ ...empty(), totals: { ...empty().totals, filesChanged: 1 } })).toBe(true)
    expect(hasContent({ ...empty(), tasksDone: [task({ status: 'done', doneAt: 1 })] })).toBe(true)
  })
})

describe('the role of a task in the report', () => {
  const report = (over: Partial<EodReport>): EodReport => ({ ...empty(), ...over })

  it('is written after the task, by the name it had when it was chosen', () => {
    const md = renderEodMarkdown(
      report({
        tasksDone: [task({ id: 'a', title: 'Plan the launch', status: 'done', doneAt: 5, role: 'cto', roleName: 'CTO' }), task({ id: 'b', title: 'Fix login', status: 'done', doneAt: 6, project: 'D:/code/site', roleName: 'QA Engineer' })],
        carryOver: [task({ id: 'c', title: 'Write docs', status: 'doing', role: 'tw', roleName: 'Technical Writer' })]
      })
    )
    expect(md).toContain('- [x] Plan the launch as CTO\n')
    expect(md).toContain('- [x] Fix login (site) as QA Engineer\n')
    expect(md).toContain('- [ ] Write docs as Technical Writer · in progress\n')
  })

  it('is left out for a task with no role, and kept to one line', () => {
    const md = renderEodMarkdown(report({ tasksDone: [task({ title: 'Plain', status: 'done', doneAt: 5 }), task({ id: 'b', title: 'Odd', status: 'done', doneAt: 6, roleName: 'Two\nLines' })] }))
    expect(md).toContain('- [x] Plain\n')
    expect(md).toContain('- [x] Odd as Two Lines\n')
  })
})
