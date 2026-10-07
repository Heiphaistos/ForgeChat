import { useMutation, useQuery } from '@tanstack/react-query'
import { router, useNavigation } from 'expo-router'
import { useLayoutEffect, useState } from 'react'
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { friendsApi, type FriendFilter } from '@/api/friends'
import { Avatar } from '@/components/Avatar'
import { EmptyState, ErrorState, IconButton, Loading } from '@/components/ui'
import { openDmWith } from '@/features/friends/openDm'
import { useT, type Key } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { usePresence } from '@/stores/presence'
import type { Friend } from '@/types/models'
import { colors, font, radius, spacing } from '@/theme'

const FILTERS: { key: FriendFilter; label: Key }[] = [
  { key: 'online', label: 'friends.online' },
  { key: 'all', label: 'friends.all' },
  { key: 'pending', label: 'friends.pending' },
  { key: 'blocked', label: 'friends.blocked' },
]

export default function FriendsScreen() {
  const t = useT()
  const navigation = useNavigation()
  const [filter, setFilter] = useState<FriendFilter>('online')
  const statuses = usePresence((s) => s.statuses)
  const q = useQuery({ queryKey: qk.friends(filter === 'online' ? 'all' : filter), queryFn: () => friendsApi.list(filter === 'online' ? 'all' : filter) })

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row' }}>
          <IconButton icon="call-outline" label={t('friends.callHistory')} onPress={() => router.push('/friends/calls')} />
          <IconButton icon="person-add" label={t('friends.add')} color={colors.success} onPress={() => router.push('/friends/add')} />
        </View>
      ),
    })
  }, [navigation, t])

  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.friendsAll }),
    onError: (e) => Alert.alert(t('common.actionFailed'), errorMessage(e)),
  })

  const confirm = (title: string, message: string, onOk: () => Promise<unknown>) =>
    Alert.alert(title, message, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.confirm'), style: 'destructive', onPress: () => act.mutate(onOk) },
    ])

  let data = q.data?.friends ?? []
  if (filter === 'online') {
    data = data.filter((f) => {
      const st = statuses[f.friend_id] ?? f.user_status
      return st !== 'offline' && st !== 'invisible'
    })
  }

  const renderActions = (f: Friend) => {
    if (f.direction === 'received')
      return (
        <>
          <IconButton icon="checkmark" label={t('friends.accept')} color={colors.success} onPress={() => act.mutate(() => friendsApi.accept(f.id))} />
          <IconButton icon="close" label={t('friends.decline')} color={colors.danger} onPress={() => act.mutate(() => friendsApi.decline(f.id))} />
        </>
      )
    if (f.direction === 'sent')
      return <IconButton icon="close" label={t('friends.cancelRequest')} onPress={() => act.mutate(() => friendsApi.cancel(f.id))} />
    if (f.direction === 'blocked')
      return <IconButton icon="lock-open-outline" label={t('friends.unblock')} onPress={() => act.mutate(() => friendsApi.unblock(f.friend_id))} />
    return (
      <>
        <IconButton icon="chatbubble" label={t('friends.messageTo', { name: f.username })} onPress={() => void openDmWith(f.friend_id, f.username)} />
        <IconButton
          icon="ellipsis-vertical"
          label={t('friends.more')}
          onPress={() =>
            Alert.alert(f.username, undefined, [
              { text: t('friends.viewProfile'), onPress: () => router.push(`/user/${f.friend_id}`) },
              { text: t('friends.remove'), style: 'destructive', onPress: () => confirm(t('friends.removeConfirm'), f.username, () => friendsApi.remove(f.friend_id)) },
              {
                text: t('friends.block'),
                style: 'destructive',
                onPress: () => confirm(t('friends.blockConfirm'), t('friends.blockBody', { name: f.username }), () => friendsApi.block(f.friend_id)),
              },
              { text: t('common.cancel'), style: 'cancel' },
            ])
          }
        />
      </>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.filters} accessibilityRole="tablist">
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => setFilter(f.key)}
            style={[styles.filter, filter === f.key && styles.filterActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: filter === f.key }}
          >
            <Text style={[styles.filterText, filter === f.key && { color: colors.text }]}>{t(f.label)}</Text>
          </Pressable>
        ))}
      </View>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(f) => f.id}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.textMuted} />}
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title={t(filter === 'pending' ? 'friends.noPending' : filter === 'blocked' ? 'friends.noBlocked' : 'friends.empty')}
            />
          }
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => router.push(`/user/${item.friend_id}`)} accessibilityRole="button">
              <Avatar uri={item.avatar} name={item.username} userId={item.friend_id} status={item.user_status} showStatus={item.direction === 'accepted'} size={42} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.custom_nickname || item.username}
                </Text>
                <Text style={styles.sub} numberOfLines={1}>
                  {item.direction === 'received'
                    ? t('friends.received')
                    : item.direction === 'sent'
                      ? t('friends.sent')
                      : item.custom_status || `${item.username}#${item.discriminator}`}
                </Text>
              </View>
              {renderActions(item)}
            </Pressable>
          )}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  filter: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full, backgroundColor: colors.bgAlt },
  filterActive: { backgroundColor: colors.bgHover },
  filterText: { color: colors.textMuted, fontWeight: '600', fontSize: font.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  name: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  sub: { color: colors.textMuted, fontSize: font.sm },
})
