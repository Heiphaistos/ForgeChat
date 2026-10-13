/*
 * ForgeChat — logo 3D animé (motion design), le même dessin que l'icône de l'app :
 * bulle de chat extrudée et biseautée, enclume embossée, étincelle de forge.
 * SVG procédural généré par scripts/gen-brand-icons.py (logoArt.ts, arbre d'éléments),
 * animé en CSS (Logo3D.css) : flottement et inclinaison 3D, reflet qui balaie la bulle,
 * étincelle qui pulse, braises projetées. Aucune dépendance (plus de three.js) : utilisable
 * jusque dans l'écran de chargement. prefers-reduced-motion : logo fixe.
 */
import { createElement, useId, useMemo, type ReactNode } from 'react'
import { LOGO_TREE, type LogoNode } from './logoArt'
import './Logo3D.css'

interface Props {
  size?: number
  className?: string
  /** false : logo fixe (même rendu, sans mouvement). */
  animated?: boolean
}

/** Arbre généré → éléments React ; identifiants suffixés par instance (`uid`). */
function render(node: LogoNode | string, uid: string, key: number): ReactNode {
  if (typeof node === 'string') return node
  const [tag, attrs, children] = node
  const props: Record<string, string | number> = { key }
  for (const [k, v] of Object.entries(attrs)) {
    props[k] = k === 'id' ? `${v}-${uid}` : v.replace(/url\(#([^)]+)\)/g, `url(#$1-${uid})`)
  }
  if (tag === 'svg') { props.width = '100%'; props.height = '100%' }
  return createElement(tag, props, ...children.map((c, i) => render(c, uid, i)))
}

export default function Logo3D({ size = 40, className, animated = true }: Props) {
  // Identifiants propres à chaque instance : plusieurs logos sur une page ne partagent pas
  // leurs dégradés et filtres (un logo masqué casserait les références des autres).
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const svg = useMemo(() => render(LOGO_TREE, uid, 0), [uid])

  return (
    <span
      aria-hidden
      className={`fc-logo3d${animated ? ' fc-logo3d--anim' : ''}${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
    >
      <span className="fc-logo3d__body">{svg}</span>
    </span>
  )
}
