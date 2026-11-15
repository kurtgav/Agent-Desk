/**
 * "Good for" on a role's detail panel: the things its description says it does, as short phrases. Taken from the description by
 * rules (the list after "specializing in", or the sentence that is a list of duties), never written by a model.
 */

/** Lead-ins that introduce a list of things. Verbs like "builds" are not here: they also sit inside the list ("build versus buy"). */
const LEAD = /\b(?:specializ(?:es|ing) in|specialises in|specialist in|focus(?:es|ed|ing) on|expert in|experts? at|covering|covers|including|such as)\s+/i
/** A duty sentence starts with one of these ("Develops editorial calendars, creates compelling copy, ..."): the verb is dropped. */
const VERBS = new Set(
  'develops creates manages optimizes optimises builds designs writes runs drives turns makes finds handles helps owns reviews audits analyzes analyses plans ships tests translates transforms converts delivers provides produces ensures maintains identifies implements integrates leads guides coordinates structures weighs sorts spots keeps protects reads decides sets pressure-tests'.split(' ')
)
const MAX_ITEMS = 5
const MAX_PHRASE = 56
const MIN_PHRASE = 4

const tidy = (s: string): string => {
  const t = s.replace(/^(?:and|or|the|a|an)\s+/i, '').replace(/[.;:]+$/, '').trim()
  const words = t.split(' ')
  const bare = words.length > 1 && VERBS.has(words[0]!.toLowerCase()) ? words.slice(1).join(' ') : t
  return bare ? `${bare[0]!.toUpperCase()}${bare.slice(1)}` : ''
}

const split = (list: string): string[] => list.split(/,|;|\s+—\s+|\s+–\s+|\s+-\s+|\s+and\s+(?=[a-z]+(?:[\s,.;]|$))/i).map(tidy)

/** Up to five short phrases. Empty when the description names nothing specific. */
export function goodFor(description: string): string[] {
  const text = description.replace(/\s+/g, ' ').trim()
  if (!text) return []
  const sentences = text.split(/(?<=[.!?])\s+/)
  // The sentence that lists the most things: after a lead-in if it has one, otherwise the sentence itself.
  const candidates = sentences.map((s) => {
    const lead = LEAD.exec(s)
    return lead ? s.slice(lead.index + lead[0].length) : s
  })
  const richest = candidates.reduce((best, s) => ((s.match(/,/g)?.length ?? 0) > (best.match(/,/g)?.length ?? 0) ? s : best), candidates[0]!)
  const parts = split(richest.replace(/[.!?]+$/, '')).filter((p) => p.length >= MIN_PHRASE && p.length <= MAX_PHRASE && p.split(' ').length <= 8)
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of parts) {
    const k = p.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(p)
    if (out.length === MAX_ITEMS) break
  }
  return out
}
