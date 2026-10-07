import { router } from 'expo-router'
import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Button, PasswordField, T, TextField } from '@/components/ui'
import { errorMessage } from '@/lib/http'
import { validateRegistration, passwordStrength } from '@/lib/validation'
import { useAuth } from '@/stores/auth'
import { useT } from '@/i18n'
import { colors, spacing } from '@/theme'

export default function RegisterScreen() {
  const t = useT()
  const register = useAuth((s) => s.register)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const strength = passwordStrength(password)

  const submit = async () => {
    const errs = validateRegistration({ username, email, password, confirm })
    setErrors(errs)
    if (Object.keys(errs).length) return
    setLoading(true)
    setServerError(null)
    try {
      await register(username, email, password)
    } catch (e) {
      setServerError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <T variant="title" style={{ textAlign: 'center' }}>
            {t('auth.createAccount')}
          </T>
          <View style={{ gap: spacing.lg, marginTop: spacing.xl }}>
            <TextField
              label={t('auth.username')}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username-new"
              maxLength={32}
              error={errors.username}
            />
            <TextField
              label={t('auth.email')}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              error={errors.email}
            />
            <PasswordField
              label={t('auth.password')}
              value={password}
              onChangeText={setPassword}
              autoComplete="new-password"
              textContentType="newPassword"
              maxLength={128}
              error={errors.password}
            />
            {password ? (
              <View style={styles.meter}>
                {[0, 1, 2, 3].map((i) => (
                  <View
                    key={i}
                    style={[
                      styles.meterBar,
                      { backgroundColor: i < strength.score ? [colors.danger, colors.warning, colors.success, colors.success][strength.score - 1] : colors.bgHover },
                    ]}
                  />
                ))}
                <T variant="small" style={{ marginLeft: spacing.sm }}>
                  {strength.label}
                </T>
              </View>
            ) : null}
            <PasswordField
              label={t('auth.confirmPassword')}
              value={confirm}
              onChangeText={setConfirm}
              autoComplete="new-password"
              textContentType="newPassword"
              error={errors.confirm}
            />
            {serverError ? <T variant="error">{serverError}</T> : null}
            <Button title={t('auth.signUp')} onPress={submit} loading={loading} />
            <Button title={t('auth.haveAccount')} variant="ghost" onPress={() => router.back()} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  meter: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meterBar: { flex: 1, height: 4, borderRadius: 2 },
})
