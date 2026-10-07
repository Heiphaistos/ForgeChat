import { useQuery } from '@tanstack/react-query'
import { Alert, FlatList } from 'react-native'
import { serversApi } from '@/api/servers'
import { Button, EmptyState, ErrorState, Loading, Row } from '@/components/ui'
import { useT } from '@/i18n'
import { formatShort } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import type { Ban } from '@/types/models'
import { colors } from '@/theme'

/** Bannissements : liste et levée (un ban définitif ne se lève qu'avec « Bannir définitivement »). */
export default function BansScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const sid = ids.serverId ?? ''
  const t = useT()
  const bans = useQuery({ queryKey: ['bans', sid], queryFn: () => serversApi.bans(sid), enabled: valid })
  if (!valid) return <ErrorState message={t('serverSettings.invalidServer')} />
  if (bans.isLoading) return <Loading />
  if (bans.error) return <ErrorState message={errorMessage(bans.error)} onRetry={() => void bans.refetch()} />

  const unban = (b: Ban) =>
    Alert.alert(t('serverSettings.bans.unbanTitle', { name: b.username }), t('serverSettings.bans.unbanBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('serverSettings.bans.unban'),
        onPress: () =>
          void serversApi
            .unban(sid, b.user_id)
            .then(() => bans.refetch())
            .catch((e) => Alert.alert(t('common.actionFailed'), errorMessage(e))),
      },
    ])

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      data={bans.data ?? []}
      keyExtractor={(b) => b.user_id}
      ListEmptyComponent={<EmptyState icon="checkmark-circle-outline" title={t('serverSettings.bans.empty')} />}
      renderItem={({ item }) => (
        <Row
          title={item.username}
          subtitle={[item.expires_at ? t('serverSettings.bans.until', { date: formatShort(item.expires_at) }) : t('serverSettings.bans.permanent'), item.reason].filter(Boolean).join(' · ')}
          icon="ban-outline"
          right={<Button title={t('serverSettings.bans.unban')} variant="secondary" onPress={() => unban(item)} />}
        />
      )}
    />
  )
}
