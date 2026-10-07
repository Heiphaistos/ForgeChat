import { router } from 'expo-router'
import { useState } from 'react'
import { ScrollView } from 'react-native'
import { authApi } from '@/api/auth'
import { Button, PasswordField, T } from '@/components/ui'
import { t as tr, useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { passwordStrength } from '@/lib/validation'
import { useAuth } from '@/stores/auth'
import { colors, spacing } from '@/theme'

export default function PasswordScreen() {
  const t = useT()
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (newPw.length < 8 || newPw.length > 128) return setError(tr('settings.password.length'))
    if (passwordStrength(newPw).score < 2) return setError(tr('settings.password.weak'))
    if (newPw !== confirm) return setError(tr('settings.password.mismatch'))
    if (newPw === oldPw) return setError(tr('settings.password.same'))
    setLoading(true)
    setError(null)
    try {
      await authApi.changePassword(oldPw, newPw)
      // Le serveur a déjà révoqué toutes les sessions (et ce jeton) : fin de session locale.
      router.dismissAll()
      await useAuth.getState().signOutLocally(tr('settings.password.changed'))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <T variant="muted">{t('settings.password.intro')}</T>
      <PasswordField label={t('settings.password.current')} value={oldPw} onChangeText={setOldPw} autoComplete="current-password" textContentType="password" />
      <PasswordField label={t('settings.password.new')} value={newPw} onChangeText={setNewPw} autoComplete="new-password" textContentType="newPassword" maxLength={128} />
      <PasswordField label={t('settings.password.confirm')} value={confirm} onChangeText={setConfirm} autoComplete="new-password" textContentType="newPassword" error={error} />
      <Button title={t('settings.password.submit')} onPress={submit} loading={loading} />
    </ScrollView>
  )
}
