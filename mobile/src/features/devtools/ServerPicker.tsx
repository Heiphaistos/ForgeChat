import { Image } from 'expo-image'
import { useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button, TextField } from '@/components/ui'
import { APP_ENV, BUILD_API_ORIGIN, apiHost, apiOrigin, setApiOrigin } from '@/config/env'
import { CLEARTEXT_RULE, checkServerUrl, localServerUrl, type ServerUrlCheck } from '@/config/serverUrl'
import { t, useT } from '@/i18n'
import { useAuth } from '@/stores/auth'
import { colors, font, radius, spacing } from '@/theme'
import { clearOrigin, saveOrigin, serverChoiceEnabled } from './serverChoice'

/**
 * Écran « Serveur » de l'APK DEV (et du build de développement) : pré-prod fixée au build, serveur
 * local (IP du PC) ou adresse libre. Jamais compilé dans le client-apk (imports conditionnels sur
 * EXPO_PUBLIC_APP_ENV, voir env.ts, login.tsx et DevInfo.tsx).
 */

const buildLabel = () => t(APP_ENV === 'preview' ? 'dev.sp.buildPreview' : 'dev.sp.buildServer')

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
  const tr = useT()
  const [open, setOpen] = useState(false)
  if (!serverChoiceEnabled(APP_ENV)) return null
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={tr('dev.sp.linkA11y', { host: host || tr('dev.noServer') })}
        style={[styles.link, !host && styles.linkWarning]}
      >
        <Text style={styles.linkText}>{host ? tr('dev.sp.link', { host }) : tr('dev.sp.noneChosen')}</Text>
        <Text style={styles.linkAction}>{tr('dev.sp.change')}</Text>
      </Pressable>
      {open ? <ServerModal onClose={() => setOpen(false)} /> : null}
    </>
  )
}

export function ServerModal({ onClose }: { onClose: () => void }) {
  const tr = useT()
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
      tr('dev.sp.confirmTitle'),
      `${current ? `${tr('dev.sp.confirmLogout', { host: apiHost() })}\n\n` : ''}${tr('dev.sp.newServer', { origin: check.origin })}`,
      [
        { text: tr('common.cancel'), style: 'cancel' },
        {
          text: tr('dev.sp.change'),
          style: 'destructive',
          onPress: () => {
            setBusy(true)
            switchServer(check.origin)
              .then(onClose)
              .catch((e: unknown) => setError(e instanceof Error ? e.message : tr('dev.sp.failed')))
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
          <Text style={styles.title}>{tr('dev.sp.title')}</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={tr('common.close')} hitSlop={8}>
            <Text style={styles.close}>{tr('common.close')}</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ gap: spacing.md }} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.key}>{tr('dev.sp.current')}</Text>
            <Text style={styles.value} selectable>
              {current || tr('dev.sp.noneChosen')}
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.key}>{buildLabel()}</Text>
            <Text style={styles.value}>{BUILD_API_ORIGIN || tr('dev.sp.notConfigured')}</Text>
            <Button
              title={tr('dev.sp.use', { label: buildLabel() })}
              variant="secondary"
              disabled={!BUILD_API_ORIGIN || busy}
              onPress={() => choose({ ok: true, origin: BUILD_API_ORIGIN })}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.key}>{tr('dev.sp.local')}</Text>
            <TextField label={tr('dev.sp.ip')} value={ip} onChangeText={setIp} placeholder="192.168.1.x" keyboardType="decimal-pad" autoCorrect={false} />
            <TextField label={tr('dev.sp.port')} value={port} onChangeText={setPort} keyboardType="number-pad" maxLength={5} />
            <Button title={tr('dev.sp.useLocal')} variant="secondary" disabled={busy} onPress={() => choose(localServerUrl(ip, port))} />
          </View>

          <View style={styles.card}>
            <Text style={styles.key}>{tr('dev.sp.free')}</Text>
            <TextField
              label={tr('dev.sp.url')}
              value={url}
              onChangeText={setUrl}
              placeholder="https://…"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Button title={tr('dev.sp.useUrl')} variant="secondary" disabled={busy} onPress={() => choose(checkServerUrl(url))} />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Text style={styles.note}>
            {CLEARTEXT_RULE} {tr('dev.sp.note')}
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
