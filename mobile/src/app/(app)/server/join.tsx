import { router } from 'expo-router'
import { useState } from 'react'
import { ScrollView } from 'react-native'
import { serversApi } from '@/api/servers'
import { Button, T, TextField } from '@/components/ui'
import { apiHost } from '@/config/env'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { extractInviteCode } from '@/lib/validation'
import { useUi } from '@/stores/ui'
import { colors, spacing } from '@/theme'

export default function JoinServerScreen() {
  const t = useT()
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const code = extractInviteCode(value)
    if (!code) {
      setError(t('server.join.invalid'))
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
      <T variant="muted">{t('server.join.hint', { host: apiHost() })}</T>
      <TextField label={t('server.join.label')} value={value} onChangeText={setValue} autoCapitalize="none" autoCorrect={false} autoFocus error={error} onSubmitEditing={submit} />
      <Button title={t('server.explore.join')} onPress={submit} loading={loading} />
    </ScrollView>
  )
}
