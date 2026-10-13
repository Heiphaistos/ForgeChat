import type { CSSProperties } from 'react'
import { patternCss } from '../../lib/serverAppearance'
import { cardLook, cleanCard, type CardPattern } from '../../lib/profileCard'

/**
 * Carte de profil (users.profile_card) appliquée au popout, à la page de profil et à l'aperçu
 * des réglages. Calcul pur dans lib/profileCard.ts ; ici seulement le rendu.
 */
export function cardView(card: unknown, primary?: number | null, accent?: number | null) {
  const c = cleanCard(card)
  const look = cardLook(c, primary, accent)
  return { card: c, look, style: look.style as CSSProperties }
}

/** Motif discret par-dessus le fond de la carte (mêmes dessins que l'apparence des serveurs). */
export function CardPatternLayer({ pattern }: { pattern: CardPattern | null }) {
  if (!pattern || pattern === 'none') return null
  const css = patternCss(pattern === 'lines' ? 'stripes' : pattern, 0xffffff)
  return <span aria-hidden className="absolute inset-0 pointer-events-none" style={{ ...(css as CSSProperties), opacity: 0.07, borderRadius: 'inherit' }} />
}
