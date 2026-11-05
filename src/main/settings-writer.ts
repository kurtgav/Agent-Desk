// ADR-0005 § 4: the only code that writes Claude Code's settings.json. No electron import: unit-testable.
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { foreignUnchanged, type Plan } from './hooks-install'

export type WriteResult = { ok: true; backup: string | null } | { ok: false; error: string }

const ATTEMPTS = 3
const RENAME_RETRIES = 3
const RENAME_WAIT_MS = 50
const BACKUPS_KEPT = 20
const BACKUP_NAME = /^settings-\d{8}-\d{6}-\d{3}\.json$/

const code = (e: unknown): unknown => (e as NodeJS.ErrnoException | null)?.code

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch (e) {
    if (code(e) === 'ENOENT') return null
    throw e
  }
}

/** yyyyMMdd-HHmmss-SSS in UTC, so names sort in time order across DST changes. */
const stamp = (d: Date): string =>
  d.toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '-').slice(0, 19)

function saveBackup(text: string, dir: string, at: Date): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `settings-${stamp(at)}.json`)
  writeFileSync(file, text)
  const old = readdirSync(dir).filter((f) => BACKUP_NAME.test(f)).sort().slice(0, -BACKUPS_KEPT)
  for (const f of old) rmSync(join(dir, f), { force: true })
  return file
}

// Windows (AV scanners, Claude Code's own file watcher) can hold the target for a moment.
function renameWithRetry(from: string, to: string): void {
  for (let retry = 0; ; retry++) {
    try {
      return renameSync(from, to)
    } catch (e) {
      if (retry >= RENAME_RETRIES || (code(e) !== 'EPERM' && code(e) !== 'EBUSY')) throw e
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RENAME_WAIT_MS)
    }
  }
}

function tryWrite(path: string, tmp: string, makePlan: (text: string | null) => Plan, backupsDir: string, now: () => Date): WriteResult {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const text = readText(path)
    const plan = makePlan(text)
    if (!plan.ok) return plan
    if (!plan.changed) return { ok: true, backup: null }
    const backup = text === null ? null : saveBackup(text, backupsDir, now())
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(tmp, plan.after)
    // Someone (Claude Code, the user's editor) wrote since we read: plan again from their version.
    if (readText(path) !== text) {
      rmSync(tmp, { force: true })
      continue
    }
    renameWithRetry(tmp, path)
    const written = readText(path)
    if (written === plan.after && foreignUnchanged(text, written)) return { ok: true, backup }
    if (text === null) rmSync(path, { force: true })
    else writeFileSync(path, text)
    return { ok: false, error: 'settings.json did not validate after writing; the original was restored' }
  }
  return { ok: false, error: 'settings.json kept changing' }
}

/**
 * ADR-0005 § 4 writer: plan from the current text, back up the original, write a temp file, re-check the target
 * (retry up to 3 times if it changed), rename, then validate and restore on failure. Never throws.
 */
export function writeSettings(
  path: string,
  makePlan: (text: string | null) => Plan,
  backupsDir: string,
  now: () => Date = () => new Date()
): WriteResult {
  const tmp = `${path}.agentdeck.tmp`
  try {
    return tryWrite(path, tmp, makePlan, backupsDir, now)
  } catch (e) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      // best effort: the next write overwrites a leftover temp file anyway
    }
    return { ok: false, error: `Could not write ${path}: ${e instanceof Error ? e.message : String(e)}` }
  }
}
