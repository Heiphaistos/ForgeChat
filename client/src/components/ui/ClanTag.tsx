import type { CSSProperties } from 'react'
import { Zap, Crown, Diamond, Flame, Gamepad2, Gem, Heart, Leaf, Moon, Music, PawPrint, Shield, Skull, Star, Sword, type LucideIcon } from 'lucide-react'
import { cleanTagStyle, fontCss, hex, readable, type TagIcon, type TagStyle } from '../../lib/nameStyle'

/** Icônes des marques (identifiants de la liste blanche du serveur). */
export const TAG_ICON_COMPONENTS: Record<Exclude<TagIcon, ''>, LucideIcon> = {
  star: Star, crown: Crown, shield: Shield, flame: Flame, bolt: Zap, heart: Heart, skull: Skull,
  leaf: Leaf, diamond: Diamond, moon: Moon, sword: Sword, gem: Gem, paw: PawPrint, music: Music, gamepad: Gamepad2,
}

/** Texte noir ou blanc selon la couleur de fond. */
function onColor(c: number): string {
  const [r, g, b] = [(c >> 16) & 255, (c >> 8) & 255, c & 255]
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111214' : '#ffffff'
}

/**
 * Marque de clan à côté d'un pseudo : tag de serveur (couleur de la colonne `color`)
 * ou étiquette perso (couleur dans le style). Le texte est rendu comme texte React
 * (jamais dans un attribut de style) ; le style ne reçoit que des couleurs validées.
 */
export default function ClanTag({ name, color, style, fallback = 'outline', title, className = '' }: {
  name: string
  /** Couleur 0xRRGGBB (tag de serveur) ; sinon `style.color`. */
  color?: number | null
  style?: TagStyle | null | unknown
  /** Fond par défaut quand le style n'en choisit pas. */
  fallback?: 'outline' | 'soft'
  title?: string
  className?: string
}) {
  const s = cleanTagStyle(style)
  const raw = Number.isInteger(color) && (color as number) >= 0 && (color as number) <= 0xffffff ? color as number : s?.color
  const badge = s?.badge || (raw == null ? 'neutral' : fallback)
  const css: CSSProperties = { ...fontCss(s?.font) }
  let cls = 'fc-clan'
  if (raw == null || badge === 'neutral') {
    cls += ' bg-fc-hover text-fc-muted'
  } else {
    const c = hex(raw)
    const text = hex(readable(raw))
    const c2 = s?.color2 != null ? hex(s.color2) : null
    switch (badge) {
      case 'solid':
      case 'pill':
        css.background = c
        css.color = onColor(raw)
        if (badge === 'pill') cls += ' fc-clan-pill'
        break
      case 'soft':
        css.background = `${c}33`
        css.color = text
        break
      case 'gradient':
        css.background = `linear-gradient(90deg, ${c}, ${c2 ?? hex(readable(raw, 0xffffff))})`
        css.color = '#ffffff'
        css.textShadow = '0 1px 1px rgba(0,0,0,.6)'
        break
      case 'glass':
        css.background = 'rgba(255,255,255,.08)'
        css.border = `1px solid ${c}66`
        css.color = text
        cls += ' fc-clan-glass'
        break
      case 'neon':
        css.border = `1px solid ${c}`
        css.color = text
        css.boxShadow = `0 0 6px ${c}, inset 0 0 4px ${c}`
        css.textShadow = `0 0 4px ${c}`
        break
      case 'plain':
        css.color = text
        css.padding = 0
        if (c2) {
          css.backgroundImage = `linear-gradient(90deg, ${text}, ${hex(readable(s!.color2!))})`
          css.WebkitBackgroundClip = 'text'
          css.backgroundClip = 'text'
          css.color = 'transparent'
        }
        break
      default: // outline
        css.border = `1px solid ${c}`
        css.color = text
    }
  }
  const Icon = s?.icon ? TAG_ICON_COMPONENTS[s.icon as Exclude<TagIcon, ''>] : null
  return (
    <span className={`${cls} ${className}`} style={css} title={title}>
      {Icon && <Icon size={10} aria-hidden strokeWidth={2.5} />}
      {name}
    </span>
  )
}
