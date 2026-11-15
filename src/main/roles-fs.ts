import { randomBytes } from 'node:crypto'
import { open, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { ROLE_PROMPT_MAX } from '@shared/roles'

/**
 * The only way roles are read or written (ADR-0009: role files are definition files; nothing is executed). Every read stays inside a
 * root the caller names: a link that leads out of it is refused, a directory link is not followed, sizes are capped, and a write
 * goes to a temp file first. No electron import: unit-testable on a throwaway folder.
 */

/** Front matter sits at the top; 8 KB holds it for every role on this machine. */
export const HEAD_BYTES = 8 * 1024
/** A role file bigger than this is not read: the prompt cap, plus room for its front matter. */
export const ROLE_FILE_MAX = ROLE_PROMPT_MAX + 16 * 1024
/** A clone has about 300 files; this stops a mistaken pick (a whole drive) from walking forever. */
export const WALK_LIMIT = 4_000

/** True when `child` is `root` or below it. Case-insensitive on Windows, as the file system is. */
export function inside(root: string, child: string): boolean {
  const rel = relative(root, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** The real path of a folder (links resolved), or null when it is missing or not a folder. */
export async function realDir(dir: string): Promise<string | null> {
  try {
    const real = await realpath(dir)
    return (await stat(real)).isDirectory() ? real : null
  } catch {
    return null
  }
}

export interface Found {
  abs: string
  /** Relative to the root, with `/` separators: a stable key. */
  rel: string
}

export interface Walk {
  files: Found[]
  /** Links that led outside the root, or other things that are not plain files. */
  refused: number
}

/** Names of files that are about a folder, not roles. Exact: `security-architect.md` is a role, `SECURITY.md` is not. */
const NOT_A_ROLE = /^(readme|contributing|code_of_conduct|security|license|licence|changelog|install|notice)(\.[a-z-]+)?\.md$/i

/**
 * The `.md` files under `root`, at most `maxDepth` folders down. Folders and files starting with `.` are skipped, and so are the
 * top-level folders in `skipTop`. A directory link is never followed; a file link counts only if its target is inside `root`.
 */
export async function walkMarkdown(root: string, opts: { maxDepth: number; skipTop?: ReadonlySet<string> }): Promise<Walk> {
  const files: Found[] = []
  let refused = 0
  const visit = async (dir: string, depth: number): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      if (files.length >= WALK_LIMIT || e.name.startsWith('.')) continue
      const abs = join(dir, e.name)
      if (e.isDirectory()) {
        if (depth < opts.maxDepth && !(depth === 0 && opts.skipTop?.has(e.name.toLowerCase()))) await visit(abs, depth + 1)
      } else if (e.isFile() || e.isSymbolicLink()) {
        if (!e.name.toLowerCase().endsWith('.md') || NOT_A_ROLE.test(e.name)) continue
        if (e.isSymbolicLink() && !(await linkStaysInside(root, abs))) {
          refused++
          continue
        }
        files.push({ abs, rel: relative(root, abs).split(sep).join('/') })
      }
    }
  }
  await visit(root, 0)
  return { files, refused }
}

/** A file link is fine if it ends at a plain file inside the root. */
async function linkStaysInside(root: string, link: string): Promise<boolean> {
  try {
    const target = await realpath(link)
    return inside(root, target) && (await stat(target)).isFile()
  } catch {
    return false
  }
}

export interface Head {
  text: string
  size: number
  mtimeMs: number
}

/** The first HEAD_BYTES of a file, with the size and time of the file as it was opened (no gap between a stat and the read). */
export async function readHead(file: string): Promise<Head | null> {
  let fh
  try {
    fh = await open(file, 'r')
    const st = await fh.stat()
    if (!st.isFile()) return null
    const buf = Buffer.alloc(Math.min(HEAD_BYTES, st.size))
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
    return { text: buf.subarray(0, bytesRead).toString('utf8'), size: st.size, mtimeMs: st.mtimeMs }
  } catch {
    return null
  } finally {
    await fh?.close()
  }
}

/** The whole file as text, or null when it is missing, not a plain file, or larger than `max` bytes. */
export async function readCapped(file: string, max = ROLE_FILE_MAX): Promise<string | null> {
  let fh
  try {
    fh = await open(file, 'r')
    const st = await fh.stat()
    if (!st.isFile() || st.size > max) return null
    const buf = Buffer.alloc(st.size)
    const { bytesRead } = await fh.read(buf, 0, st.size, 0)
    return buf.subarray(0, bytesRead).toString('utf8')
  } catch {
    return null
  } finally {
    await fh?.close()
  }
}

/** Reads `file` only if its real path is inside `root`'s real path (a link swapped in after the scan cannot lead elsewhere). */
export async function readInside(root: string, file: string, max = ROLE_FILE_MAX): Promise<string | null> {
  try {
    const [realRoot, realFile] = await Promise.all([realpath(root), realpath(file)])
    return inside(realRoot, realFile) ? await readCapped(realFile, max) : null
  } catch {
    return null
  }
}

/** Write to a temp file in the same folder, then rename over the target, so a crash never leaves half a role. */
export async function writeAtomic(file: string, text: string): Promise<void> {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(tmp, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await rename(tmp, file)
  } catch (e) {
    await unlink(tmp).catch(() => undefined)
    throw e
  }
}

export async function removeFile(file: string): Promise<void> {
  await unlink(file)
}
