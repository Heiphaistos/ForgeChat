import { Ionicons } from '@expo/vector-icons'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { useMemo } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { forumApi } from '@/api/forum'
import { Avatar } from '@/components/Avatar'
import { EmptyState, ErrorState, IconButton, Loading } from '@/components/ui'
import { LIMITS } from '@/config/env'
import { nextPostsCursor, type ForumPost } from '@/features/forum/forum'
import { TagChips } from '@/features/forum/TagChips'
import { formatRelative } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk } from '@/lib/queryClient'
import { colors, font, radius, spacing } from '@/theme'

/** Salon forum : publications (épinglées d'abord, ordre du salon), comme ForumPage. */
export default function ForumScreen() {
  const { valid, ids, text } = useRouteParams(['serverId', 'channelId'] as const, ['name'])
  const q = useInfiniteQuery({
    queryKey: qk.forum(ids.channelId ?? ''),
    queryFn: ({ pageParam }) => forumApi.posts(ids.serverId, ids.channelId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => nextPostsCursor(last, LIMITS.pageSize),
    enabled: valid,
  })
  const posts = useMemo(() => q.data?.pages.flat() ?? [], [q.data])
  if (!valid) return <ErrorState message="Lien de salon invalide." />
  const name = text.name || 'forum'

  const open = (p: ForumPost) =>
    router.push({ pathname: '/forum/[serverId]/[channelId]/[postId]', params: { serverId: ids.serverId, channelId: ids.channelId, postId: p.id, title: p.title } })

  return (
    <>
      <Stack.Screen
        options={{
          title: `# ${name}`,
          headerRight: () => (
            <IconButton
              icon="add"
              label="Nouvelle publication"
              onPress={() => router.push({ pathname: '/forum/[serverId]/[channelId]/new', params: { serverId: ids.serverId, channelId: ids.channelId } })}
            />
          ),
        }}
      />
      {q.isLoading ? (
        <Loading />
      ) : q.error && !posts.length ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          style={{ backgroundColor: colors.bg }}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, flexGrow: 1 }}
          data={posts}
          keyExtractor={(p) => p.id}
          refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void q.refetch()} tintColor={colors.textMuted} />}
          onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
          onEndReachedThreshold={0.4}
          ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={{ margin: spacing.lg }} /> : null}
          ListEmptyComponent={<EmptyState icon="albums-outline" title="Aucune publication" subtitle="Touche + pour lancer la discussion." />}
          renderItem={({ item: p }) => (
            <Pressable
              onPress={() => open(p)}
              style={({ pressed }) => [styles.card, pressed && { backgroundColor: colors.bgHover }]}
              accessibilityRole="button"
              accessibilityLabel={`${p.pinned ? 'Épinglée, ' : ''}${p.title}, par ${p.creatorName}, ${p.replyCount} réponse${p.replyCount > 1 ? 's' : ''}`}
            >
              <View style={styles.head}>
                {p.pinned ? <Ionicons name="pin" size={14} color={colors.warning} /> : null}
                {p.locked ? <Ionicons name="lock-closed" size={14} color={colors.textMuted} /> : null}
                <Text style={styles.title} numberOfLines={2}>
                  {p.title}
                </Text>
              </View>
              <TagChips tags={p.tags} />
              {p.content ? (
                <Text style={styles.snippet} numberOfLines={2}>
                  {p.content}
                </Text>
              ) : null}
              <View style={styles.foot}>
                <Avatar uri={p.creatorAvatar} name={p.creatorName} size={18} />
                <Text style={styles.meta} numberOfLines={1}>
                  {p.creatorName} · {formatRelative(p.lastActivity)}
                </Text>
                <Ionicons name="chatbubble-outline" size={13} color={colors.textMuted} />
                <Text style={styles.meta}>{p.replyCount}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.bgAlt, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  title: { flex: 1, color: colors.text, fontSize: font.md, fontWeight: '700' },
  snippet: { color: colors.textSecondary, fontSize: font.sm },
  foot: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  meta: { color: colors.textMuted, fontSize: font.xs, flexShrink: 1 },
})
