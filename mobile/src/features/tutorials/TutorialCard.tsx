import { Ionicons } from '@expo/vector-icons'
import { useState, type ReactNode } from 'react'
import { Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { colors, font, radius, spacing } from '@/theme'
import { categoryIcon, hueOf, type CategoryRef } from './api'
import { safeHttp } from './html'

const SLICES = 10

/** Dégradé approché (aucune dépendance de dégradé dans l'app) : tranches de teintes voisines, comme le web. */
export function Tint({ seed, children, style }: { seed: string; children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const h = hueOf(seed)
  return (
    <View style={[styles.tint, style]}>
      <View style={[StyleSheet.absoluteFill, styles.slices]}>
        {Array.from({ length: SLICES }, (_, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: `hsl(${(h + (45 * i) / (SLICES - 1)) % 360}, 55%, ${36 - (14 * i) / (SLICES - 1)}%)` }} />
        ))}
      </View>
      {children}
    </View>
  )
}

export function TutorialCard({ category, title, description, group, thumbnail, onPress }: { category: CategoryRef; title: string; description: string; group: string | null; thumbnail?: string | null; onPress: () => void }) {
  // Miniature tirée du film ; bandeau dégradé + icône tant qu'elle manque ou ne charge pas.
  const [failed, setFailed] = useState(false)
  const uri = failed ? undefined : safeHttp(thumbnail ?? undefined, true)
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${category.name}${group ? `, ${group}` : ''}`}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
    >
      {uri ? (
        <View style={styles.thumbWrap}>
          <Image source={{ uri }} style={styles.thumb} resizeMode="cover" accessibilityIgnoresInvertColors onError={() => setFailed(true)} />
          {group ? <Text style={[styles.chip, styles.thumbChip]} numberOfLines={1}>{group}</Text> : null}
        </View>
      ) : (
        <Tint seed={category.slug} style={styles.banner}>
          <Ionicons name={categoryIcon(category.slug)} size={30} color="#ffffffd9" />
          <Text style={styles.chip} numberOfLines={1}>{group ? `${category.name} · ${group}` : category.name}</Text>
        </Tint>
      )}
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        {description ? <Text style={styles.desc} numberOfLines={3}>{description}</Text> : null}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  tint: { overflow: 'hidden' },
  slices: { flexDirection: 'row' },
  card: { backgroundColor: colors.bgAlt, borderRadius: radius.lg, overflow: 'hidden' },
  banner: { height: 84, justifyContent: 'space-between', padding: spacing.md },
  thumbWrap: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  thumb: { width: '100%', height: '100%' },
  thumbChip: { position: 'absolute', top: spacing.sm, right: spacing.sm },
  chip: { alignSelf: 'flex-start', color: '#fff', fontSize: font.xs, fontWeight: '700', backgroundColor: '#00000055', paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.full, overflow: 'hidden', maxWidth: '100%' },
  body: { padding: spacing.md, gap: spacing.xs },
  title: { color: colors.text, fontSize: font.md, fontWeight: '700' },
  desc: { color: colors.textMuted, fontSize: font.sm },
})
