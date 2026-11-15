import { SYNONYMS } from './role-synonyms'
import type { RoleHit, RoleSummary } from './roles'

/**
 * Finding a role, with no model and no network. `searchRoles` is for the search box (what you typed against names first, then the
 * one-liner, division and description; synonyms for titles; typo tolerant). `suggestRoles` ranks roles for a task written in
 * free text with TF-IDF over their descriptions and says which words matched. Both are pure and run in the renderer.
 */

export type Searchable = Pick<RoleSummary, 'id' | 'name' | 'vibe' | 'description' | 'divisionLabel'>

const STOP = new Set(
  'a an the and or of to for in on with is are be our my your we i it its this that these those from by at as do does did how can could would should you me us has have had was were will please need want help some all any new using use into about than then so but not no more most very just also there their them what which when where who why if up out over under again more get got make makes made'.split(' ')
)

/** Words with punctuation that matters get a plain spelling first, so "C# developer" is not just "c developer". */
function plain(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/c#/g, 'csharp')
    .replace(/f#/g, 'fsharp')
    .replace(/c\+\+/g, 'cpp')
    .replace(/\.net\b/g, 'dotnet')
    .replace(/node\.js/g, 'nodejs')
    .replace(/&/g, ' and ')
}

export function words(text: string): string[] {
  return plain(text).split(/[^a-z0-9]+/).filter((w) => w.length > 0)
}

/** A small suffix stripper: enough to make "queries" and "query", "optimizer" and "optimizing" meet. Not linguistics. */
export function stem(word: string): string {
  let w = word
  if (w.length <= 3) return w
  if (w.endsWith('ies') && w.length > 4) w = `${w.slice(0, -3)}y`
  else if (w.endsWith('sses')) w = w.slice(0, -2)
  else if (/[^su]s$/.test(w) && !w.endsWith('is')) w = w.slice(0, -1)
  for (let pass = 0; pass < 2; pass++) {
    const m = /^(.{4,}?)(ization|ations|ation|ments|ment|ings|ing|ers|ed|er|or|ly|ness)$/.exec(w)
    if (!m) break
    w = m[1]!
  }
  return w.length > 4 && w.endsWith('e') ? w.slice(0, -1) : w
}

const stems = (text: string): string[] => words(text).map(stem)

function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
      row.push(v)
      if (v < best) best = v
    }
    if (best > max) return max + 1
    prev = row
  }
  return prev[b.length]!
}

/** 3 exact, 2 prefix (a stem begins with what was typed), 1 close (a typo or two away), 0 none. */
function level(set: ReadonlySet<string>, t: string, fuzzy = true, exactOnly = false): number {
  if (set.has(t)) return 3
  if (exactOnly) return 0
  let best = 0
  const max = t.length >= 8 ? 2 : t.length >= 4 ? 1 : 0
  for (const s of set) {
    if (t.length >= 2 && s.startsWith(t)) return 2
    if (fuzzy && max > 0 && best === 0 && distance(t, s, max) <= max) best = 1
  }
  return best
}

interface Entry {
  role: Searchable
  nameNorm: string
  nameStems: Set<string>
  vibeStems: Set<string>
  descStems: Set<string>
  divStems: Set<string>
  /** Term frequency for TF-IDF: the name counts three times. */
  tf: Map<string, number>
}

interface Index {
  entries: Entry[]
  df: Map<string, number>
}

const cache = new WeakMap<readonly Searchable[], Index>()

function indexOf(roles: readonly Searchable[]): Index {
  const hit = cache.get(roles)
  if (hit) return hit
  const df = new Map<string, number>()
  const entries = roles.map((role): Entry => {
    const nameStems = new Set(stems(role.name))
    const vibeStems = new Set(stems(role.vibe))
    const descStems = new Set(stems(role.description))
    const divStems = new Set(stems(role.divisionLabel))
    const tf = new Map<string, number>()
    const add = (set: Iterable<string>, weight: number): void => {
      for (const t of set) tf.set(t, (tf.get(t) ?? 0) + weight)
    }
    add(nameStems, 3)
    add(vibeStems, 1)
    add(descStems, 1)
    add(divStems, 1)
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1)
    return { role, nameNorm: words(role.name).join(' '), nameStems, vibeStems, descStems, divStems, tf }
  })
  const index = { entries, df }
  cache.set(roles, index)
  return index
}

const FIELD_WEIGHT = {
  name: [0, 5, 8, 12],
  vibe: [0, 0.6, 1.2, 3],
  div: [0, 0.5, 1.2, 3],
  desc: [0, 0.5, 1, 2]
} as const

