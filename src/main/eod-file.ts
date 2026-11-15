import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDay } from '@shared/day'
import { hasContent, renderEodMarkdown } from '@shared/eod-markdown'
import type { EodReport, EodSettings, EodWrite } from '@shared/work'

/** Where the `YYYY-MM-DD.md` files go: the chosen folder, or `<userData>/eod`. */
export const eodFolder = (settings: EodSettings, userData: string): string => settings.folder ?? join(userData, 'eod')

export const eodFile = (folder: string, day: string): string => join(folder, `${day}.md`)

const FILE = /^(\d{4}-\d{2}-\d{2})\.md$/

/** Days that have a report file in the folder. A missing or unreadable folder has none. */
export function eodFileDays(folder: string): string[] {
  try {
    return readdirSync(folder).flatMap((name) => {
      const day = FILE.exec(name)?.[1]
      return day && isDay(day) ? [day] : []
    })
  } catch {
    return []
  }
}

/**
 * Writes the day's markdown file: to a `.tmp` next to it, then renamed over it, so a crash never leaves half a report.
 * A report with nothing in it never replaces a file that is already there. Hand edits are not kept while a day is being
 * refreshed (soon after each change, until midnight); the user's notes are, because they live in the database, not in the file.
 */
export function writeEodFile(folder: string, report: EodReport): EodWrite {
  const path = eodFile(folder, report.day)
  if (!hasContent(report) && existsSync(path)) {
    return { ok: false, error: 'Nothing was recorded for this day, so the report file that is already there was left as it is.' }
  }
  const tmp = `${path}.tmp`
  try {
    mkdirSync(folder, { recursive: true })
    writeFileSync(tmp, renderEodMarkdown(report), 'utf8')
    renameSync(tmp, path)
    return { ok: true, path }
  } catch (err) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      // macOS says ENOTDIR (which force does not cover) when a file sits where the folder should be: no temp file exists.
    }
    return { ok: false, error: `AgentDeck could not write ${path}: ${err instanceof Error ? err.message : String(err)}` }
  }
}
