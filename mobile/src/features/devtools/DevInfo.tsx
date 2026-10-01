import * as Application from 'expo-application'
import { useState } from 'react'
import { Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button, Row } from '@/components/ui'
import { API_ORIGIN, APP_ENV, APP_VERSION, WS_URL } from '@/config/env'
import { clearLogs, recentLogs, redact } from '@/lib/logger'
import { useConnection } from '@/lib/realtime'
import { colors, font, radius, spacing } from '@/theme'

/**
 * Panneau « Infos dev » (dev-apk, lan, development) : version, environnement, serveur, et export
 * des journaux récents, secrets masqués. Jamais compilé dans le client-apk : importé uniquement
 * sous la condition constante EXPO_PUBLIC_APP_ENV !== 'production' (voir (tabs)/you.tsx).
 */
export function DevInfoRow() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Row icon="construct-outline" title="Infos dev" subtitle={`${APP_ENV} · ${new URL(API_ORIGIN).host}`} onPress={() => setOpen(true)} chevron />
      {open ? <DevInfoModal onClose={() => setOpen(false)} /> : null}
    </>
  )
}

export function devInfoLines(): [string, string][] {
  return [
    ['Version', `${APP_VERSION} (build ${Application.nativeBuildVersion ?? '?'})`],
    ['Application', Application.applicationId ?? '?'],
    ['Environnement', APP_ENV],
    ['Serveur', API_ORIGIN],
    ['Temps réel', WS_URL],
    ['Système', `${Platform.OS} ${String(Platform.Version)}`],
  ]
}

function DevInfoModal({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets()
  const ws = useConnection((s) => s.status)
  const [count, setCount] = useState(recentLogs().length)
  const lines = devInfoLines()

  const exportLogs = async () => {
    const header = [...lines, ['Connexion', ws], ['Exporté le', new Date().toISOString()]]
      .map(([k, v]) => `${k} : ${v}`)
      .join('\n')
    // Lignes déjà masquées à l'écriture ; second passage par sécurité.
    const body = recentLogs().map(redact).join('\n') || '(aucune ligne)'
    await Share.share({ title: 'Journaux ForgeChat', message: `${header}\n\n${body}` })
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Infos dev</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Fermer" hitSlop={8}>
            <Text style={styles.close}>Fermer</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ gap: spacing.md }}>
          <View style={styles.card}>
            {[...lines, ['Connexion', ws] as [string, string]].map(([k, v]) => (
              <View key={k} style={styles.line}>
                <Text style={styles.key}>{k}</Text>
                <Text style={styles.value} selectable>
                  {v}
                </Text>
              </View>
            ))}
          </View>
          <Text style={styles.note}>
            {count} ligne{count > 1 ? 's' : ''} de journal en mémoire. Jetons, mots de passe et tickets sont masqués avant
            l’export ; relis quand même le texte avant de l’envoyer.
          </Text>
          <Button title="Exporter les journaux" icon="share-outline" onPress={() => void exportLogs()} />
          <Button
            title="Effacer les journaux"
            variant="secondary"
            onPress={() => {
              clearLogs()
              setCount(0)
            }}
          />
        </ScrollView>
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
