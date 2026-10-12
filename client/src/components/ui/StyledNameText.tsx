import type { CSSProperties } from 'react'
import { cleanStyle, nameClass, nameCss, waveColors, type NameStyle } from '../../lib/nameStyle'

/**
 * Pseudo rendu avec un style donné, sans cache ni contexte (aperçus des éditeurs).
 * Même rendu que UserName : le style est nettoyé (liste blanche, couleurs bornées) avant
 * nameCss, qui n'écrit que des « #rrggbb » et des valeurs constantes. Le texte reste du
 * texte React (et `data-text` pour l'effet glitch), jamais une valeur de style.
 */
export default function StyledNameText({ text, style, className = '' }: { text: string; style: NameStyle | null | unknown; className?: string }) {
  const s = cleanStyle(style)
  const css = nameCss(s) as CSSProperties
  const wave = s?.effect === 'wave'
  return (
    <span className={className + nameClass(s)} style={css} data-text={s?.effect === 'glitch' ? text : undefined}>
      {wave
        ? waveColors(text, s).map((c, i) => (
            <span key={i} style={{ color: c.color, animationDelay: `${(i * 0.08).toFixed(2)}s` }}>{c.ch}</span>
          ))
        : text}
    </span>
  )
}
