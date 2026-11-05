// ADR-0005 § 4: the only code that writes Claude Code's settings.json. No electron import: unit-testable.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { foreignUnchanged, type Plan } from './hooks-install'

export type WriteResult = { ok: true; backup: string | null } | { ok: false; error: string }

const ATTEMPTS = 3
const RENAME_RETRIES = 3
const RENAME_WAIT_MS = 50
const BACKUPS_KEPT = 20
const BACKUP_NAME = /^settings-\d{8}-\d{6}-\d{3}\.json$/

const code = (e: unknown): unknown => (e as NodeJS.ErrnoException | null)?.code

// fatal: bytes that aren't UTF-8 would come back as U+FFFD and be written over the user's text.
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/** The file's text, or null when it does not exist; other read errors (and non-UTF-8 bytes) throw. */
export function readText(path: string): string | null {
  let bytes: Buffer
  try {
    bytes = readFileSync(path)
  } catch (e) {
    if (code(e) === 'ENOENT') return null
    throw e
  }
  try {
    return UTF8.decode(bytes)
  } catch {
    throw new Error('settings.json is not UTF-8 text')
  }
}

/** A linked settings.json (dotfile managers) is edited at its target, so the link survives; a dangling link throws. */
function resolveLink(path: string): string {
  let link = false
  try {
    link = lstatSync(path).isSymbolicLink()
  } catch (e) {
    if (code(e) !== 'ENOENT') throw e
  }
  return link ? realpathSync(path) : path
}

/** yyyyMMdd-HHmmss-SSS in UTC, so names sort in time order across DST changes. */
const stamp = (d: Date): string =>
  d.toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '-').slice(0, 19)

function saveBackup(text: string, dir: string, at: Date): string {
  mkdirSync(dir, { recursive: true })
  const backups = (): string[] => readdirSync(dir).filter((f) => BACKUP_NAME.test(f)).sort()
  // Launch and quit alternate between the same two texts: an identical copy moves to the newest slot instead of
  // piling up, so the 20 kept reach back past the last real edit.
  const same = backups().find((f) => readText(join(dir, f)) === text)
  // A free name, so two writes in one millisecond never overwrite each other's backup.
  let t = at.getTime()
  let name = `settings-${stamp(new Date(t))}.json`
  while (name !== same && existsSync(join(dir, name))) name = `settings-${stamp(new Date(++t))}.json`
  const file = join(dir, name)
  if (same) renameSync(join(dir, same), file)
  else writeFileSync(file, text)
  for (const f of backups().slice(0, -BACKUPS_KEPT)) rmSync(join(dir, f), { force: true })
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
    // Someone wrote right after us: their version wins, and the next status check shows where that leaves us.
    if (written !== plan.after) return { ok: false, error: 'settings.json changed while AgentDeck was writing it, so AgentDeck left it as it is' }
    if (foreignUnchanged(text, written)) return { ok: true, backup }
    // Our own edit touched something else: put the original back, atomically too.
    if (text === null) rmSync(path, { force: true })
    else {
      writeFileSync(tmp, text)
      renameWithRetry(tmp, path)
    }
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
  let tmp = `${path}.agentdeck.tmp`
  try {
    const file = resolveLink(path)
    tmp = `${file}.agentdeck.tmp` // beside the real file, so the rename stays on one volume
    return tryWrite(file, tmp, makePlan, backupsDir, now)
  } catch (e) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      // best effort: the next write overwrites a leftover temp file anyway
    }
    return { ok: false, error: `Could not write ${path}: ${e instanceof Error ? e.message : String(e)}` }
  }
}
