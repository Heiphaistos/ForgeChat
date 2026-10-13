import type { ReactNode } from 'react'
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { ProfileThemeCard } from '@/components/ProfileDecor'
import { hexColor } from '@/features/account/profileDecor'
import { colors } from '@/theme'
import { PATTERN_GLYPH, cardOnColor, gradientAxis, gradientStops, type ProfileCard } from './profileCard'

const ROWS = Array.from({ length: 40 }, (_, i) => i)

/**
 * Fond de la carte de profil (profile_card.card) avec les couleurs du thème du profil :
 * uni (bandeau + accent, comme avant), dégradé approché par 12 bandes orientées au quart de tour
 * le plus proche de l'angle, verre (voile translucide), contour, néon (bordure + lueur iOS).
 * Le motif est approché par des lignes de glyphes répétés, très discrètes.
 */
export function ProfileCardFrame({
  card, primary, accent, style, children,
}: {
  card: ProfileCard
  primary?: number | null
  accent?: number | null
  style?: StyleProp<ViewStyle>
  children: ReactNode
}) {
  const a = primary ?? accent ?? null
  const b = accent ?? primary ?? null
  const main = a != null ? hexColor(a) : colors.primary
  const radius = { borderRadius: card.radius }
  const onColor = cardOnColor(card.card, a != null)
  const glyph = card.pattern === 'none' ? null : PATTERN_GLYPH[card.pattern]
  const pattern = !glyph ? null : (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, radius, styles.clip]}>
      {ROWS.map((i) => (
        <Text key={i} accessible={false} numberOfLines={1} ellipsizeMode="clip" style={[styles.row, { color: onColor ? '#fff' : colors.text, letterSpacing: card.pattern === 'dots' ? 8 : 2 }]}>
          {glyph.repeat(60)}
        </Text>
      ))}
    </View>
  )
  if (card.card === 'solid') {
    return (
      <ProfileThemeCard primary={primary} accent={accent} style={[style, radius, styles.clip]}>
        {pattern}
        {children}
      </ProfileThemeCard>
    )
  }
  if (card.card === 'gradient') {
    const axis = gradientAxis(card.angle)
    const stops = a != null && b != null ? gradientStops(a, b, 12) : [colors.bgElevated, colors.bgElevated]
    return (
      <View style={[style, radius, styles.clip]}>
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { flexDirection: axis.row ? (axis.reverse ? 'row-reverse' : 'row') : axis.reverse ? 'column-reverse' : 'column' }]}>
          {stops.map((c, i) => <View key={i} style={{ flex: 1, backgroundColor: c }} />)}
        </View>
        {a != null ? <View pointerEvents="none" style={styles.veil} /> : null}
        {pattern}
        {children}
      </View>
    )
  }
  const look: ViewStyle =
    card.card === 'glass'
      ? { backgroundColor: a != null ? `${main}33` : colors.bgElevated, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' }
      : card.card === 'outline'
        ? { borderWidth: 2, borderColor: main }
        : { backgroundColor: colors.bgElevated, borderWidth: 2, borderColor: b != null ? hexColor(b) : main, shadowColor: b != null ? hexColor(b) : main, shadowOpacity: 0.8, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } }
  return (
    <View style={[style, radius, look]}>
      {pattern}
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  row: { fontSize: 12, lineHeight: 16, opacity: 0.1 },
  veil: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.3)' },
})
