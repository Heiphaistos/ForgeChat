import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, StyleSheet, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'
import { authApi } from '@/api/auth'
import { Button, PasswordField, T, TextField } from '@/components/ui'
import { extractResetToken } from '@/features/account/rules'
import { errorMessage } from '@/lib/http'
import { passwordStrength } from '@/lib/validation'
import { useAuth } from '@/stores/auth'
import { colors, spacing } from '@/theme'

/**
 * Réinitialisation du mot de passe. Ouvert par le lien du mail (lib/deepLinks : jeton revalidé)
 * ou depuis « Mot de passe oublié » : on peut alors coller le lien reçu.
 */
export default function ResetPasswordScreen() {
  const params = useLocalSearchParams<{ token?: string }>()
  const fromLink = extractResetToken(typeof params.token === 'string' ? params.token : null)
  const [pasted, setPasted] = useState('')
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const token = fromLink ?? extractResetToken(pasted)

  const submit = async () => {
    if (!token) return setError('Colle le lien reçu par e-mail.')
    if (pw.length < 8 || pw.length > 128) return setError('Le mot de passe doit faire 8 à 128 caractères.')
    if (passwordStrength(pw).score < 2) return setError('Mot de passe trop faible.')
    if (pw !== confirm) return setError('Les mots de passe ne correspondent pas.')
    setLoading(true)
    setError(null)
    try {
      await authApi.resetPassword(token, pw)
      // Le serveur a révoqué toutes les sessions, y compris celle-ci le cas échéant.
      if (useAuth.getState().status === 'signedIn') {
        await useAuth.getState().signOutLocally('Mot de passe réinitialisé. Reconnecte-toi avec ton nouveau mot de passe.')
      } else {
        Alert.alert('Mot de passe modifié', 'Tu peux te connecter avec ton nouveau mot de passe.')
      }
      router.replace('/login')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgDeep }}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <T variant="title" style={{ textAlign: 'center' }}>
            Nouveau mot de passe
          </T>
          <T variant="muted" style={{ textAlign: 'center' }}>
            Tous tes appareils seront déconnectés après le changement.
          </T>
          <View style={{ gap: spacing.lg }}>
            {fromLink ? null : (
              <TextField
                label="Lien reçu par e-mail"
                placeholder="https://…/reset-password#token=…"
                value={pasted}
                onChangeText={setPasted}
                autoCapitalize="none"
                autoCorrect={false}
              />
            )}
            <PasswordField label="Nouveau mot de passe" value={pw} onChangeText={setPw} autoComplete="new-password" textContentType="newPassword" maxLength={128} />
            <PasswordField label="Confirmer" value={confirm} onChangeText={setConfirm} autoComplete="new-password" textContentType="newPassword" error={error} />
            <Button title="Changer le mot de passe" onPress={submit} loading={loading} disabled={!token} />
            <Button title="Annuler" variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
})
