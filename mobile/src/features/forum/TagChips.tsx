import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, font, radius, spacing } from '@/theme'

/** Tags d'une publication ; avec `onToggle`, puces sélectionnables (création). */
export function TagChips({ tags, selected, onToggle }: { tags: string[]; selected?: string[]; onToggle?: (tag: string) => void }) {
  if (!tags.length) return null
  return (
    <View style={styles.tags}>
      {tags.map((t) => {
        const on = !!selected?.includes(t)
        return onToggle ? (
          <Pressable
            key={t}
            onPress={() => onToggle(t)}
            style={[styles.tag, on && styles.tagOn]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`Tag ${t}`}
            hitSlop={4}
          >
            <Text style={[styles.text, on && { color: colors.text }]}>{t}</Text>
          </Pressable>
        ) : (
          <View key={t} style={styles.tag}>
            <Text style={styles.text}>{t}</Text>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tag: { backgroundColor: colors.bgElevated, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 3, borderWidth: 1, borderColor: 'transparent' },
  tagOn: { borderColor: colors.primary, backgroundColor: colors.primary + '40' },
  text: { color: colors.textSecondary, fontSize: font.xs },
})
