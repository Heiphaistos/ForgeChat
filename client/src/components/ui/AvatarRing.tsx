import type { CSSProperties, ReactNode } from 'react'
import { hex } from '../../lib/nameStyle'

/**
 * Anneau d'avatar du profil de serveur (server_members.server_avatar_ring, validé par
 * models/profile_style::parse_avatar_ring) : 1 à 3 couleurs, épaisseur 1-8 px, style en
 * liste blanche. Seuls des « #rrggbb » issus d'entiers et des nombres arrivent dans le style.
 */
export const RING_STYLES = ['solid', 'dashed', 'dotted', 'double', 'glow', 'spin', 'pulse'] as const
export type RingStyle = (typeof RING_STYLES)[number]
export const RING_WIDTH_MAX = 8

export interface AvatarRingData {
  colors: number[]
  width: number
  style: RingStyle
}

/** Anneau reçu nettoyé (garde contre un cache ancien) ; null = pas d'anneau. */
export function cleanRing(r: unknown): AvatarRingData | null {
  if (!r || typeof r !== 'object') return null
  const o = r as Record<string, unknown>
  const colors = Array.isArray(o.colors)
    ? o.colors.filter((c): c is number => Number.isInteger(c) && c >= 0 && c <= 0xffffff).slice(0, 3)
    : []
  if (!colors.length) return null
  const width = Number.isInteger(o.width) ? Math.min(RING_WIDTH_MAX, Math.max(1, o.width as number)) : 3
  const style = (RING_STYLES as readonly unknown[]).includes(o.style) ? (o.style as RingStyle) : 'solid'
  return { colors, width, style }
}

/** Anneau autour d'un avatar de `size` px ; rien de plus que l'avatar sans anneau. */
export default function AvatarRing({ ring, size, children }: { ring?: unknown; size: number; children: ReactNode }) {
  const r = cleanRing(ring)
  if (!r) return <>{children}</>
  // Épaisseur réduite sur les petits avatars (liste des membres, messages).
  const w = Math.max(1, Math.round(r.width * Math.min(1, size / 72)))
  const cs = r.colors.map(hex)
  const gap = Math.max(1, Math.round(w / 2))
  const style: CSSProperties = { inset: -(w + gap) }
  const border = r.style === 'dashed' || r.style === 'dotted' || r.style === 'double'
  if (border) {
    style.border = `${r.style === 'double' ? Math.max(3, w) : w}px ${r.style} ${cs[0]}`
    if (cs.length > 1) style.borderColor = [0, 1, 2, 3].map(i => cs[i % cs.length]).join(' ')
  } else {
    style.padding = w
    style.background = cs.length > 1 ? `conic-gradient(${[...cs, cs[0]].join(', ')})` : cs[0]
    if (r.style === 'glow' || r.style === 'pulse') style.filter = `drop-shadow(0 0 ${Math.max(2, w)}px ${cs[0]})`
  }
  const anim = r.style === 'spin' ? ' fc-ring-spin' : r.style === 'pulse' ? ' fc-ring-pulse' : ''
  return (
    <span className="relative inline-flex flex-shrink-0">
      {children}
      <span aria-hidden className={`fc-ring${border ? '' : ' fc-deco-ring'}${anim}`} style={style} />
    </span>
  )
}
