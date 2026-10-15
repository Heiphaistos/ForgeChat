import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, StyleSheet, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'
import { authApi } from '@/api/auth'
import { MIN_PASSWORD, deriveSecrets, newKdfSalt, passwordProblem } from '@/e2e/authKdf'
import { pwnedProblem } from '@/e2e/pwned'
import { Button, PasswordField, T, TextField } from '@/components/ui'
import { extractResetToken } from '@/features/account/rules'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { passwordStrength } from '@/lib/validation'
import { useAuth } from '@/stores/auth'
import { colors, spacing } from '@/theme'

/**
 * Réinitialisation du mot de passe. Ouvert par le lien du mail (lib/deepLinks : jeton revalidé)
 * ou depuis « Mot de passe oublié » : on peut alors coller le lien reçu.
 */
export default function ResetPasswordScreen() {
  const t = useT()
  const params = useLocalSearchParams<{ token?: string }>()
  const fromLink = extractResetToken(typeof params.token === 'string' ? params.token : null)
  const [pasted, setPasted] = useState('')
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const token = fromLink ?? extractResetToken(pasted)

  const submit = async () => {
    if (!token) return setError(t('social.reset.pasteLink'))
    if (pw.length < MIN_PASSWORD || pw.length > 128) return setError(t('social.reset.length'))
    if (passwordStrength(pw).score < 2) return setError(t('social.reset.weak'))
    const local = passwordProblem(pw)
    if (local) return setError(local)
    if (pw !== confirm) return setError(t('social.reset.mismatch'))
    setLoading(true)
    setError(null)
    const leaked = await pwnedProblem(pw)
    if (leaked) {
      setLoading(false)
      return setError(leaked)
    }
    try {
      // Le nouveau mot de passe ne part pas : seulement sa preuve et le nouveau sel.
      const kdfSalt = newKdfSalt()
      const s = await deriveSecrets(pw, kdfSalt, 'argon2id')
      s.wrapKey.fill(0)
      await authApi.resetPassword(token, s.auth, kdfSalt)
      // Le serveur a révoqué toutes les sessions, y compris celle-ci le cas échéant.
      if (useAuth.getState().status === 'signedIn') {
        await useAuth.getState().signOutLocally(t('social.reset.signedOut'))
      } else {
        Alert.alert(t('social.reset.done'), t('social.reset.doneBody'))
      }
      router.replace('/login')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setPw('')
      setConfirm('')
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <T variant="title" style={{ textAlign: 'center' }}>
            {t('social.reset.newPassword')}
          </T>
          <T variant="muted" style={{ textAlign: 'center' }}>
            {t('social.reset.intro')}
          </T>
          <View style={{ gap: spacing.lg }}>
            {fromLink ? null : (
              <TextField
                label={t('social.reset.link')}
                placeholder="https://…/reset-password#token=…"
                value={pasted}
                onChangeText={setPasted}
                autoCapitalize="none"
                autoCorrect={false}
              />
            )}
            <PasswordField label={t('social.reset.newPassword')} value={pw} onChangeText={setPw} autoComplete="new-password" textContentType="newPassword" maxLength={128} />
            <PasswordField label={t('common.confirm')} value={confirm} onChangeText={setConfirm} autoComplete="new-password" textContentType="newPassword" error={error} />
            <Button title={t('social.reset.submit')} onPress={submit} loading={loading} disabled={!token} />
            <Button title={t('common.cancel')} variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
})
