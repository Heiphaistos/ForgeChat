import { StyleSheet, Text, type TextStyle } from 'react-native'
import { cleanTagStyle, ensureContrast, mix, toHex, type TagIcon } from '@/lib/nameStyle'
import { colors as theme, font, radius } from '@/theme'
import { nameFontStyle } from './nameFonts'

/** Icônes des marques (identifiants de la liste blanche du serveur) en glyphes texte. */
export const TAG_ICON_GLYPHS: Record<Exclude<TagIcon, ''>, string> = {
  star: '★', crown: '♛', shield: '⛉', flame: '♨', bolt: '⚡', heart: '♥', skull: '☠', leaf: '❦',
  diamond: '◆', moon: '☾', sword: '⚔', gem: '◈', paw: '❀', music: '♪', gamepad: '✚',
}

/** Texte noir ou blanc selon la couleur de fond. */
function onColor(c: number): string {
  const [r, g, b] = [(c >> 16) & 255, (c >> 8) & 255, c & 255]
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111214' : '#ffffff'
}

/**
 * Marque de clan à côté d'un pseudo (mobile) : tag de serveur (couleur de la colonne `color`)
 * ou étiquette perso (couleur dans le style). Même habillage que le web
 * (client/src/components/ui/ClanTag.tsx) en version statique : le dégradé devient la
 * première couleur bordée de la seconde. Seules des couleurs validées entrent dans le style.
 */
export function ClanTag({ name, color, style, fallback = 'outline' }: {
  name: string
  color?: number | null
  style?: unknown
  fallback?: 'outline' | 'soft'
}) {
  const s = cleanTagStyle(style)
  const raw = Number.isInteger(color) && (color as number) >= 0 && (color as number) <= 0xffffff ? (color as number) : s?.color
  const badge = s?.badge || (raw == null ? 'neutral' : fallback)
  const css: TextStyle = { ...nameFontStyle(s?.font) }
  if (raw == null || badge === 'neutral') {
    css.backgroundColor = theme.bgElevated
    css.color = theme.textSecondary
  } else {
    const c = toHex(raw)
    const text = toHex(ensureContrast(raw))
    const c2 = s?.color2 != null ? toHex(s.color2) : null
    switch (badge) {
      case 'solid':
      case 'pill':
        css.backgroundColor = c
        css.color = onColor(raw)
        if (badge === 'pill') css.borderRadius = radius.full
        break
      case 'soft':
        css.backgroundColor = `${c}33`
        css.color = text
        break
      case 'gradient':
        css.backgroundColor = c
        css.borderColor = c2 ?? toHex(mix(raw, 0xffffff, 0.4))
        css.borderWidth = 1
        css.color = '#ffffff'
        css.textShadowColor = 'rgba(0,0,0,0.6)'
        css.textShadowRadius = 1
        break
      case 'glass':
        css.backgroundColor = 'rgba(255,255,255,0.08)'
        css.borderColor = `${c}66`
        css.borderWidth = 1
        css.color = text
        break
      case 'neon':
        css.borderColor = c
        css.borderWidth = 1
        css.color = text
        css.textShadowColor = c
        css.textShadowRadius = 4
        break
      case 'plain':
        css.color = c2 ? toHex(ensureContrast(s!.color2!)) : text
        css.paddingHorizontal = 0
        break
      default:
        css.borderColor = c
        css.borderWidth = 1
        css.color = text
    }
  }
  const glyph = s?.icon ? TAG_ICON_GLYPHS[s.icon as Exclude<TagIcon, ''>] : null
  return (
    <Text style={[styles.tag, css]} numberOfLines={1}>
      {glyph ? `${glyph} ` : ''}
      {name}
    </Text>
  )
}

const styles = StyleSheet.create({
  tag: {
    fontSize: font.xs,
    fontWeight: '700',
    paddingHorizontal: 5,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
})
