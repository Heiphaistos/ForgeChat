import { useMutation, useQuery } from '@tanstack/react-query'
import { router, useNavigation } from 'expo-router'
import { useLayoutEffect, useState } from 'react'
import { Alert, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native'
import { friendsApi, type FriendFilter } from '@/api/friends'
import { socialApi, socialKeys } from '@/api/social'
import { RichStatusText } from '@/features/social/RichStatusText'
import { richText } from '@/features/social/rich'
import { upcomingBirthdays } from '@/features/social/birthday'
import { friendSections } from '@/features/social/friendSections'
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
  const activities = usePresence((s) => s.activities)
  const groups = useQuery({ queryKey: socialKeys.groups, queryFn: socialApi.groups })
  const q = useQuery({ queryKey: qk.friends(filter === 'online' ? 'all' : filter), queryFn: () => friendsApi.list(filter === 'online' ? 'all' : filter) })
  // Demandes reçues : toujours en tête de liste (le badge de l'onglet les compte, il faut les voir sans chercher).
  const pending = useQuery({ queryKey: qk.friends('pending'), queryFn: () => friendsApi.list('pending') })
  const received = (pending.data?.friends ?? []).filter((f) => f.direction === 'received')

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

  const organized = filter === 'online' || filter === 'all'
  const sections = [
    ...(organized && received.length ? [{ key: 'received', title: t('friends.receivedSection'), data: received }] : []),
    ...(organized
      ? friendSections(data, groups.data ?? [], { favorites: t('soc.fav.section'), others: t('soc.groups.others') })
      : data.length ? [{ key: 'list', title: null, data }] : []),
  ]

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
              { text: t(f.is_favorite ? 'soc.fav.unpin' : 'soc.fav.pin'), onPress: () => act.mutate(() => socialApi.setFavorite(f.friend_id, !f.is_favorite)) },
              { text: t('soc.groups.manage'), onPress: () => router.push({ pathname: '/friends/groups', params: { userId: f.friend_id, name: f.custom_nickname || f.username } }) },
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
            <Text style={[styles.filterText, filter === f.key && { color: colors.text }]}>
              {t(f.label)}{f.key === 'pending' && received.length ? ` · ${received.length}` : ''}
            </Text>
          </Pressable>
        ))}
      </View>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(f) => f.id}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.textMuted} />}
          ListHeaderComponent={organized ? <FriendsHeader friends={q.data?.friends ?? []} /> : null}
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title={t(filter === 'pending' ? 'friends.noPending' : filter === 'blocked' ? 'friends.noBlocked' : 'friends.empty')}
            />
          }
          renderSectionHeader={({ section }) => (section.title ? <Text style={styles.section}>{section.title} — {section.data.length}</Text> : null)}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => router.push(`/user/${item.friend_id}`)} accessibilityRole="button">
              <Avatar uri={item.avatar} name={item.username} userId={item.friend_id} status={item.user_status} showStatus={item.direction === 'accepted'} size={42} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {upcomingBirthdays([item], 0).length ? '🎂 ' : ''}
                  {item.custom_nickname || item.username}
                </Text>
                {item.direction === 'accepted' && richText(activities[item.friend_id] ?? item, t) ? (
                  <RichStatusText activity={activities[item.friend_id] ?? item} />
                ) : (
                  <Text style={styles.sub} numberOfLines={1}>
                    {item.direction === 'received'
                      ? t('friends.received')
                      : item.direction === 'sent'
                        ? t('friends.sent')
                        : item.custom_status || `${item.username}#${item.discriminator}`}
                  </Text>
                )}
              </View>
              {renderActions(item)}
            </Pressable>
          )}
        />
      )}
    </View>
  )
}

/** Anniversaires des 7 prochains jours et accès aux groupes. */
function FriendsHeader({ friends }: { friends: Friend[] }) {
  const t = useT()
  const soon = upcomingBirthdays(friends.filter((f) => f.direction === 'accepted'), 7)
  return (
    <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm, marginBottom: spacing.sm }}>
      <Pressable onPress={() => router.push('/friends/groups')} accessibilityRole="button" style={styles.groupsBtn}>
        <Text style={styles.filterText}>👥 {t('soc.groups.title')}</Text>
      </Pressable>
      {soon.length ? (
        <View style={styles.bdays}>
          <Text style={styles.sub}>🎂 {t('soc.bday.upcoming')}</Text>
          {soon.map(({ friend, days }) => (
            <Text key={friend.friend_id} style={styles.name} numberOfLines={1}>
              {friend.custom_nickname || friend.username} — {days === 0 ? t('soc.bday.today') : `${friend.birthday!.day}/${friend.birthday!.month}`}
            </Text>
          ))}
        </View>
      ) : null}
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
  section: { color: colors.textMuted, fontSize: font.xs, fontWeight: '700', textTransform: 'uppercase', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 4 },
  groupsBtn: { alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full, backgroundColor: colors.bgAlt },
  bdays: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bgAlt, gap: 2 },
})
