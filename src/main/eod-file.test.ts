import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { renderEodMarkdown } from '@shared/eod-markdown'
import type { EodReport } from '@shared/work'
import { eodFile, eodFileDays, eodFolder, writeEodFile } from './eod-file'

const dirs: string[] = []
const temp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'agentdeck-eod-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const report = (day: string, busy = true): EodReport => ({
  day,
  generatedAt: 0,
  closed: true,
  totals: { agentTimeMs: busy ? 60_000 : 0, sessions: busy ? 1 : 0, turns: 0, filesChanged: 0, approvalsAnswered: 0, tasksDone: 0 },
  projects: [],
  sessions: [],
  tasksDone: [],
  carryOver: [],
  blockers: [],
  notes: ''
})

describe('eodFolder', () => {
  it('is the chosen folder, or eod inside the app data folder', () => {
    expect(eodFolder({ enabled: true, time: '18:00', folder: 'E:\\notes' }, 'C:\\data')).toBe('E:\\notes')
    expect(eodFolder({ enabled: true, time: '18:00', folder: null }, 'C:\\data')).toBe(join('C:\\data', 'eod'))
  })
})

describe('writeEodFile', () => {
  it('creates the folder and writes YYYY-MM-DD.md with the rendered report', () => {
    const folder = join(temp(), 'nested', 'eod')
    const r = report('2026-11-13')
    const w = writeEodFile(folder, r)
    expect(w).toEqual({ ok: true, path: eodFile(folder, '2026-11-13') })
    expect(readFileSync(join(folder, '2026-11-13.md'), 'utf8')).toBe(renderEodMarkdown(r))
    expect(readdirSync(folder)).toEqual(['2026-11-13.md']) // no .tmp left behind
  })

  it('replaces an earlier version of the same day', () => {
    const folder = temp()
    writeEodFile(folder, report('2026-11-13'))
    writeEodFile(folder, { ...report('2026-11-13'), notes: 'later' })
    expect(readFileSync(join(folder, '2026-11-13.md'), 'utf8')).toContain('later')
  })

  it('never replaces a file with an empty report, but writes one where there is no file yet', () => {
    const folder = temp()
    writeEodFile(folder, report('2026-11-13'))
    const before = readFileSync(join(folder, '2026-11-13.md'), 'utf8')
    const w = writeEodFile(folder, report('2026-11-13', false))
    expect(w).toMatchObject({ ok: false })
    expect(readFileSync(join(folder, '2026-11-13.md'), 'utf8')).toBe(before)
    expect(writeEodFile(folder, report('2026-11-14', false))).toMatchObject({ ok: true })
  })

  it('says what went wrong in words, and cleans up its temp file', () => {
    const base = temp()
    const blocker = join(base, 'a-file')
    writeFileSync(blocker, 'x')
    const w = writeEodFile(join(blocker, 'inside'), report('2026-11-13')) // a file where the folder should be
    expect(w.ok).toBe(false)
    expect(w.ok ? '' : w.error).toMatch(/^AgentDeck could not write .*2026-11-13\.md: /)
    // The destination is a folder, so the rename fails after the temp file was written.
    const dest = temp()
    mkdirSync(join(dest, '2026-11-13.md'))
    const clash = writeEodFile(dest, report('2026-11-13'))
    expect(clash.ok).toBe(false)
    expect(existsSync(join(dest, '2026-11-13.md.tmp'))).toBe(false)
  })
})

describe('eodFileDays', () => {
  it('lists report files only, and nothing for a missing folder', () => {
    const folder = temp()
    for (const name of ['2026-11-12.md', '2026-11-13.md', '2026-13-40.md', 'notes.md', '2026-11-14.md.tmp', '2026-11-15.txt']) writeFileSync(join(folder, name), '')
    expect(eodFileDays(folder).sort()).toEqual(['2026-11-12', '2026-11-13'])
    expect(eodFileDays(join(folder, 'missing'))).toEqual([])
  })
})
