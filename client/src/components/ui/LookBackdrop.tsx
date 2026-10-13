import type { CSSProperties } from 'react'
import { mediaUrl } from '../../api/client'
import { stillUrl } from '../../lib/nameStyle'
import { backgroundCss, type LookBackground } from '../../lib/serverAppearance'

/**
 * Calque de fond de l'apparence d'un serveur (liste des salons, zone des messages), posé en
 * `absolute inset-0` sous le contenu (le contenu qui suit doit être `relative`). Couleur,
 * dégradé et motif : styles écrits par lib/serverAppearance.ts depuis des entiers. Image :
 * un <img> (mediaUrl), jamais une URL dans du CSS ; flou et opacité sont des nombres bornés.
 * Une image animée reste figée en fond (version fixe), pour le confort et la réduction des
 * animations.
 */
export default function LookBackdrop({ bg }: { bg: LookBackground | undefined }) {
  if (!bg) return null
  if (bg.kind === 'image') {
    const src = mediaUrl(bg.image ? (stillUrl(bg.image) ?? bg.image) : null)
    if (!src) return null
    return (
      <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover select-none"
          style={{ opacity: bg.opacity / 100, filter: bg.blur ? `blur(${bg.blur}px)` : undefined, transform: bg.blur ? 'scale(1.06)' : undefined }}
        />
      </div>
    )
  }
  return <div aria-hidden className="absolute inset-0 pointer-events-none" style={backgroundCss(bg) as CSSProperties} />
}