/**
 * What one word scores against one role. A short word that is itself an abbreviation we know ("fe", "ui", "pm") must match whole:
 * as a prefix it would find FedRAMP and Feishu for "fe".
 */
function scoreWord(e: Entry, t: string, exactOnly = t.length <= 2 && t in SYNONYMS): number {
  return (
    FIELD_WEIGHT.name[level(e.nameStems, t, true, exactOnly)]! +
    FIELD_WEIGHT.vibe[level(e.vibeStems, t, false, exactOnly)]! +
    FIELD_WEIGHT.div[level(e.divStems, t, false, exactOnly)]! +
    FIELD_WEIGHT.desc[level(e.descStems, t, true, exactOnly)]!
  )
}

/** Synonym words for a typed word, or for a phrase of typed words (longest first). */
function expand(typed: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (let size = Math.min(3, typed.length); size >= 1; size--) {
    for (let i = 0; i + size <= typed.length; i++) {
      const key = typed.slice(i, i + size).join(' ')
      const syn = SYNONYMS[key]
      if (syn) out.set(key, syn)
    }
  }
  return out
}

const SYNONYM_WEIGHT = 0.3
const SYNONYM_CAP = 8
/** A key's first synonym is its canonical alias: when it is exactly a role's name (the CTO role for "chief technology officer") it is the answer, not a hint. */
const SYNONYM_IS_NAME = 20

/**
 * What a list of synonym phrases adds for one role, and whether one of them is a strong hit. A one-word synonym counts like a typed
 * word at a third of its weight. A phrase ("principal engineer") counts only when every word is in the name (6) or in the text (1.5):
 * its words alone, "engineer" and "principal", would match half the catalog.
 */
function synonymScore(e: Entry, phrases: string[]): { score: number; strong: boolean } {
  let extra = 0
  let strong = false
  for (const [i, phrase] of phrases.entries()) {
    const ws = stems(phrase)
    if (!ws.length) continue
    if (i === 0 && words(phrase).join(' ') === e.nameNorm) {
      extra += SYNONYM_IS_NAME
      strong = true
    } else if (ws.length === 1) {
      const s = scoreWord(e, ws[0]!) * SYNONYM_WEIGHT
      extra += s
      strong ||= s >= 3
    } else if (ws.every((w) => e.nameStems.has(w))) {
      extra += 6
      strong = true
    } else if (ws.every((w) => e.nameStems.has(w) || e.vibeStems.has(w) || e.descStems.has(w))) extra += 1.5
  }
  return { score: Math.min(SYNONYM_CAP + (strong ? SYNONYM_IS_NAME : 0), extra), strong }
}

/**
 * Roles for what was typed, best first. Every typed word must find something in the role (or one of its synonyms does), so more
 * words narrow the list. A synonym for several typed words at once ("chief technology officer" for the CTO role) satisfies all of
 * them. If nothing satisfies every word, roles that satisfy some are returned at half score.
 */
export function searchRoles(roles: readonly Searchable[], query: string, limit = 400): RoleHit[] {
  const typed = words(query)
  if (!typed.length) return []
  const meaningful = typed.filter((w) => !STOP.has(w))
  const terms = (meaningful.length ? meaningful : typed).map((w) => ({ raw: w, stem: stem(w) }))
  const synonyms = expand(terms.map((t) => t.raw))
  const qNorm = typed.join(' ')
  const { entries } = indexOf(roles)

  const scored = entries.map((e) => {
    let total = 0
    const hit = new Set<string>()
    for (const term of terms) {
      const direct = scoreWord(e, term.stem)
      total += direct
      if (direct > 0) hit.add(term.raw)
      const syn = synonyms.get(term.raw)
      const s = syn ? synonymScore(e, syn) : null
      if (s && s.score > 0) {
        total += s.score
        hit.add(term.raw)
      }
    }
    // A phrase synonym counts for its whole phrase, and a strong hit on it covers every word of the phrase.
    for (const [key, syn] of synonyms) {
      if (!key.includes(' ')) continue
      const s = synonymScore(e, syn)
      total += s.score
      if (s.strong) for (const w of key.split(' ')) hit.add(w)
    }
    if (e.nameNorm === qNorm) total += 40
    else if (qNorm.length >= 3 && e.nameNorm.startsWith(qNorm)) total += 14
    else if (qNorm.length >= 3 && e.nameNorm.includes(qNorm)) total += 8
    return { e, total, satisfied: terms.filter((t) => hit.has(t.raw)).length, matched: terms.filter((t) => hit.has(t.raw)).map((t) => t.raw) }
  })

  const all = scored.filter((s) => s.satisfied === terms.length && s.total > 0)
  const pool = all.length ? all : scored.filter((s) => s.satisfied > 0 && s.total > 0).map((s) => ({ ...s, total: s.total / 2 }))
  return pool
    .sort((a, b) => b.total - a.total || a.e.role.name.localeCompare(b.e.role.name))
    .slice(0, limit)
    .map((s) => ({ id: s.e.role.id, score: Math.round(s.total * 100) / 100, matched: s.matched }))
}

