import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView } from 'react-native'
import { usersApi } from '@/api/users'
import { Button, PasswordField, T, TextField } from '@/components/ui'
import { DELETE_CONFIRM_WORD, deleteAccountError, deleteAccountFailure } from '@/features/account/deleteAccount'
import { useAuth } from '@/stores/auth'
import { colors, spacing } from '@/theme'

export default function DeleteAccountScreen() {
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
      await useAuth.getState().signOutLocally('Ton compte a été supprimé.')
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
    Alert.alert('Supprimer définitivement ton compte ?', 'Cette action est irréversible.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer mon compte', style: 'destructive', onPress: () => void doDelete() },
    ])
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <T>La suppression est définitive : ton profil, tes amis, tes messages privés et tes sessions seront effacés.</T>
      <T variant="muted">
        Si tu es propriétaire d’un serveur, supprime-le d’abord. Les groupes que tu as créés sont confiés au membre le plus ancien.
      </T>
      <TextField
        label={`Recopie « ${DELETE_CONFIRM_WORD} »`}
        value={confirmWord}
        onChangeText={setConfirmWord}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <PasswordField
        label="Mot de passe"
        value={password}
        onChangeText={setPassword}
        autoComplete="current-password"
        textContentType="password"
        error={error}
      />
      {formError ? <T style={{ color: colors.danger }}>{formError}</T> : null}
      <Button title="Supprimer mon compte" variant="danger" onPress={submit} loading={loading} />
    </ScrollView>
  )
}
