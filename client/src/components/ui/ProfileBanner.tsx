import { useState, type CSSProperties, type ReactNode } from 'react'
import { mediaUrl } from '../../api/client'
import { stillUrl } from '../../lib/nameStyle'
import AnimatedImg from './AnimatedImg'

/**
 * Bannière affichée EN ENTIER, partout (profil, fiche, aperçus, serveur, annuaire) :
 * - le cadre prend les proportions de l'image (lues au chargement), sa hauteur est
 *   seulement bornée par `minHeight` / `maxHeight` — jamais de hauteur fixe qui rogne ;
 * - l'image est en `object-fit: contain` : haute, très large, petite ou énorme, GIF compris,
 *   elle n'est jamais coupée ;
 * - quand les bornes laissent des bandes, une copie floutée et agrandie de la même image
 *   (version fixe si elle est animée) les remplit, sans bandes vides.
 * Les animations suivent le réglage « animer les avatars et bannières » et la réduction
 * des animations (AnimatedImg). Sans image : `emptyClassName` / `emptyStyle` (dégradé…).
 */
export default function ProfileBanner({
  src, defaultRatio = 3, minHeight = 64, maxHeight = 240, focus, className = '', emptyClassName = 'h-28', emptyStyle,
  imgClassName = '', alt = '', children,
}: {
  src?: string | null
  /** Proportions avant chargement (largeur / hauteur). */
  defaultRatio?: number
  /** Hauteur minimale du cadre (px ou longueur CSS écrite dans le code). */
  minHeight?: number | string
  /** Hauteur maximale du cadre (px ou longueur CSS écrite dans le code). */
  maxHeight?: number | string
  /** Ancrage de l'image entière quand il reste des bandes (« 50% 50% » par défaut). */
  focus?: string
  className?: string
  emptyClassName?: string
  emptyStyle?: CSSProperties
  imgClassName?: string
  alt?: string
  /** Superposé à la bannière (voile, boutons). */
  children?: ReactNode
}) {
  // Proportions mémorisées avec leur image : un changement de bannière repart du défaut.
  const [loaded, setLoaded] = useState<{ src: string; ratio: number } | null>(null)
  if (!src || !mediaUrl(src)) {
    return <div className={`relative ${emptyClassName} ${className}`} style={emptyStyle}>{children}</div>
  }
  const ratio = loaded?.src === src ? loaded.ratio : defaultRatio
  const still = stillUrl(src)
  return (
    <div
      className={`relative w-full overflow-hidden bg-black/40 ${className}`}
      style={{ aspectRatio: String(ratio), minHeight, maxHeight }}
    >
      <img
        src={mediaUrl(still ?? src)}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        className="absolute -inset-4 w-[calc(100%+2rem)] h-[calc(100%+2rem)] max-w-none object-cover blur-xl brightness-75 scale-105 pointer-events-none select-none"
      />
      <AnimatedImg
        src={src}
        alt={alt}
        aria-hidden={alt ? undefined : true}
        loading="lazy"
        decoding="async"
        draggable={false}
        className={`absolute inset-0 w-full h-full object-contain ${imgClassName}`}
        style={focus ? { objectPosition: focus } : undefined}
        onLoad={e => {
          const img = e.currentTarget
          if (img.naturalWidth && img.naturalHeight) {
            const r = img.naturalWidth / img.naturalHeight
            setLoaded(prev => (prev?.src === src && Math.abs(prev.ratio - r) < 0.001 ? prev : { src, ratio: r }))
          }
        }}
      />
      {children}
    </div>
  )
}

export { ProfileBanner as Banner }
