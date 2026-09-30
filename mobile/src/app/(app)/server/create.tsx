import { router } from 'expo-router'
import { useState } from 'react'
import { ScrollView } from 'react-native'
import { serversApi } from '@/api/servers'
import { Button, T, TextField } from '@/components/ui'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { useUi } from '@/stores/ui'
import { colors, spacing } from '@/theme'

export default function CreateServerScreen() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const n = name.trim()
    if (n.length < 2 || n.length > 100) {
      setError('Le nom doit faire entre 2 et 100 caractères.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const server = await serversApi.create(n, description)
      await queryClient.invalidateQueries({ queryKey: qk.servers })
      useUi.getState().selectServer(server.id)
      router.dismissTo('/')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <T variant="muted">Ton serveur, c’est l’endroit où tu retrouves tes amis. Crée-le puis invite-les.</T>
      <TextField label="Nom du serveur" value={name} onChangeText={setName} maxLength={100} autoFocus error={error} />
      <TextField label="Description (optionnel)" value={description} onChangeText={setDescription} maxLength={500} multiline />
      <Button title="Créer" onPress={submit} loading={loading} />
    </ScrollView>
  )
}
