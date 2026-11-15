import { useState } from 'react'
import type { RoleSummary } from '@shared/roles'
import { roleArt } from '@/lib/roleArt'
import { cn } from '../ui'

type Face = Pick<RoleSummary, 'id' | 'name' | 'emoji' | 'color' | 'source'>

/** A role's mascot (lib/roleArt.ts), or null: a role you wrote yourself always shows the emoji you picked for it. */
export const roleFace = (role: Face): string | null => (role.source === 'custom' ? null : roleArt(role.id, role.name))

/**
 * A role's face: its mascot picture, or its emoji in a squircle tinted by its division's colour. The tint is mixed into the surface
 * behind it, so it stays a wash in both themes, and a hairline of the same hue keeps the edge on a pale ground. A mascot that fails
 * to load falls back to the emoji. Decorative: the name always sits beside it.
 */
export function RoleEmoji({ role, size = 40, className }: { role: Face; size?: number; className?: string }) {
  const art = roleFace(role)
  const [failed, setFailed] = useState<string | null>(null)
  if (art && art !== failed) {
    return (
      <img
        src={art}
        alt=""
        aria-hidden
        width={size}
        height={size}
        draggable={false}
        decoding="async"
        onError={() => setFailed(art)}
        className={cn('flex-none select-none rounded-[28%] object-cover outline outline-1 -outline-offset-1 outline-ink/8', className)}
      />
    )
  }
  return (
    <span
      aria-hidden
      className={cn('flex flex-none select-none items-center justify-center rounded-[28%] leading-none', className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.5),
        background: `color-mix(in oklab, ${role.color} 17%, var(--surface))`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${role.color} 26%, transparent)`
      }}
    >
      {role.emoji}
    </span>
  )
}
