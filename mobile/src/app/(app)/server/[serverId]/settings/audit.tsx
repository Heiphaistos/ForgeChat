import { useQuery } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { FlatList, RefreshControl } from 'react-native'
import { moderationApi } from '@/api/moderation'
import { EmptyState, ErrorState, Loading, Row } from '@/components/ui'
import { formatShort } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { colors } from '@/theme'

// Mêmes libellés que client/src/components/modals/AuditLogTab.tsx ; action inconnue : son code brut.
const LABELS: Record<string, string> = {
  MEMBER_JOIN: 'Membre rejoint',
  MEMBER_LEAVE: 'Membre parti',
  MEMBER_KICK: 'Membre expulsé',
  MEMBER_BAN: 'Membre banni',
  MEMBER_UNBAN: 'Membre débanni',
  CHANNEL_CREATE: 'Salon créé',
  CHANNEL_DELETE: 'Salon supprimé',
  ROLE_CREATE: 'Rôle créé',
  ROLE_UPDATE: 'Rôle modifié',
  ROLE_DELETE: 'Rôle supprimé',
  MESSAGE_DELETE: 'Message supprimé',
  MESSAGE_PIN: 'Message épinglé',
  MESSAGE_UNPIN: 'Message désépinglé',
  SERVER_UPDATE: 'Serveur modifié',
  OWNER_TRANSFER: 'Propriété transférée',
  PURGE_MESSAGES: 'Messages purgés',
}

/** Journal d'audit : 100 dernières actions (MANAGE_SERVER). */
export default function AuditScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const sid = ids.serverId ?? ''
  const q = useQuery({ queryKey: ['audit', sid], queryFn: () => moderationApi.audit(sid), enabled: valid })
  if (!valid) return <ErrorState message="Serveur invalide." />
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      data={q.data ?? []}
      keyExtractor={(e) => e.id}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.textMuted} />}
      ListHeaderComponent={<Stack.Screen options={{ title: "Journal d'audit" }} />}
      ListEmptyComponent={<EmptyState icon="document-text-outline" title="Aucune action enregistrée" />}
      renderItem={({ item: e }) => (
        <Row
          icon="time-outline"
          title={LABELS[e.action] ?? e.action}
          subtitle={[e.username, e.target_name && `→ ${e.target_name}`, formatShort(e.created_at)].filter(Boolean).join(' · ')}
        />
      )}
    />
  )
}
