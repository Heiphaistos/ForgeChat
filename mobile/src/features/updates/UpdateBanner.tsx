import { Ionicons } from '@expo/vector-icons'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { APP_VERSION } from '@/config/env'
import { useT } from '@/i18n'
import { useSettings } from '@/stores/settings'
import { colors, font, radius, spacing } from '@/theme'
import { startUpdate } from './installer'
import { useUpdate } from './updateStore'

function Action({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.action, primary && { backgroundColor: colors.primary }, pressed && { opacity: 0.75 }]}
    >
      <Text style={[styles.actionText, primary && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  )
}

/** Bannière persistante « Mise à jour X disponible » (au-dessus de la barre d'onglets), jusqu'à l'installation. */
export function UpdateBanner() {
  const t = useT()
  const insets = useSafeAreaInsets()
  const { update, phase, dismissed } = useUpdate()
  if (!update || dismissed) return null
  const version = update.version
  const later = () => useUpdate.setState({ dismissed: true })
  const install = () => void startUpdate()

  let title: string
  let body: string | null = null
  let actions: ReactNode
  switch (phase) {
    case 'ready':
      title = t('store.update.ready', { version })
      body = t('store.update.readyBody')
      actions = (
        <>
          <Action label={t('store.update.later')} onPress={later} />
          <Action label={t('store.update.retry')} onPress={install} primary />
        </>
      )
      break
    case 'error':
      title = t('store.update.failed')
      body = t('store.update.failedBody')
      actions = (
        <>
          <Action label={t('store.update.later')} onPress={later} />
          <Action label={t('store.update.retry')} onPress={install} primary />
        </>
      )
      break
    default:
      title = t('store.update.available', { version })
      body = t('store.update.availableBody', { current: APP_VERSION })
      actions = (
        <>
          <Action
            label={t('store.update.skip')}
            onPress={() => {
              useSettings.getState().set({ updateSkippedVersion: version })
              useUpdate.setState({ update: null })
            }}
          />
          <Action label={t('store.update.later')} onPress={later} />
          <Action label={t('store.update.install')} onPress={install} primary />
        </>
      )
  }

  return (
    <View style={[styles.card, { bottom: insets.bottom + 64 }]} accessibilityLiveRegion="polite">
      <View style={styles.head}>
        <Ionicons name="cloud-download-outline" size={20} color={colors.primary} />
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
      </View>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      <View style={styles.actions}>{actions}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    zIndex: 60,
    elevation: 8,
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, color: colors.text, fontSize: font.md, fontWeight: '700' },
  body: { color: colors.textMuted, fontSize: font.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: spacing.sm },
  action: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.sm },
  actionText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '700' },
})
