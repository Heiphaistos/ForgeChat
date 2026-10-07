import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView } from 'react-native'
import { usersApi } from '@/api/users'
import { Button, PasswordField, T, TextField } from '@/components/ui'
import { DELETE_CONFIRM_WORD, deleteAccountError, deleteAccountFailure } from '@/features/account/deleteAccount'
import { t as tr, useT } from '@/i18n'
import { useAuth } from '@/stores/auth'
import { colors, spacing } from '@/theme'

export default function DeleteAccountScreen() {
  const t = useT()
  const [password, setPassword] = useState('')
  const [confirmWord, setConfirmWord] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const doDelete = async () => {
    setLoading(true)
    setError(null)
    setFormError(null)
    try {
      await usersApi.deleteAccount(password)
      // Compte supprimé côté serveur (sessions et appareils push compris, en cascade) :
      // fin de session locale complète (jetons, cache, token push, notifications).
      router.dismissAll()
      await useAuth.getState().signOutLocally(tr('settings.deleteAccount.deleted'))
    } catch (e) {
      // Seul un mot de passe refusé s'affiche sous le champ ; le reste sous le bouton.
      const f = deleteAccountFailure(e)
      if (f.field === 'password') setError(f.message)
      else setFormError(f.message)
    } finally {
      setLoading(false)
    }
  }

  const submit = () => {
    const invalid = deleteAccountError(password, confirmWord)
    setFormError(null)
    if (invalid) {
      setError(invalid)
      return
    }
    Alert.alert(t('settings.deleteAccount.confirmTitle'), t('settings.deleteAccount.confirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings.deleteAccount.submit'), style: 'destructive', onPress: () => void doDelete() },
    ])
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <T>{t('settings.deleteAccount.intro')}</T>
      <T variant="muted">{t('settings.deleteAccount.owner')}</T>
      <TextField
        label={t('settings.deleteAccount.retype', { word: DELETE_CONFIRM_WORD })}
        value={confirmWord}
        onChangeText={setConfirmWord}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <PasswordField
        label={t('settings.deleteAccount.password')}
        value={password}
        onChangeText={setPassword}
        autoComplete="current-password"
        textContentType="password"
        error={error}
      />
      {formError ? <T style={{ color: colors.danger }}>{formError}</T> : null}
      <Button title={t('settings.deleteAccount.submit')} variant="danger" onPress={submit} loading={loading} />
    </ScrollView>
  )
}
