import { Ionicons } from '@expo/vector-icons'
import type { ReactNode } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, font, outline, radius, spacing } from '@/theme'
import { useT } from '@/i18n'
import type { IconName } from './ui'

export interface SheetAction {
  label: string
  icon: IconName
  onPress: () => void
  danger?: boolean
  /** Remplace l'icône (ex. pastille de statut colorée). */
  leading?: ReactNode
  /** Option actuellement choisie (coche + état d'accessibilité). */
  selected?: boolean
}

/** Feuille d'actions en bas d'écran (identique iOS/Android). */
export function Sheet({
  visible,
  onClose,
  title,
  header,
  actions,
}: {
  visible: boolean
  onClose: () => void
  title?: string
  header?: ReactNode
  actions: SheetAction[]
}) {
  const insets = useSafeAreaInsets()
  const t = useT()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.grabber} />
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {header}
        <ScrollView style={{ maxHeight: 420 }}>
          {actions.map((a) => (
            <Pressable
              key={a.label}
              accessibilityRole="button"
              accessibilityLabel={a.label}
              accessibilityState={a.selected === undefined ? undefined : { selected: a.selected }}
              onPress={() => {
                onClose()
                // Laisser la modale se fermer avant d'ouvrir une éventuelle alerte.
                setTimeout(a.onPress, 250)
              }}
              style={({ pressed }) => [styles.action, pressed && { backgroundColor: colors.bgHover }]}
            >
              {a.leading ?? <Ionicons name={a.icon} size={20} color={a.danger ? colors.danger : colors.textSecondary} />}
              <Text style={[styles.actionText, a.danger && { color: colors.danger }]}>{a.label}</Text>
              {a.selected ? <Ionicons name="checkmark" size={20} color={colors.primary} style={{ marginLeft: 'auto' }} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.bgAlt,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.sm,
    ...outline,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.bgHover, marginBottom: spacing.sm },
  title: { color: colors.textMuted, fontSize: font.sm, fontWeight: '700', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  action: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 14 },
  actionText: { color: colors.text, fontSize: font.md },
})
