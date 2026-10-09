import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { useMemo } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { forumApi } from '@/api/forum'
import { Avatar } from '@/components/Avatar'
import { EmptyState, ErrorState, IconButton, Loading } from '@/components/ui'
import { LIMITS } from '@/config/env'
import { isVideoMedia, nextPostsCursor, type ForumPost } from '@/features/forum/forum'
import { TagChips } from '@/features/forum/TagChips'
import { formatRelative } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { resolveMediaUrl } from '@/lib/links'
import { useT } from '@/i18n'
import { useRouteParams } from '@/lib/params'
import { qk } from '@/lib/queryClient'
import { colors, font, radius, spacing } from '@/theme'
import { encryptedMedia, thumbUri } from '@/e2e/files'

/** Salon forum : publications (épinglées d'abord, ordre du salon), comme ForumPage. Salon média (media=1) : grille de vignettes. */
export default function ForumScreen() {
  const t = useT()
  const { valid, ids, text } = useRouteParams(['serverId', 'channelId'] as const, ['name', 'media'])
  const q = useInfiniteQuery({
    queryKey: qk.forum(ids.channelId ?? ''),
    queryFn: ({ pageParam }) => forumApi.posts(ids.serverId, ids.channelId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => nextPostsCursor(last, LIMITS.pageSize),
    enabled: valid,
  })
  const posts = useMemo(() => q.data?.pages.flat() ?? [], [q.data])
  if (!valid) return <ErrorState message={t('conv.invalidChannel')} />
  const name = text.name || t('social.forum.fallback')
  const media = text.media === '1'

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
              label={t('screen.newPost')}
              onPress={() => router.push({ pathname: '/forum/[serverId]/[channelId]/new', params: { serverId: ids.serverId, channelId: ids.channelId, media: media ? '1' : '0' } })}
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
          key={media ? 'grid' : 'list'}
          numColumns={media ? 3 : 1}
          columnWrapperStyle={media ? { gap: spacing.xs } : undefined}
          style={{ backgroundColor: colors.bg }}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, flexGrow: 1 }}
          data={posts}
          keyExtractor={(p) => p.id}
          refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void q.refetch()} tintColor={colors.textMuted} />}
          onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
          onEndReachedThreshold={0.4}
          ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={{ margin: spacing.lg }} /> : null}
          ListEmptyComponent={<EmptyState icon="albums-outline" title={t('social.forum.empty')} subtitle={t('social.forum.emptyHint')} />}
          renderItem={({ item: p }) => media ? (
            <Pressable
              onPress={() => open(p)}
              style={styles.tile}
              accessibilityRole="button"
              accessibilityLabel={t(p.replyCount > 1 ? 'social.forum.postLabelMany' : 'social.forum.postLabel', { title: p.title, name: p.creatorName, n: p.replyCount })}
            >
              {p.mediaUrl && encryptedMedia(p.mediaUrl, p.files) ? (
                // Média chiffré : miniature embarquée dans la publication (déchiffrée), sinon un cadenas.
                thumbUri(p.files?.find((f) => f.u === p.mediaUrl)) ? (
                  <Image source={{ uri: thumbUri(p.files?.find((f) => f.u === p.mediaUrl)) }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <Ionicons name="lock-closed" size={30} color={colors.text} />
                )
              ) : p.mediaUrl && !isVideoMedia(p.mediaUrl) ? (
                <Image source={{ uri: resolveMediaUrl(p.mediaUrl) ?? undefined }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <Ionicons name="play-circle" size={36} color={colors.text} />
              )}
              <Text style={styles.tileCaption} numberOfLines={1}>
                {p.title}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => open(p)}
              style={({ pressed }) => [styles.card, pressed && { backgroundColor: colors.bgHover }]}
              accessibilityRole="button"
              accessibilityLabel={(p.pinned ? t('social.forum.pinnedPrefix') : '') + t(p.replyCount > 1 ? 'social.forum.postLabelMany' : 'social.forum.postLabel', { title: p.title, name: p.creatorName, n: p.replyCount })}
            >
              <View style={styles.head}>
                {p.pinned ? <Ionicons name="pin" size={14} color={colors.warning} /> : null}
                {p.locked ? <Ionicons name="lock-closed" size={14} color={colors.textMuted} /> : null}
                <Text style={styles.title} numberOfLines={2}>
                  {p.title}
                </Text>
              </View>
              <TagChips tags={p.tags} />
              {snippet(p.content) ? (
                <Text style={styles.snippet} numberOfLines={2}>
                  {snippet(p.content)}
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

/** Aperçu de la liste : sans chemins d'images du serveur (affichées dans la publication). */
const snippet = (c: string | null | undefined) => (c ?? '').replace(/\/uploads\/[\w.-]+\.(?:png|jpe?g|gif|webp|mp4|webm|mov|enc)/gi, ' ').replace(/\s+/g, ' ').trim()

const styles = StyleSheet.create({
  card: { backgroundColor: colors.bgAlt, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  title: { flex: 1, color: colors.text, fontSize: font.md, fontWeight: '700' },
  snippet: { color: colors.textSecondary, fontSize: font.sm },
  foot: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  meta: { color: colors.textMuted, fontSize: font.xs, flexShrink: 1 },
  tile: { flex: 1 / 3, aspectRatio: 1, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.bgAlt, alignItems: 'center', justifyContent: 'center' },
  tileCaption: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 4, color: '#fff', fontSize: font.xs, backgroundColor: 'rgba(0,0,0,0.55)' },
})
