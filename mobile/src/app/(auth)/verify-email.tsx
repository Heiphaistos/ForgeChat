import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Button, T, TextField } from '@/components/ui'
import { errorMessage } from '@/lib/http'
import { useAuth } from '@/stores/auth'
import { spacing } from '@/theme'

/** Inscription : le compte n'existe qu'après le code à 6 chiffres reçu par e-mail (handlers/auth.rs). */
export default function VerifyEmailScreen() {
  const { email } = useLocalSearchParams<{ email?: string }>()
  const verifyEmail = useAuth((s) => s.verifyEmail)
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const c = code.replace(/\D/g, '')
    if (!email || c.length !== 6) return setError('Entre les 6 chiffres reçus par e-mail')
    setLoading(true)
    setError(null)
    try {
      await verifyEmail(email, c)
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
            Vérifie ton e-mail
          </T>
          <View style={{ gap: spacing.lg, marginTop: spacing.xl }}>
            <T variant="muted" style={{ textAlign: 'center' }}>
              Un code à 6 chiffres a été envoyé à {email ?? ''}. Il expire dans 15 minutes.
            </T>
            <TextField
              label="Code de vérification"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={6}
              error={error ?? undefined}
            />
            <Button title="Créer mon compte" onPress={submit} loading={loading} />
            <Button title="Retour" variant="ghost" onPress={() => router.back()} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
})
