import { router } from 'expo-router'
import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'
import { authApi } from '@/api/auth'
import { Button, T, TextField } from '@/components/ui'
import { errorMessage } from '@/lib/http'
import { EMAIL_RE } from '@/lib/validation'
import { spacing } from '@/theme'

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const submit = async () => {
    if (!EMAIL_RE.test(email.trim())) return setError('Adresse e-mail invalide.')
    setLoading(true)
    setError(null)
    try {
      await authApi.forgotPassword(email)
      setSent(true)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <T variant="title" style={{ textAlign: 'center' }}>
            Mot de passe oublié
          </T>
          {sent ? (
            <View style={{ gap: spacing.lg }}>
              <T style={{ textAlign: 'center' }}>
                Si un compte existe pour {email.trim()}, un e-mail avec un lien de réinitialisation vient d’être envoyé. Le lien expire dans 30
                minutes.
              </T>
              <Button title="J’ai reçu le lien" onPress={() => router.push('/reset-password')} />
              <Button title="Retour à la connexion" variant="ghost" onPress={() => router.back()} />
            </View>
          ) : (
            <View style={{ gap: spacing.lg }}>
              <T variant="muted" style={{ textAlign: 'center' }}>
                Saisis l’adresse e-mail de ton compte : nous t’enverrons un lien pour choisir un nouveau mot de passe.
              </T>
              <TextField
                label="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                autoComplete="email"
                autoFocus
                returnKeyType="send"
                onSubmitEditing={submit}
                error={error}
              />
              <Button title="Envoyer le lien" onPress={submit} loading={loading} />
              <Button title="Retour" variant="ghost" onPress={() => router.back()} />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
})
