import { useState, type ReactNode } from 'react'
import { agentArt, avatarFor, type Shape } from '@/lib/avatar'
import { cn } from './ui'

const SHAPE: Record<Shape, ReactNode> = {
  circle: <circle cx="12" cy="12" r="10" />,
  squircle: <rect x="2.5" y="2.5" width="19" height="19" rx="6" />,
  diamond: <rect x="5" y="5" width="14" height="14" rx="3.5" transform="rotate(45 12 12)" />,
  hexagon: <polygon points="12,2.5 20.5,7.25 20.5,16.75 12,21.5 3.5,16.75 3.5,7.25" strokeWidth="2" strokeLinejoin="round" />,
  capsule: <rect x="5.5" y="2" width="13" height="20" rx="6.5" />,
  shield: <path d="M12 2.5 20 5.5v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10v-6Z" strokeWidth="1.5" strokeLinejoin="round" />
}

/** The older generated avatar: shape and hue from the seed, a white visor for a face. Drawn only when there is no mascot. */
function Generated({ seed, size, className }: { seed: string; size: number; className?: string }) {
  const { shape, color } = avatarFor(seed)
  const narrow = shape === 'capsule' || shape === 'diamond'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden fill={color} stroke={color}>
      <g strokeWidth="0">{SHAPE[shape]}</g>
      <rect x={narrow ? 8.5 : 7.5} y="9.6" width={narrow ? 7 : 9} height="3.2" rx="1.6" fill="#fff" stroke="none" />
    </svg>
  )
}

/**
 * Agent avatar: the mascot picked by the seed (lib/avatar.ts), in a squircle whose radius is a share of the size so it holds
 * from 14 to 56 px. A faint inner ring keeps pale mascots apart from a pale surface. The name always sits beside it, so it
 * is hidden from screen readers. No mascot, or one that fails to load: the generated shape.
 */
export function Avatar({ seed, size = 24, className }: { seed: string; size?: number; className?: string }) {
  const art = agentArt(seed)
  const [failed, setFailed] = useState<string | null>(null)
  if (!art || art === failed) return <Generated seed={seed} size={size} className={className} />
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
      className={cn('select-none rounded-[28%] object-cover outline outline-1 -outline-offset-1 outline-ink/8', className)}
    />
  )
}

/** The AgentDeck mark: two stacked cards on an accent tile (same geometry as resources/icon.png). */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <rect width="16" height="16" rx="4.5" fill="var(--accent)" />
      <rect x="5.5" y="3" width="7.5" height="6.5" rx="1.6" fill="#fff" fillOpacity="0.6" />
      <rect x="3" y="6.5" width="7.5" height="6.5" rx="1.6" fill="#fff" />
    </svg>
  )
}
