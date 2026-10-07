import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useT } from '@/i18n'
import { colors, font, radius, spacing } from '@/theme'

/** Tags d'une publication ; avec `onToggle`, puces sélectionnables (création). */
export function TagChips({ tags, selected, onToggle }: { tags: string[]; selected?: string[]; onToggle?: (tag: string) => void }) {
  const t = useT()
  if (!tags.length) return null
  return (
    <View style={styles.tags}>
      {tags.map((tag) => {
        const on = !!selected?.includes(tag)
        return onToggle ? (
          <Pressable
            key={tag}
            onPress={() => onToggle(tag)}
            style={[styles.tag, on && styles.tagOn]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={t('social.tags.tag', { tag })}
            hitSlop={4}
          >
            <Text style={[styles.text, on && { color: colors.text }]}>{tag}</Text>
          </Pressable>
        ) : (
          <View key={tag} style={styles.tag}>
            <Text style={styles.text}>{tag}</Text>
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
