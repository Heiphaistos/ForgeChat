import { Image } from 'expo-image'
import { useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button, TextField } from '@/components/ui'
import { APP_ENV, BUILD_API_ORIGIN, apiHost, apiOrigin, setApiOrigin } from '@/config/env'
import { CLEARTEXT_RULE, checkServerUrl, localServerUrl, type ServerUrlCheck } from '@/config/serverUrl'
import { useAuth } from '@/stores/auth'
import { colors, font, radius, spacing } from '@/theme'
import { clearOrigin, saveOrigin, serverChoiceEnabled } from './serverChoice'

/**
 * Écran « Serveur » de l'APK DEV (et du build de développement) : pré-prod fixée au build, serveur
 * local (IP du PC) ou adresse libre. Jamais compilé dans le client-apk (imports conditionnels sur
 * EXPO_PUBLIC_APP_ENV, voir env.ts, login.tsx et DevInfo.tsx).
 */

const BUILD_LABEL = APP_ENV === 'preview' ? 'Pré-prod' : 'Serveur du build'

/**
 * Change de serveur : déconnexion complète du serveur actuel (révocation de la session, désinscription
 * push, jetons, caches), PUIS bascule vers le nouveau. `next === BUILD_API_ORIGIN` efface le choix.
 */
export async function switchServer(next: string): Promise<void> {
  const auth = useAuth.getState()
  if (auth.status === 'signedIn' || auth.status === 'offline') await auth.logout('current')
  else await auth.signOutLocally()
  await Promise.allSettled([Image.clearDiskCache(), Image.clearMemoryCache()])
  if (next === BUILD_API_ORIGIN) await clearOrigin()
  else await saveOrigin(next)
  setApiOrigin(next)
}

/**
 * Lien affiché sur l'écran de connexion : serveur actuel + accès à l'écran « Serveur ».
 * `host` vient de l'écran (abonné aux changements via subscribeApiOrigin).
 */
export function DevServerLink({ host }: { host: string }) {
  const [open, setOpen] = useState(false)
  if (!serverChoiceEnabled(APP_ENV)) return null
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Serveur de test : ${host || 'aucun'}. Changer de serveur`}
        style={[styles.link, !host && styles.linkWarning]}
      >
        <Text style={styles.linkText}>{host ? `Serveur (dev) : ${host}` : 'Aucun serveur choisi'}</Text>
        <Text style={styles.linkAction}>Changer</Text>
      </Pressable>
      {open ? <ServerModal onClose={() => setOpen(false)} /> : null}
    </>
  )
}

export function ServerModal({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets()
  const [ip, setIp] = useState('')
  const [port, setPort] = useState('8080')
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const current = apiOrigin()

  const choose = (check: ServerUrlCheck) => {
    if (!check.ok) {
      setError(check.reason)
      return
    }
    setError(null)
    if (check.origin === current) {
      onClose()
      return
    }
    Alert.alert(
      'Changer de serveur ?',
      `${current ? `Tu seras déconnecté de ${apiHost()} : session, cache et notifications de cet appareil sont effacés.\n\n` : ''}Nouveau serveur : ${check.origin}`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Changer',
          style: 'destructive',
          onPress: () => {
            setBusy(true)
            switchServer(check.origin)
              .then(onClose)
              .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Changement impossible'))
              .finally(() => setBusy(false))
          },
        },
      ],
    )
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Serveur</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Fermer" hitSlop={8}>
            <Text style={styles.close}>Fermer</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ gap: spacing.md }} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.key}>Actuel</Text>
            <Text style={styles.value} selectable>
              {current || 'Aucun serveur choisi'}
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.key}>{BUILD_LABEL}</Text>
            <Text style={styles.value}>{BUILD_API_ORIGIN || 'Non configurée dans ce build'}</Text>
            <Button
              title={`Utiliser : ${BUILD_LABEL}`}
              variant="secondary"
              disabled={!BUILD_API_ORIGIN || busy}
              onPress={() => choose({ ok: true, origin: BUILD_API_ORIGIN })}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.key}>Serveur local (PC du réseau)</Text>
            <TextField label="IP du PC" value={ip} onChangeText={setIp} placeholder="192.168.1.x" keyboardType="decimal-pad" autoCorrect={false} />
            <TextField label="Port" value={port} onChangeText={setPort} keyboardType="number-pad" maxLength={5} />
            <Button title="Utiliser : serveur local" variant="secondary" disabled={busy} onPress={() => choose(localServerUrl(ip, port))} />
          </View>

          <View style={styles.card}>
            <Text style={styles.key}>Adresse libre</Text>
            <TextField
              label="URL du serveur"
              value={url}
              onChangeText={setUrl}
              placeholder="https://…"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Button title="Utiliser cette adresse" variant="secondary" disabled={busy} onPress={() => choose(checkServerUrl(url))} />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Text style={styles.note}>
            {CLEARTEXT_RULE} Changer de serveur te déconnecte complètement (session, cache, notifications). Le choix est
            conservé au redémarrage.
          </Text>
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
  key: { color: colors.textMuted, fontSize: font.xs, fontWeight: '700', textTransform: 'uppercase' },
  value: { color: colors.text, fontSize: font.sm },
  error: { color: colors.danger, fontSize: font.sm },
  note: { color: colors.textMuted, fontSize: font.sm },
  link: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgAlt,
    marginBottom: spacing.lg,
  },
  linkWarning: { borderWidth: 1, borderColor: colors.danger },
  linkText: { color: colors.textSecondary, fontSize: font.sm, flexShrink: 1 },
  linkAction: { color: colors.primary, fontWeight: '700', fontSize: font.sm },
})
