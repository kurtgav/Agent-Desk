/**
 * Agent avatars. The one place that defines the mapping.
 *
 * Mascot: every file in assets/agents/ is one mascot from IP as Logo (credited in README and THIRD_PARTY_NOTICES.md).
 * `agentArt(seed)` takes the FNV-1a hash of SALT plus the lower-cased seed (an agent's name; a subagent's seed is its
 * agentType) modulo the number of mascots, over the list sorted by file name. The same name therefore always gets the same
 * mascot, whatever the case and whatever order the bundler lists the files in. Adding or removing a file reshuffles who gets
 * what, so then try another SALT until the "demo sessions and agent types" test passes again.
 *
 * Fallback: `avatarFor(seed)` is the older generated shape and hue (six shapes by twelve hues). The Avatar component draws
 * it when there is no mascot (an empty folder) or the image fails to load.
 */

export const SHAPES = ['circle', 'squircle', 'diamond', 'hexagon', 'capsule', 'shield'] as const
export type Shape = (typeof SHAPES)[number]

/** Twelve hues, all dark enough for the white visor (≥ 3:1). No violet or indigo. */
export const HUES = [
  '#0A6FD6', '#0E7C86', '#13795B', '#3F7D20', '#8A6A00', '#B45309',
  '#C2410C', '#C62828', '#BE185D', '#9D174D', '#0369A1', '#4D6B0F'
] as const

/** FNV-1a 32-bit. */
export function hash(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function avatarFor(seed: string): { shape: Shape; color: string } {
  const h = hash(seed.toLowerCase())
  return { shape: SHAPES[h % SHAPES.length]!, color: HUES[Math.floor(h / SHAPES.length) % HUES.length]! }
}

/** Picked by search: with 38 mascots it gives the demo's sessions and agent types, the built-in subagents and a few real names different mascots. */
const SALT = '92043:'

// no-inline: Vite would otherwise embed all of them in the script as base64 (about 100 kB gzipped); this keeps them separate files.
const files = import.meta.glob<string>('../assets/agents/*.webp', { eager: true, query: '?url&no-inline', import: 'default' })

/** Mascot image URLs, sorted by file name (plain code-unit order, so it never depends on glob order or locale). */
export const MASCOTS: readonly string[] = Object.keys(files)
  .sort()
  .map((file) => files[file]!)

/** The mascot for a seed, or null when the pool is empty. `pool` is only passed by tests. */
export function agentArt(seed: string, pool: readonly string[] = MASCOTS): string | null {
  return pool[hash(SALT + seed.toLowerCase()) % pool.length] ?? null
}
