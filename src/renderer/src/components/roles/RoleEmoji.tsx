import { cn } from '../ui'

/**
 * A role's face: its emoji in a squircle tinted by its division's colour. The tint is mixed into the surface behind it, so it stays
 * a wash in both themes, and a hairline of the same hue keeps the edge on a pale ground. Decorative: the name always sits beside it.
 */
export function RoleEmoji({ emoji, color, size = 40, className }: { emoji: string; color: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('flex flex-none select-none items-center justify-center rounded-[28%] leading-none', className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.5),
        background: `color-mix(in oklab, ${color} 17%, var(--surface))`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} 26%, transparent)`
      }}
    >
      {emoji}
    </span>
  )
}
