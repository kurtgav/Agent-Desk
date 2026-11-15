import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { parseFrontMatter, roleMeta } from '@shared/role-parse'
import { buildCatalog, DEFAULT_DIVISIONS, type BuiltRole, type DivisionMeta, type RawRole } from '@shared/role-catalog'
import { CUSTOM_DIVISION, LEADERSHIP_DIVISION, YOURS_DIVISION, type RoleCounts, type RoleSource, type RolesStatus } from '@shared/roles'
import { readHead, realDir, walkMarkdown } from './roles-fs'

/**
 * Reading the four places roles live into one catalog: the agency-agents clone (a folder per division), Claude Code's agents folder,
 * the user's own roles, and the ones that ship with AgentDeck. Only the front matter and the file's size are read here (8 KB each);
 * a role's text is read later, one at a time, when it is shown or used. A file is parsed again only when its size or time changed.
 */

/** Folders of the clone that hold something other than personas. `strategy` is playbooks; `integrations` is conversion output. */
const SKIP_TOP = new Set(['integrations', 'examples', 'scripts', 'strategy', 'node_modules', 'i18n', 'docs', 'tests', 'test'])
const CONCURRENCY = 24

export type RepoSource = NonNullable<RolesStatus['repoSource']>

export interface ScanPaths {
  /** Folders to try for the clone, best first. */
  repo: { path: string; source: RepoSource }[]
  /** The path the user saved, if any (it may not exist). */
  configured: string | null
  suggested: string
  installed: string
  custom: string
  builtin: string
}

/** Where a role's file is, for main only. The renderer never sees it. */
export interface Located {
  abs: string
  root: string
}

export interface Scan {
  roles: BuiltRole[]
  divisions: ReturnType<typeof buildCatalog>['divisions']
  where: Map<string, Located>
  status: RolesStatus
}

const DivisionId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/)
const DivisionEntry = z.object({ label: z.string().min(1).max(40), icon: z.string().regex(/^[A-Za-z0-9]{1,40}$/), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) })

/** The clone's `divisions.json`, merged over the built-in table so a missing or damaged file still labels every folder. One bad entry is dropped, not the file. */
export function readDivisions(repo: string | null): Record<string, DivisionMeta> {
  if (!repo) return DEFAULT_DIVISIONS
  try {
    const file: unknown = JSON.parse(readFileSync(join(repo, 'divisions.json'), 'utf8'))
    const entries = typeof file === 'object' && file !== null ? (file as { divisions?: unknown }).divisions : null
    if (typeof entries !== 'object' || entries === null) return DEFAULT_DIVISIONS
    const out: Record<string, DivisionMeta> = { ...DEFAULT_DIVISIONS }
    for (const [id, entry] of Object.entries(entries)) {
      const parsed = DivisionEntry.safeParse(entry)
      if (DivisionId.safeParse(id).success && parsed.success) out[id] = parsed.data
    }
    return out
  } catch {
    return DEFAULT_DIVISIONS
  }
}

interface Parsed {
  mtimeMs: number
  size: number
  raw: Omit<RawRole, 'source' | 'key' | 'division'> | null
}

/** Runs `fn` over `items` with a few in flight at a time: 350 small reads finish fast without opening 350 handles at once. */
async function pool<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]!)
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker))
  return out
}

