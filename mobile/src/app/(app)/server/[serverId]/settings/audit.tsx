import { useQuery } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { FlatList, RefreshControl } from 'react-native'
import { moderationApi } from '@/api/moderation'
import { EmptyState, ErrorState, Loading, Row } from '@/components/ui'
import { useT, type Key } from '@/i18n'
import { formatShort } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { colors } from '@/theme'

// Mêmes libellés que client/src/components/modals/AuditLogTab.tsx ; action inconnue : son code brut.
const LABELS: Record<string, Key> = {
  MEMBER_JOIN: 'serverSettings.audit.MEMBER_JOIN',
  MEMBER_LEAVE: 'serverSettings.audit.MEMBER_LEAVE',
  MEMBER_KICK: 'serverSettings.audit.MEMBER_KICK',
  MEMBER_BAN: 'serverSettings.audit.MEMBER_BAN',
  MEMBER_UNBAN: 'serverSettings.audit.MEMBER_UNBAN',
  CHANNEL_CREATE: 'serverSettings.audit.CHANNEL_CREATE',
  CHANNEL_DELETE: 'serverSettings.audit.CHANNEL_DELETE',
  ROLE_CREATE: 'serverSettings.audit.ROLE_CREATE',
  ROLE_UPDATE: 'serverSettings.audit.ROLE_UPDATE',
  ROLE_DELETE: 'serverSettings.audit.ROLE_DELETE',
  MESSAGE_DELETE: 'serverSettings.audit.MESSAGE_DELETE',
  MESSAGE_PIN: 'serverSettings.audit.MESSAGE_PIN',
  MESSAGE_UNPIN: 'serverSettings.audit.MESSAGE_UNPIN',
  SERVER_UPDATE: 'serverSettings.audit.SERVER_UPDATE',
  OWNER_TRANSFER: 'serverSettings.audit.OWNER_TRANSFER',
  PURGE_MESSAGES: 'serverSettings.audit.PURGE_MESSAGES',
}

/** Journal d'audit : 100 dernières actions (MANAGE_SERVER). */
export default function AuditScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const sid = ids.serverId ?? ''
  const t = useT()
  const q = useQuery({ queryKey: ['audit', sid], queryFn: () => moderationApi.audit(sid), enabled: valid })
  if (!valid) return <ErrorState message={t('serverSettings.invalidServer')} />
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      data={q.data ?? []}
      keyExtractor={(e) => e.id}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.textMuted} />}
      ListHeaderComponent={<Stack.Screen options={{ title: t('serverSettings.title.audit') }} />}
      ListEmptyComponent={<EmptyState icon="document-text-outline" title={t('serverSettings.audit.empty')} />}
      renderItem={({ item: e }) => {
        const label = LABELS[e.action]
        return (
          <Row
            icon="time-outline"
            title={label ? t(label) : e.action}
            subtitle={[e.username, e.target_name && `→ ${e.target_name}`, formatShort(e.created_at)].filter(Boolean).join(' · ')}
          />
        )
      }}
    />
  )
}
