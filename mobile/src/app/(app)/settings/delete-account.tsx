import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView } from 'react-native'
import { usersApi } from '@/api/users'
import { Button, T, TextField } from '@/components/ui'
import { DELETE_CONFIRM_WORD, deleteAccountError } from '@/features/account/deleteAccount'
import { errorMessage } from '@/lib/http'
import { useAuth } from '@/stores/auth'
import { colors, spacing } from '@/theme'

export default function DeleteAccountScreen() {
  const [password, setPassword] = useState('')
  const [confirmWord, setConfirmWord] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const doDelete = async () => {
    setLoading(true)
    setError(null)
    try {
      await usersApi.deleteAccount(password)
      // Compte supprimé côté serveur (sessions et appareils push compris, en cascade) :
      // fin de session locale complète (jetons, cache, token push, notifications).
      router.dismissAll()
      await useAuth.getState().signOutLocally('Ton compte a été supprimé.')
    } catch (e) {
      // Mot de passe incorrect, serveur possédé, trop d'essais… : message du serveur.
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const submit = () => {
    const invalid = deleteAccountError(password, confirmWord)
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
      <TextField
        label="Mot de passe"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        error={error}
      />
      <Button title="Supprimer mon compte" variant="danger" onPress={submit} loading={loading} />
    </ScrollView>
  )
}
