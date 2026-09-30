import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView } from 'react-native'
import { friendsApi } from '@/api/friends'
import { Button, T, TextField } from '@/components/ui'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { colors, spacing } from '@/theme'

export default function AddFriendScreen() {
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const n = name.trim()
    if (!/^[\p{L}\p{N}_-]{2,32}(#\d{4})?$/u.test(n)) {
      setError('Format attendu : pseudo ou pseudo#1234')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await friendsApi.addByName(n, message)
      void queryClient.invalidateQueries({ queryKey: qk.friendsAll })
      Alert.alert('Demande envoyée', `Ta demande a été envoyée à ${n}.`)
      router.back()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <T variant="muted">Tu peux ajouter un ami avec son pseudo ForgeChat (et son tag si besoin).</T>
      <TextField label="Pseudo" placeholder="pseudo#1234" value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false} autoFocus error={error} />
      <TextField label="Message (optionnel)" value={message} onChangeText={setMessage} maxLength={200} />
      <Button title="Envoyer la demande" onPress={submit} loading={loading} />
    </ScrollView>
  )
}
