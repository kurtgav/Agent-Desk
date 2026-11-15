import { useUi } from '@/store'
import { initialOf } from '@/lib/profile'
import { cn } from './ui'

/**
 * The user's photo as a round image, or their initial in the same circle the sidebar always had. The name sits next to it
 * wherever it is shown, so the initial is hidden from screen readers; the photo carries its own alt text.
 */
export function UserAvatar({ size = 32, className }: { size?: number; className?: string }) {
  const { name, avatar } = useUi((s) => s.profile)
  if (avatar) {
    return (
      <img
        src={avatar}
        alt={`Photo of ${name}`}
        width={size}
        height={size}
        draggable={false}
        className={cn('flex-none rounded-full object-cover outline outline-1 -outline-offset-1 outline-ink/10', className)}
      />
    )
  }
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      className={cn('grid flex-none place-items-center rounded-full bg-[var(--working-bg)] font-semibold text-[var(--working-ink)]', className)}
    >
      {initialOf(name)}
    </span>
  )
}
