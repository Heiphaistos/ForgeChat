import { router } from 'expo-router'
import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'
import { authApi } from '@/api/auth'
import { Button, T, TextField } from '@/components/ui'
import { errorMessage } from '@/lib/http'
import { EMAIL_RE } from '@/lib/validation'
import { useT } from '@/i18n'
import { spacing } from '@/theme'

export default function ForgotPasswordScreen() {
  const t = useT()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const submit = async () => {
    if (!EMAIL_RE.test(email.trim())) return setError(t('auth.invalidEmailAddress'))
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
            {t('auth.forgotTitle')}
          </T>
          {sent ? (
            <View style={{ gap: spacing.lg }}>
              <T style={{ textAlign: 'center' }}>
                {t('auth.resetSent', { email: email.trim() })}
              </T>
              <Button title={t('auth.gotLink')} onPress={() => router.push('/reset-password')} />
              <Button title={t('auth.backToLogin')} variant="ghost" onPress={() => router.back()} />
            </View>
          ) : (
            <View style={{ gap: spacing.lg }}>
              <T variant="muted" style={{ textAlign: 'center' }}>
                {t('auth.forgotHelp')}
              </T>
              <TextField
                label={t('auth.email')}
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
              <Button title={t('auth.sendLink')} onPress={submit} loading={loading} />
              <Button title={t('common.back')} variant="ghost" onPress={() => router.back()} />
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
