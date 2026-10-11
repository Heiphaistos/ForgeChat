import { useQuery } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { useEffect, useState } from 'react'
import { FlatList, RefreshControl, Share, View } from 'react-native'
import { moderationApi } from '@/api/moderation'
import { Button, EmptyState, ErrorState, Loading, Row, TextField } from '@/components/ui'
import { toCsv } from '@/features/community/format'
import { useT, type Key } from '@/i18n'
import { formatShort } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { colors, spacing } from '@/theme'

// Mêmes libellés que client/src/components/modals/AuditLogTab.tsx ; action inconnue : son code brut.
const LABELS: Record<string, Key> = {
  MEMBER_JOIN: 'serverSettings.audit.MEMBER_JOIN',
  MEMBER_LEAVE: 'serverSettings.audit.MEMBER_LEAVE',
  MEMBER_KICK: 'serverSettings.audit.MEMBER_KICK',
  MEMBER_BAN: 'serverSettings.audit.MEMBER_BAN',
  MEMBER_UNBAN: 'serverSettings.audit.MEMBER_UNBAN',
  MEMBER_NICKNAME_CHANGE: 'serverSettings.audit.MEMBER_NICKNAME_CHANGE',
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
  LOCKDOWN_ON: 'community.audit.LOCKDOWN_ON',
  LOCKDOWN_OFF: 'community.audit.LOCKDOWN_OFF',
  TICKET_OPEN: 'community.audit.TICKET_OPEN',
  TICKET_STATUS: 'community.audit.TICKET_STATUS',
}

/** Journal d'audit (MANAGE_SERVER) : recherche (auteur, cible, action), export CSV par la feuille de partage. */
export default function AuditScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const sid = ids.serverId ?? ''
  const t = useT()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(id)
  }, [search])
  const q = useQuery({ queryKey: ['audit', sid, debounced], queryFn: () => moderationApi.audit(sid, { q: debounced || undefined, limit: 200 }), enabled: valid })
  const exportCsv = () =>
    void Share.share({ title: 'audit.csv', message: toCsv((q.data ?? []) as unknown as Record<string, unknown>[], ['created_at', 'action', 'username', 'user_id', 'target_name', 'details']) })
  if (!valid) return <ErrorState message={t('serverSettings.invalidServer')} />
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      data={q.data ?? []}
      keyExtractor={(e) => e.id}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.textMuted} />}
      ListHeaderComponent={
        <View style={{ padding: spacing.md, gap: spacing.sm }}>
          <Stack.Screen options={{ title: t('serverSettings.title.audit') }} />
          <TextField value={search} onChangeText={setSearch} placeholder={t('community.audit.search')} accessibilityLabel={t('community.audit.search')} autoCapitalize="none" maxLength={100} />
          <Button title={t('community.audit.export')} icon="share-outline" variant="secondary" onPress={exportCsv} disabled={!q.data?.length} />
        </View>
      }
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
