import * as Application from 'expo-application'
import { useState } from 'react'
import { Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button, Row } from '@/components/ui'
import { APP_ENV, APP_VERSION, apiHost, apiOrigin, wsUrl } from '@/config/env'
import { t, useT } from '@/i18n'
import { clearLogs, recentLogs, redact } from '@/lib/logger'
import { useConnection } from '@/lib/realtime'
import { colors, font, radius, spacing } from '@/theme'
import { ServerModal } from './ServerPicker'
import { serverChoiceEnabled } from './serverChoice'

/**
 * Panneau « Infos dev » (dev-apk, lan, development) : version, environnement, serveur (et son
 * changement, voir ServerPicker.tsx), export
 * des journaux récents, secrets masqués. Jamais compilé dans le client-apk : importé uniquement
 * sous la condition constante EXPO_PUBLIC_APP_ENV !== 'production' (voir (tabs)/you.tsx).
 */
export function DevInfoRow() {
  const tr = useT()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Row icon="construct-outline" title={tr('dev.title')} subtitle={`${APP_ENV} · ${apiHost() || tr('dev.noServer')}`} onPress={() => setOpen(true)} chevron />
      {open ? <DevInfoModal onClose={() => setOpen(false)} /> : null}
    </>
  )
}

export function devInfoLines(): [string, string][] {
  return [
    [t('dev.version'), `${APP_VERSION} (build ${Application.nativeBuildVersion ?? '?'})`],
    [t('dev.app'), Application.applicationId ?? '?'],
    [t('dev.env'), APP_ENV],
    [t('dev.server'), apiOrigin() || t('dev.none')],
    [t('dev.realtime'), apiOrigin() ? wsUrl() : '—'],
    [t('dev.system'), `${Platform.OS} ${String(Platform.Version)}`],
  ]
}

function DevInfoModal({ onClose }: { onClose: () => void }) {
  const tr = useT()
  const insets = useSafeAreaInsets()
  const ws = useConnection((s) => s.status)
  const [count, setCount] = useState(recentLogs().length)
  const [serverOpen, setServerOpen] = useState(false)
  const lines = devInfoLines()

  const exportLogs = async () => {
    const header = [...lines, [tr('dev.connection'), ws], [tr('dev.exportedAt'), new Date().toISOString()]]
      .map(([k, v]) => `${k} : ${v}`)
      .join('\n')
    // Lignes déjà masquées à l'écriture ; second passage par sécurité.
    const body = recentLogs().map(redact).join('\n') || tr('dev.noLines')
    await Share.share({ title: tr('dev.logsTitle'), message: `${header}\n\n${body}` })
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.header}>
          <Text style={styles.title}>{tr('dev.title')}</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={tr('common.close')} hitSlop={8}>
            <Text style={styles.close}>{tr('common.close')}</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ gap: spacing.md }}>
          <View style={styles.card}>
            {[...lines, [tr('dev.connection'), ws] as [string, string]].map(([k, v]) => (
              <View key={k} style={styles.line}>
                <Text style={styles.key}>{k}</Text>
                <Text style={styles.value} selectable>
                  {v}
                </Text>
              </View>
            ))}
          </View>
          <Text style={styles.note}>{tr('dev.logCount', { n: count })}</Text>
          {serverChoiceEnabled(APP_ENV) ? (
            <Button title={tr('dev.changeServer')} icon="server-outline" variant="secondary" onPress={() => setServerOpen(true)} />
          ) : null}
          <Button title={tr('dev.exportLogs')} icon="share-outline" onPress={() => void exportLogs()} />
          <Button
            title={tr('dev.clearLogs')}
            variant="secondary"
            onPress={() => {
              clearLogs()
              setCount(0)
            }}
          />
        </ScrollView>
        {serverOpen ? <ServerModal onClose={() => setServerOpen(false)} /> : null}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.lg, gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text, fontSize: font.xl, fontWeight: '800' },
  close: { color: colors.primary, fontWeight: '700', fontSize: font.md },
  card: { backgroundColor: colors.bgAlt, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  line: { gap: 2 },
  key: { color: colors.textMuted, fontSize: font.xs, fontWeight: '700', textTransform: 'uppercase' },
  value: { color: colors.text, fontSize: font.sm },
  note: { color: colors.textMuted, fontSize: font.sm },
})
