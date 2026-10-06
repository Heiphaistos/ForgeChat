import { router } from 'expo-router'
import { useState } from 'react'
import { ScrollView } from 'react-native'
import { authApi } from '@/api/auth'
import { Button, PasswordField, T } from '@/components/ui'
import { errorMessage } from '@/lib/http'
import { passwordStrength } from '@/lib/validation'
import { useAuth } from '@/stores/auth'
import { colors, spacing } from '@/theme'

export default function PasswordScreen() {
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (newPw.length < 8 || newPw.length > 128) return setError('Le nouveau mot de passe doit faire 8 à 128 caractères.')
    if (passwordStrength(newPw).score < 2) return setError('Mot de passe trop faible.')
    if (newPw !== confirm) return setError('Les mots de passe ne correspondent pas.')
    if (newPw === oldPw) return setError('Le nouveau mot de passe doit être différent.')
    setLoading(true)
    setError(null)
    try {
      await authApi.changePassword(oldPw, newPw)
      // Le serveur a déjà révoqué toutes les sessions (et ce jeton) : fin de session locale.
      router.dismissAll()
      await useAuth.getState().signOutLocally('Mot de passe modifié. Reconnecte-toi avec ton nouveau mot de passe.')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <T variant="muted">Après le changement, tous tes appareils seront déconnectés.</T>
      <PasswordField label="Mot de passe actuel" value={oldPw} onChangeText={setOldPw} autoComplete="current-password" textContentType="password" />
      <PasswordField label="Nouveau mot de passe" value={newPw} onChangeText={setNewPw} autoComplete="new-password" textContentType="newPassword" maxLength={128} />
      <PasswordField label="Confirmer" value={confirm} onChangeText={setConfirm} autoComplete="new-password" textContentType="newPassword" error={error} />
      <Button title="Changer le mot de passe" onPress={submit} loading={loading} />
    </ScrollView>
  )
}
