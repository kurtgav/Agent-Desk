/** Generated agent avatars (D-015): a fixed shape and hue per seed, never a picture. */

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
