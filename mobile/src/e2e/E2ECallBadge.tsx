// Cadenas « appel chiffré de bout en bout » des appels et salons vocaux (§5),
// avec l'alerte des participants dont l'appli ne chiffre pas encore.
import { Ionicons } from '@expo/vector-icons'
import { View } from 'react-native'
import { T } from '@/components/ui'
import { useT } from '@/i18n'
import { colors, spacing } from '@/theme'

export function E2ECallBadge({ encrypted, outdatedNames }: { encrypted: boolean; outdatedNames: string[] }) {
  const t = useT()
  if (!encrypted) return null
  return (
    <View style={{ alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm }}>
      <View accessible accessibilityLabel={t('e2e.call.encrypted')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Ionicons name="lock-closed" size={12} color={colors.success} />
        <T variant="small" style={{ color: colors.success }}>{t('e2e.call.encrypted')}</T>
      </View>
      {outdatedNames.length > 0 ? (
        <View accessibilityRole="alert" style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="warning" size={12} color={colors.warning} />
          <T variant="small" style={{ color: colors.warning, flexShrink: 1 }}>
            {t('e2e.call.outdated', { names: outdatedNames.join(', ') })}
          </T>
        </View>
      ) : null}
    </View>
  )
}
