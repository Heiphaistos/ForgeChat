import { Link } from 'expo-router'
import { useRef, useState, useSyncExternalStore } from 'react'
import { ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Button, PasswordField, T, TextField } from '@/components/ui'
import { apiHost, subscribeApiOrigin } from '@/config/env'
import { useT } from '@/i18n'
import { ApiError, errorMessage } from '@/lib/http'
import { useAuth } from '@/stores/auth'
import { SavedAccountsLogin } from '@/features/account/AccountSwitcher'
import { colors, radius, spacing } from '@/theme'

// APK DEV : choix du serveur avant connexion. Retiré du bundle de production (condition constante).
const DevServerLink =
  process.env.EXPO_PUBLIC_APP_ENV === 'production'
    ? null
    : // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('@/features/devtools/ServerPicker') as typeof import('@/features/devtools/ServerPicker')).DevServerLink

export default function LoginScreen() {
  const t = useT()
  const login = useAuth((s) => s.login)
  const notice = useAuth((s) => s.notice)
  const clearNotice = useAuth((s) => s.clearNotice)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [needTotp, setNeedTotp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const passwordRef = useRef<TextInput>(null)
  const host = useSyncExternalStore(subscribeApiOrigin, apiHost)

  const submit = async () => {
    if (!email.trim() || !password) {
      setError(t('auth.missingCredentials'))
      return
    }
    if (needTotp && !/^[0-9A-Za-z-]{6,20}$/.test(totp.trim())) {
      setError(t('auth.invalidTotp'))
      return
    }
    setLoading(true)
    setError(null)
    clearNotice()
    try {
      await login(email, password, needTotp ? totp.trim() : undefined)
      setPassword('')
    } catch (e) {
      if (e instanceof ApiError && e.code === 'totp_required') {
        setNeedTotp(true)
        setError(null)
      } else {
        setError(errorMessage(e))
        setPassword('')
        setNeedTotp(false)
        setTotp('')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.logo}>
            <T variant="title" style={{ fontSize: 34 }}>
              ForgeChat
            </T>
          </View>
          <T variant="subtitle" style={{ textAlign: 'center' }}>
            {t(needTotp ? 'auth.twoStep' : 'auth.welcomeBack')}
          </T>
          <T variant="muted" style={{ textAlign: 'center', marginBottom: spacing.xl }}>
            {needTotp ? t('auth.totpHelp') : t('auth.connectingTo', { host: host || t('auth.noServer') })}
          </T>

          {DevServerLink ? <DevServerLink host={host} /> : null}
          {notice ? <T style={styles.notice}>{notice}</T> : null}
          {!needTotp ? <SavedAccountsLogin /> : null}

          <View style={{ gap: spacing.lg }}>
            {!needTotp ? (
              <>
                <TextField
                  label={t('auth.email')}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  autoComplete="email"
                  textContentType="username"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />
                <PasswordField
                  ref={passwordRef}
                  label={t('auth.password')}
                  value={password}
                  onChangeText={setPassword}
                  autoComplete="current-password"
                  textContentType="password"
                  returnKeyType="go"
                  onSubmitEditing={submit}
                />
              </>
            ) : (
              <TextField
                label={t('auth.totpLabel')}
                value={totp}
                onChangeText={setTotp}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                autoFocus
                maxLength={20}
                returnKeyType="go"
                onSubmitEditing={submit}
              />
            )}
            {error ? <T variant="error">{error}</T> : null}
            <Button title={t(needTotp ? 'auth.verify' : 'auth.login')} onPress={submit} loading={loading} />
            {needTotp ? (
              <Button
                title={t('common.back')}
                variant="ghost"
                onPress={() => {
                  setNeedTotp(false)
                  setTotp('')
                }}
              />
            ) : (
              <>
                <Link href="/forgot-password" asChild>
                  <Button title={t('auth.forgot')} variant="ghost" />
                </Link>
                <Link href="/register" asChild>
                  <Button title={t('auth.noAccount')} variant="ghost" />
                </Link>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  logo: { alignItems: 'center', marginBottom: spacing.lg },
  notice: {
    backgroundColor: 'rgba(240,178,50,0.15)',
    color: colors.warning,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
})
