import { useState, type CSSProperties, type ReactNode } from 'react'
import { mediaUrl } from '../../api/client'
import { stillUrl } from '../../lib/nameStyle'
import AnimatedImg from './AnimatedImg'

/** Proportions acceptées sans bandes : de 3:2 (haute) à 4:1 (très large). */
const MIN_RATIO = 1.5
const MAX_RATIO = 4

/**
 * Bannière de profil affichée en entier (jamais rognée) : le cadre prend les
 * proportions de l'image (bornées entre 3:2 et 4:1) et l'image est en `contain`.
 * Hors de ces bornes, un fond flouté de la même image remplit les bandes.
 * Sans bannière : `empty` (dégradé du thème, etc.) dans un cadre de classe `emptyClassName`.
 */
export default function ProfileBanner({ src, defaultRatio = 3, className = '', emptyClassName = 'h-28', emptyStyle, children }: {
  src?: string | null
  /** Proportions avant chargement (largeur / hauteur). */
  defaultRatio?: number
  className?: string
  emptyClassName?: string
  emptyStyle?: CSSProperties
  /** Superposé à la bannière (dégradé, boutons). */
  children?: ReactNode
}) {
  const [ratio, setRatio] = useState<number | null>(null)
  if (!src) {
    return <div className={`relative ${emptyClassName} ${className}`} style={emptyStyle}>{children}</div>
  }
  const shown = Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio ?? defaultRatio))
  const fill = ratio != null && Math.abs(shown - ratio) > 0.02
  return (
    <div className={`fc-banner ${className}`} style={{ aspectRatio: String(shown) }}>
      {fill && <img src={mediaUrl(stillUrl(src) ?? src)} alt="" aria-hidden className="fc-banner-fill" loading="lazy" decoding="async" />}
      <AnimatedImg
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        className="fc-banner-img"
        onLoad={e => {
          const img = e.currentTarget
          if (img.naturalWidth && img.naturalHeight) setRatio(img.naturalWidth / img.naturalHeight)
        }}
      />
      {children}
    </div>
  )
}
