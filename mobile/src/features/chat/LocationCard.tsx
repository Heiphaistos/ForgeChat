import { Ionicons } from '@expo/vector-icons'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { useT } from '@/i18n'
import { osmUrl, type Geo } from '@/lib/geo'
import { colors, font, radius, spacing } from '@/theme'

/** Position partagée (chiffrée de bout en bout, amélioration n° 34) : aucune carte chargée d'office. */
export function LocationCard({ g }: { g: Geo }) {
  const t = useT()
  return (
    <Pressable style={styles.card} onPress={() => void Linking.openURL(osmUrl(g))} accessibilityRole="link" accessibilityLabel={t('geo.open')}>
      <Ionicons name="location" size={22} color={colors.danger} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{t('geo.shared')}</Text>
        <Text style={styles.sub}>{g.lat.toFixed(5)}, {g.lon.toFixed(5)}{g.acc !== undefined ? ` · ±${g.acc} m` : ''}</Text>
        <Text style={[styles.sub, { color: colors.primary }]}>{t('geo.open')}</Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', marginTop: spacing.xs, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bgAlt, maxWidth: 320 },
  title: { color: colors.text, fontWeight: '700', fontSize: font.sm },
  sub: { color: colors.textMuted, fontSize: font.xs },
})