export function createScanner(): { scan(paths: ScanPaths): Promise<Scan> } {
  const cache = new Map<string, Parsed>()

  async function parse(abs: string): Promise<Parsed['raw']> {
    const head = await readHead(abs)
    if (!head) return null
    const hit = cache.get(abs)
    if (hit && hit.mtimeMs === head.mtimeMs && hit.size === head.size) return hit.raw
    const fm = parseFrontMatter(head.text)
    const meta = fm ? roleMeta(fm.fields) : null
    const raw = fm && meta ? { stem: basename(abs).replace(/\.md$/i, ''), ...meta, promptChars: Math.max(0, head.size - Buffer.byteLength(head.text.slice(0, head.text.length - fm.body.length))) } : null
    cache.set(abs, { mtimeMs: head.mtimeMs, size: head.size, raw })
    return raw
  }

  async function readSource(source: RoleSource, root: string | null, maxDepth: number, divisionOf: (rel: string) => string): Promise<{ raws: RawRole[]; where: [string, Located][]; skipped: number }> {
    if (!root) return { raws: [], where: [], skipped: 0 }
    const walk = await walkMarkdown(root, { maxDepth, skipTop: source === 'agency' ? SKIP_TOP : undefined })
    // A file straight in the clone's top folder (CONTRIBUTING_zh-CN.md) has no division folder: it is not a persona, and not "skipped".
    const files = source === 'agency' ? walk.files.filter((f) => f.rel.includes('/')) : walk.files
    const parsed = await pool(files, async (f) => ({ f, raw: await parse(f.abs) }))
    const raws: RawRole[] = []
    const where: [string, Located][] = []
    let skipped = walk.refused
    for (const { f, raw } of parsed) {
      if (!raw) {
        skipped++
        continue
      }
      const key = `${source}:${f.rel}`
      raws.push({ ...raw, source, key, division: divisionOf(f.rel) })
      where.push([key, { abs: f.abs, root }])
    }
    return { raws, where, skipped }
  }

  async function scan(paths: ScanPaths): Promise<Scan> {
    const t0 = Date.now()
    let repo: { path: string; source: RepoSource } | null = null
    for (const c of paths.repo) {
      const real = await realDir(c.path)
      if (real) {
        repo = { path: real, source: c.source }
        break
      }
    }
    const [installedRoot, customRoot, builtinRoot] = await Promise.all([realDir(paths.installed), realDir(paths.custom), realDir(paths.builtin)])
    // Folders are different roots, so one slow read of the clone does not hold up the others.
    const [agency, installed, custom, builtin] = await Promise.all([
      readSource('agency', repo?.path ?? null, 3, (rel) => rel.split('/')[0]!),
      readSource('installed', installedRoot, 2, () => YOURS_DIVISION),
      readSource('custom', customRoot, 1, () => CUSTOM_DIVISION),
      readSource('builtin', builtinRoot, 1, () => LEADERSHIP_DIVISION)
    ])
    const skipped = agency.skipped + installed.skipped + custom.skipped + builtin.skipped
    const built = buildCatalog([...builtin.raws, ...custom.raws, ...agency.raws, ...installed.raws], readDivisions(repo?.path ?? null))

    const where = new Map<string, Located>([...agency.where, ...installed.where, ...custom.where, ...builtin.where])
    const counts: RoleCounts = {
      agency: built.roles.filter((r) => r.source === 'agency').length,
      installed: built.roles.filter((r) => r.source === 'installed').length,
      installedFlagged: built.roles.filter((r) => r.installed).length,
      custom: built.roles.filter((r) => r.source === 'custom').length,
      builtin: built.roles.filter((r) => r.source === 'builtin').length,
      total: built.roles.length,
      duplicates: built.duplicates,
      skipped
    }
    // Forget files that are gone, so the cache stays the size of the catalog.
    const live = new Set([...where.values()].map((l) => l.abs))
    for (const k of cache.keys()) if (!live.has(k)) cache.delete(k)

    const configuredMissing = paths.configured !== null && !(await realDir(paths.configured))
    return {
      roles: built.roles,
      divisions: built.divisions,
      where,
      status: {
        repoPath: repo?.path ?? null,
        repoFound: repo !== null,
        repoSource: repo?.source ?? null,
        configuredPath: paths.configured,
        configuredMissing,
        suggestedPath: paths.suggested,
        installedPath: paths.installed,
        installedFound: installedRoot !== null,
        customPath: paths.custom,
        counts,
        scannedAt: Date.now(),
        durationMs: Date.now() - t0
      }
    }
  }
  return { scan }
}
