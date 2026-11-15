import { slugify } from '@shared/roles'

/**
 * Role mascots. Every file in assets/roles/ is one IP as Logo picture (credited in README and THIRD_PARTY_NOTICES.md), named after
 * the role it was chosen for: the role's slug, which is its id (`slugify(name)`, shared/role-catalog.ts). A role with no file, such
 * as one you wrote yourself, keeps its emoji.
 */

// no-inline: keep them separate files rather than base64 in the script.
const files = import.meta.glob<string>('../assets/roles/*.webp', { eager: true, query: '?url&no-inline', import: 'default' })

const BY_SLUG: ReadonlyMap<string, string> = new Map(Object.entries(files).map(([file, url]) => [file.slice(file.lastIndexOf('/') + 1, -'.webp'.length), url]))

/** The mascot for a role, by id, then by the slug of its name (an id can carry a suffix when two roles share a name); null when none. */
export function roleArt(id: string, name: string): string | null {
  return BY_SLUG.get(id) ?? BY_SLUG.get(slugify(name)) ?? null
}
