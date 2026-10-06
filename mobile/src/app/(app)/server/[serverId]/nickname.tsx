import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { ScrollView } from 'react-native'
import { serversApi } from '@/api/servers'
import { Button, ErrorState, Loading, T, TextField } from '@/components/ui'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import { useAuth } from '@/stores/auth'
import { colors, spacing } from '@/theme'

/** Profil de serveur : pseudo affiché sur ce serveur seulement (PATCH /servers/:id/nickname, 32 caractères). */
export default function NicknameScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const me = useAuth((s) => s.user)
  const members = useQuery({ queryKey: qk.members(ids.serverId ?? ''), queryFn: () => serversApi.members(ids.serverId), enabled: valid })
  if (!valid) return <ErrorState message="Serveur invalide." />
  if (members.isLoading) return <Loading />
  const current = members.data?.find((m) => m.user_id === me?.id)?.nickname ?? ''
  return <NicknameForm serverId={ids.serverId} username={me?.username ?? ''} current={current} />
}

function NicknameForm({ serverId, username, current }: { serverId: string; username: string; current: string }) {
  const [nick, setNick] = useState(current)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (value: string | null) => {
    setLoading(true)
    setError(null)
    try {
      await serversApi.setNickname(serverId, value)
      await queryClient.invalidateQueries({ queryKey: qk.members(serverId) })
      router.back()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <T variant="muted">Ton pseudo sur ce serveur uniquement. Vide : ton nom d’utilisateur ({username}).</T>
      <TextField label="Pseudo du serveur" value={nick} onChangeText={setNick} maxLength={32} placeholder={username} autoCorrect={false} error={error} />
      <Button title="Enregistrer" onPress={() => void save(nick.trim() || null)} loading={loading} />
      {current ? <Button title="Retirer le pseudo" variant="ghost" onPress={() => void save(null)} disabled={loading} /> : null}
    </ScrollView>
  )
}
