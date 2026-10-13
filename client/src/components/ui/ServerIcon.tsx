import type { CSSProperties, ReactNode } from 'react'
import { mediaUrl } from '../../api/client'
import { iconRingCss, iconShape, type ServerAppearance } from '../../lib/serverAppearance'

/**
 * Icône d'un serveur avec la forme (cercle, carré arrondi, carré, hexagone) et l'anneau ou la
 * lueur choisis dans son apparence. L'anneau est un filtre posé sur un conteneur, il suit
 * donc aussi le découpage de l'hexagone.
 */
export default function ServerIcon({ name, icon, look, size = 48, className = '', fallback }: {
  name: string
  icon?: string | null
  look: ServerAppearance | null
  size?: number
  className?: string
  /** Contenu sans image (initiales par défaut). */
  fallback?: ReactNode
}) {
  const shape = iconShape(look?.icon_shape)
  const ring = iconRingCss(look) as CSSProperties | undefined
  const initials = name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
  const src = mediaUrl(icon)
  return (
    <span className="inline-flex flex-shrink-0" style={ring}>
      <span
        className={`flex items-center justify-center overflow-hidden bg-fc-accent font-bold text-white ${shape.className} ${className}`}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.36), ...(shape.style as CSSProperties | undefined) }}
      >
        {src
          ? <img src={src} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
          : (fallback ?? <span aria-hidden>{initials || '?'}</span>)}
      </span>
    </span>
  )
}
