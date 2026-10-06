import { useQuery } from '@tanstack/react-query'
import { Alert, FlatList } from 'react-native'
import { serversApi } from '@/api/servers'
import { Button, EmptyState, ErrorState, Loading, Row } from '@/components/ui'
import { formatShort } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import type { Ban } from '@/types/models'
import { colors } from '@/theme'

/** Bannissements : liste et levée (un ban définitif ne se lève qu'avec « Bannir définitivement »). */
export default function BansScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const sid = ids.serverId ?? ''
  const bans = useQuery({ queryKey: ['bans', sid], queryFn: () => serversApi.bans(sid), enabled: valid })
  if (!valid) return <ErrorState message="Serveur invalide." />
  if (bans.isLoading) return <Loading />
  if (bans.error) return <ErrorState message={errorMessage(bans.error)} onRetry={() => void bans.refetch()} />

  const unban = (b: Ban) =>
    Alert.alert(`Débannir ${b.username} ?`, 'Il pourra revenir avec une invitation.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Débannir',
        onPress: () =>
          void serversApi
            .unban(sid, b.user_id)
            .then(() => bans.refetch())
            .catch((e) => Alert.alert('Action impossible', errorMessage(e))),
      },
    ])

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      data={bans.data ?? []}
      keyExtractor={(b) => b.user_id}
      ListEmptyComponent={<EmptyState icon="checkmark-circle-outline" title="Aucun bannissement" />}
      renderItem={({ item }) => (
        <Row
          title={item.username}
          subtitle={[item.expires_at ? `Jusqu’au ${formatShort(item.expires_at)}` : 'Définitif', item.reason].filter(Boolean).join(' · ')}
          icon="ban-outline"
          right={<Button title="Débannir" variant="secondary" onPress={() => unban(item)} />}
        />
      )}
    />
  )
}
