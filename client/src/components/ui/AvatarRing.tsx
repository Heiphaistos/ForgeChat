import type { CSSProperties, ReactNode } from 'react'
import { cleanRing, ringLook } from '../../lib/avatarRing'

/**
 * Anneau d'avatar du profil de serveur (server_members.server_avatar_ring, validé par
 * models/profile_style::parse_avatar_ring). Nettoyage, bornes et calcul du style :
 * lib/avatarRing.ts. Seuls des « #rrggbb » issus d'entiers et des nombres arrivent dans le style.
 */
export { RING_STYLES, RING_WIDTH_MAX, RING_ANIMATED, RING_RANGES, cleanRing, type AvatarRingData, type RingStyle } from '../../lib/avatarRing'

/** Anneau autour d'un avatar de `size` px ; rien de plus que l'avatar sans anneau. */
export default function AvatarRing({ ring, size, children }: { ring?: unknown; size: number; children: ReactNode }) {
  const r = cleanRing(ring)
  if (!r) return <>{children}</>
  const look = ringLook(r, size)
  const { w, gap, cs } = look
  const style: CSSProperties = { inset: -(w + gap), ...(look.vars as CSSProperties) }
  if (look.border) {
    style.border = `${r.style === 'double' ? Math.max(3, w) : w}px ${look.borderStyle} ${cs[0]}`
    if (cs.length > 1) style.borderColor = [0, 1, 2, 3].map(i => cs[i % cs.length]).join(' ')
  } else {
    style.padding = w
    style.background = look.background
  }
  const cls = `fc-ring${look.border ? '' : ' fc-deco-ring'}${look.animated ? ` fc-ring-${r.style}` : ''}${look.filtered ? ' fc-ring-fx' : ''}`
  return (
    <span className="relative inline-flex flex-shrink-0">
      {children}
      <span aria-hidden className={cls} style={style} />
      {r.style === 'comet' && size >= 24 && (
        // Tête de la comète : même rotation que la traînée, hors du masque de l'anneau.
        <span aria-hidden className="fc-ring fc-ring-comet" style={{ inset: -(w + gap), ...(look.vars as CSSProperties) }}>
          <span className="fc-ring-head" style={{ width: w * 2, height: w * 2, top: w / 2, background: cs[0], boxShadow: `0 0 ${w * 2}px ${cs[0]}` }} />
        </span>
      )}
    </span>
  )
}
