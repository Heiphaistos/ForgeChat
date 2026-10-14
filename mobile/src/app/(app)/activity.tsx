import { useQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { useState } from 'react'
import { RefreshControl, ScrollView, View } from 'react-native'
import { activityApi } from '@/api/activity'
import { Button, EmptyState, ErrorState, Loading, Row } from '@/components/ui'
import { ACTIVITY_ICON, filterActivity, type ActivityFilter, type ActivityItem } from '@/features/social/activityFeed'
import { useT, type Key } from '@/i18n'
import { formatRelative } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { colors, spacing } from '@/theme'

const FILTERS: { key: ActivityFilter; label: Key }[] = [
  { key: 'all', label: 'feed.all' },
  { key: 'friends', label: 'feed.friends' },
  { key: 'servers', label: 'feed.servers' },
]

/** Activité récente : arrivées dans les serveurs communs (dont amis) et messages épinglés, 48 h. */
export default function ActivityFeedScreen() {
  const t = useT()
  const [filter, setFilter] = useState<ActivityFilter>('all')
  const q = useQuery({ queryKey: ['activity-feed'], queryFn: () => activityApi.feed(), refetchInterval: 60_000 })
  const items = filterActivity(q.data ?? [], filter)
  const text = (i: ActivityItem) =>
    i.type === 'message_pin'
      ? t('feed.pin', { user: i.actor, channel: i.channelName ?? '?', server: i.serverName ?? '?' })
      : t(i.type === 'friend_join_server' ? 'feed.friendJoin' : 'feed.join', { user: i.actor, server: i.serverName ?? '?' })
  const open = (i: ActivityItem) => {
    if (i.type === 'message_pin' && i.serverId && i.channelId) router.push({ pathname: '/channel/[serverId]/[channelId]', params: { serverId: i.serverId, channelId: i.channelId, name: i.channelName ?? '' } })
    else router.push({ pathname: '/user/[userId]', params: { userId: i.actorId } })
  }

  let body: React.ReactNode
  if (q.isLoading) body = <Loading />
  else if (q.error) body = <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  else
    body = (
      <ScrollView refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {FILTERS.map((f) => (
            <Button key={f.key} title={t(f.label)} variant={filter === f.key ? 'primary' : 'secondary'} onPress={() => setFilter(f.key)} accessibilityState={{ selected: filter === f.key }} style={{ flex: 1 }} />
          ))}
        </View>
        {items.length ? (
          items.map((i) => <Row key={i.id} icon={ACTIVITY_ICON[i.type]} title={text(i)} subtitle={formatRelative(i.timestamp)} onPress={() => open(i)} chevron />)
        ) : (
          <EmptyState icon="pulse-outline" title={t('feed.empty')} subtitle={t(filter === 'all' ? 'feed.emptyHint' : 'feed.emptyFilter')} />
        )}
      </ScrollView>
    )
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: t('feed.title') }} />
      {body}
    </View>
  )
}
