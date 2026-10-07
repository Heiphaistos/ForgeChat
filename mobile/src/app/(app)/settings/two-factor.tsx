import * as Clipboard from 'expo-clipboard'
import { Stack, router } from 'expo-router'
import { useState } from 'react'
import { Alert, Linking, ScrollView, Share, StyleSheet, View } from 'react-native'
import { authApi, type TotpSetup } from '@/api/auth'
import { Button, Section, T, TextField } from '@/components/ui'
import { formatSecret } from '@/features/account/rules'
import { t as tr, useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { useAuth } from '@/stores/auth'
import { colors, font, radius, spacing } from '@/theme'

/** Double authentification : activation (clé + codes de secours + confirmation) ou désactivation. */
export default function TwoFactorScreen() {
  const t = useT()
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
      Alert.alert(tr('settings.twoFactor.enabledTitle'), tr('settings.twoFactor.enabledBody'))
      router.back()
    })

  const disable = () =>
    run(async () => {
      await authApi.disableTotp(code)
      setUser({ totp_enabled: false })
      Alert.alert(tr('settings.twoFactor.disabledTitle'))
      router.back()
    })

  const openAuthenticator = async () => {
    if (!setup) return
    try {
      await Linking.openURL(setup.qr_url)
    } catch {
      Alert.alert(tr('settings.twoFactor.noApp'), tr('settings.twoFactor.noAppBody'))
    }
  }

  const codeField = (
    <TextField
      label={t('settings.twoFactor.code')}
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
      <Stack.Screen options={{ title: t('settings.twoFactor.title') }} />
      {enabled ? (
        <>
          <T>{t('settings.twoFactor.enabledIntro')}</T>
          {codeField}
          <Button title={t('settings.twoFactor.disable')} variant="danger" onPress={disable} loading={loading} disabled={code.trim().length < 6} />
        </>
      ) : !setup ? (
        <>
          <T>{t('settings.twoFactor.intro')}</T>
          {error ? <T variant="error">{error}</T> : null}
          <Button title={t('settings.twoFactor.configure')} icon="shield-checkmark-outline" onPress={start} loading={loading} />
        </>
      ) : (
        <>
          <Section title={t('settings.twoFactor.step1')} footer={t('settings.twoFactor.step1Footer')}>
            <View style={{ padding: spacing.lg, gap: spacing.md }}>
              <T style={styles.mono} selectable>
                {formatSecret(setup.secret)}
              </T>
              <Button title={t('settings.twoFactor.openApp')} icon="open-outline" onPress={() => void openAuthenticator()} />
              <Button title={t('settings.twoFactor.copyKey')} variant="secondary" icon="copy-outline" onPress={() => void Clipboard.setStringAsync(setup.secret)} />
            </View>
          </Section>
          <Section title={t('settings.twoFactor.step2')} footer={t('settings.twoFactor.step2Footer')}>
            <View style={{ padding: spacing.lg, gap: spacing.md }}>
              <T style={styles.mono} selectable>
                {setup.backup_codes.join('\n')}
              </T>
              <Button
                title={t('settings.twoFactor.shareCodes')}
                variant="secondary"
                icon="share-outline"
                onPress={() => void Share.share({ message: t('settings.twoFactor.shareMessage', { codes: setup.backup_codes.join('\n') }) })}
              />
            </View>
          </Section>
          <T variant="label">{t('settings.twoFactor.step3')}</T>
          {codeField}
          <Button title={t('settings.twoFactor.enable')} onPress={confirm} loading={loading} disabled={code.trim().length < 6} />
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
