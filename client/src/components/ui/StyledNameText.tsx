import type { CSSProperties } from 'react'
import { cleanStyle, letterDelay, nameClass, nameCss, perLetter, waveColors, type NameStyle } from '../../lib/nameStyle'

/**
 * Pseudo rendu avec un style donné, sans cache ni contexte (aperçus des éditeurs).
 * Même rendu que UserName : le style est nettoyé (liste blanche, couleurs et nombres bornés)
 * avant nameCss, qui n'écrit que des « #rrggbb » et des valeurs constantes. Le texte reste du
 * texte React (et `data-text` pour l'effet glitch), jamais une valeur de style.
 */
export default function StyledNameText({ text, style, className = '' }: { text: string; style: NameStyle | null | unknown; className?: string }) {
  const s = cleanStyle(style)
  const css = nameCss(s) as CSSProperties
  return (
    <span className={className + nameClass(s)} style={css} data-text={s?.effect === 'glitch' ? text : undefined}>
      {perLetter(s)
        ? waveColors(text, s).map((c, i) => (
            <span key={i} className="fc-ch" style={{ color: c.color, animationDelay: letterDelay(i) }}>{c.ch}</span>
          ))
        : text}
    </span>
  )
}
