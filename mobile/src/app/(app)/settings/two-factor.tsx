import * as Clipboard from 'expo-clipboard'
import { Stack, router } from 'expo-router'
import { useState } from 'react'
import { Alert, Linking, ScrollView, Share, StyleSheet, View } from 'react-native'
import { authApi, type TotpSetup } from '@/api/auth'
import { Button, Section, T, TextField } from '@/components/ui'
import { formatSecret } from '@/features/account/rules'
import { errorMessage } from '@/lib/http'
import { useAuth } from '@/stores/auth'
import { colors, font, radius, spacing } from '@/theme'

/** Double authentification : activation (clé + codes de secours + confirmation) ou désactivation. */
export default function TwoFactorScreen() {
  const enabled = useAuth((s) => !!s.user?.totp_enabled)
  const setUser = useAuth((s) => s.setUser)
  const [setup, setSetup] = useState<TotpSetup | null>(null)
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<void>) => {
    setLoading(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const start = () => run(async () => setSetup(await authApi.setupTotp()))

  const confirm = () =>
    run(async () => {
      await authApi.confirmTotp(code)
      setUser({ totp_enabled: true })
      Alert.alert('Double authentification activée', 'Garde tes codes de secours en lieu sûr.')
      router.back()
    })

  const disable = () =>
    run(async () => {
      await authApi.disableTotp(code)
      setUser({ totp_enabled: false })
      Alert.alert('Double authentification désactivée')
      router.back()
    })

  const openAuthenticator = async () => {
    if (!setup) return
    try {
      await Linking.openURL(setup.qr_url)
    } catch {
      Alert.alert('Aucune application trouvée', 'Copie la clé et saisis-la dans ton application d’authentification.')
    }
  }

  const codeField = (
    <TextField
      label="Code à 6 chiffres"
      value={code}
      onChangeText={setCode}
      keyboardType="number-pad"
      autoComplete="one-time-code"
      textContentType="oneTimeCode"
      maxLength={8}
      error={error}
    />
  )

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Double authentification' }} />
      {enabled ? (
        <>
          <T>La double authentification est activée. Pour la désactiver, saisis un code de ton application d’authentification.</T>
          {codeField}
          <Button title="Désactiver" variant="danger" onPress={disable} loading={loading} disabled={code.trim().length < 6} />
        </>
      ) : !setup ? (
        <>
          <T>
            Protège ton compte : à chaque connexion, un code à 6 chiffres te sera demandé en plus du mot de passe. Il te faut une application
            d’authentification (Aegis, Google Authenticator, 2FAS…).
          </T>
          {error ? <T variant="error">{error}</T> : null}
          <Button title="Configurer" icon="shield-checkmark-outline" onPress={start} loading={loading} />
        </>
      ) : (
        <>
          <Section title="1. Ajoute ForgeChat à ton application" footer="Sans QR code ici : ouvre le lien ou recopie la clé dans ton application.">
            <View style={{ padding: spacing.lg, gap: spacing.md }}>
              <T style={styles.mono} selectable>
                {formatSecret(setup.secret)}
              </T>
              <Button title="Ouvrir l’application d’authentification" icon="open-outline" onPress={() => void openAuthenticator()} />
              <Button title="Copier la clé" variant="secondary" icon="copy-outline" onPress={() => void Clipboard.setStringAsync(setup.secret)} />
            </View>
          </Section>
          <Section title="2. Garde tes codes de secours" footer="Chaque code ne sert qu’une fois. C’est le seul recours si tu perds ton téléphone.">
            <View style={{ padding: spacing.lg, gap: spacing.md }}>
              <T style={styles.mono} selectable>
                {setup.backup_codes.join('\n')}
              </T>
              <Button
                title="Partager les codes"
                variant="secondary"
                icon="share-outline"
                onPress={() => void Share.share({ message: `Codes de secours ForgeChat :\n${setup.backup_codes.join('\n')}` })}
              />
            </View>
          </Section>
          <T variant="label">3. Confirme avec un code</T>
          {codeField}
          <Button title="Activer" onPress={confirm} loading={loading} disabled={code.trim().length < 6} />
        </>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  mono: {
    fontFamily: 'monospace',
    fontSize: font.md,
    color: colors.text,
    backgroundColor: colors.bgDeep,
    padding: spacing.md,
    borderRadius: radius.md,
    textAlign: 'center',
  },
})
