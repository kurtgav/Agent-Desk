import type { History } from '@shared/detail'
import { dayKey } from '@/lib/work'

/** Pure helpers behind the Files and Activity rows, apart from their components so they can be unit-tested. */

const slashed = (p: string): string => p.replaceAll('\\', '/')

/** The file's name, and its folder inside the project when the path is under it (else the folder as given). */
export function splitPath(path: string, cwd: string): { dir: string; name: string } {
  const p = slashed(path)
  const root = slashed(cwd).replace(/\/+$/, '')
  const rel = root && p.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? p.slice(root.length + 1) : p
  const i = rel.lastIndexOf('/')
  return i < 0 ? { dir: '', name: rel } : { dir: rel.slice(0, i), name: rel.slice(i + 1) }
}

type ActivityRow = History['activity'][number]

/** Consecutive events of one local day, in the order they arrive (newest first). */
export function byDay(rows: readonly ActivityRow[]): { day: string; rows: ActivityRow[] }[] {
  const groups: { day: string; rows: ActivityRow[] }[] = []
  for (const r of rows) {
    const day = dayKey(r.ts)
    const last = groups[groups.length - 1]
    if (last?.day === day) last.rows.push(r)
    else groups.push({ day, rows: [r] })
  }
  return groups
}