/** A synonym counts for half a typed word; a second typed word pointing at the same synonym adds to it, up to a whole word. */
const SUGGEST_SYNONYM_WEIGHT = 0.5
const SUGGEST_SYNONYM_ADD = 0.3
const K = 1.2

/**
 * The roles that fit a task written in plain words, best first, with the words that matched ("database, queries"). TF-IDF over
 * each role's name, one-liner, division and description: a rare word the role uses (postgresql) counts for more than a common one
 * (expert). A typed word also matches a longer word that begins with it (postgres, postgresql), and a few synonyms ("slow" brings
 * in performance and optimization) count at half weight. A role that speaks to more of the words you typed beats one that speaks
 * louder to fewer.
 */
export function suggestRoles(roles: readonly Searchable[], text: string, n = 3): RoleHit[] {
  const typed = [...new Set(words(text).filter((w) => !STOP.has(w) && w.length > 1))]
  if (!typed.length || n < 1) return []
  const { entries, df } = indexOf(roles)
  const total = Math.max(1, entries.length)
  const idf = (t: string): number => Math.log(1 + total / (1 + (df.get(t) ?? 0)))

  interface Q {
    stem: string
    label: string
    weight: number
  }
  const queries = new Map<string, Q>()
  /** Which query stems stand for each typed word: itself and its synonyms. */
  const groups = new Map<string, Set<string>>()
  for (const w of typed) {
    queries.set(stem(w), { stem: stem(w), label: w, weight: 1 })
    groups.set(w, new Set([stem(w)]))
  }
  for (const [key, syn] of expand(typed)) {
    for (const phrase of syn) {
      for (const w of words(phrase)) {
        if (STOP.has(w)) continue
        const s = stem(w)
        const known = queries.get(s)
        if (!known) queries.set(s, { stem: s, label: w, weight: SUGGEST_SYNONYM_WEIGHT })
        else if (known.weight < 1) known.weight = Math.min(1, known.weight + SUGGEST_SYNONYM_ADD)
        for (const k of key.split(' ')) groups.get(k)?.add(s)
      }
    }
  }

  const scored = entries.map((e) => {
    let sum = 0
    const hit = new Set<string>()
    const parts: { label: string; value: number; weight: number }[] = []
    for (const q of queries.values()) {
      let tf = e.tf.get(q.stem) ?? 0
      let factor = 1
      if (!tf && q.stem.length >= 4) {
        for (const [term, v] of e.tf) {
          if (term.startsWith(q.stem)) {
            tf = Math.max(tf, v)
            factor = 0.6
          }
        }
      }
      if (!tf) continue
      hit.add(q.stem)
      const value = q.weight * factor * idf(q.stem) * ((tf * (1 + K)) / (tf + K))
      sum += value
      parts.push({ label: q.label, value, weight: q.weight })
    }
    // A word you typed that the role uses itself counts fully; one it only has a synonym for counts half.
    const covered = typed.reduce((n, w) => n + (hit.has(stem(w)) ? 1 : [...groups.get(w)!].some((s) => hit.has(s)) ? 0.5 : 0), 0) / typed.length
    return { e, sum: sum * (0.35 + 0.65 * covered * covered), parts }
  })

  const best = Math.max(0, ...scored.map((s) => s.sum))
  return scored
    .filter((s) => s.sum > 0 && s.sum >= best * 0.15)
    .sort((a, b) => b.sum - a.sum || a.e.role.name.localeCompare(b.e.role.name))
    .slice(0, n)
    .map((s) => ({
      id: s.e.role.id,
      score: Math.round(s.sum * 100) / 100,
      // The words you typed come before the synonyms that helped.
      matched: s.parts
        .sort((a, b) => b.weight - a.weight || b.value - a.value)
        .slice(0, 4)
        .map((p) => p.label)
    }))
}
