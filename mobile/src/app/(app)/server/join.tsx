import { router } from 'expo-router'
import { useState } from 'react'
import { ScrollView } from 'react-native'
import { serversApi } from '@/api/servers'
import { Button, T, TextField } from '@/components/ui'
import { API_HOST } from '@/config/env'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { extractInviteCode } from '@/lib/validation'
import { useUi } from '@/stores/ui'
import { colors, spacing } from '@/theme'

export default function JoinServerScreen() {
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const code = extractInviteCode(value)
    if (!code) {
      setError('Code ou lien d’invitation invalide.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const server = await serversApi.join(code)
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
      <T variant="muted">Colle un code d’invitation ou un lien du type https://{API_HOST}/invite/abc123</T>
      <TextField label="Invitation" value={value} onChangeText={setValue} autoCapitalize="none" autoCorrect={false} autoFocus error={error} onSubmitEditing={submit} />
      <Button title="Rejoindre" onPress={submit} loading={loading} />
    </ScrollView>
  )
}
