import { useInfiniteQuery } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { useMemo } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'
import { forumApi } from '@/api/forum'
import { Avatar } from '@/components/Avatar'
import { MessageText } from '@/components/MessageText'
import { ErrorState } from '@/components/ui'
import { LIMITS } from '@/config/env'
import { ReplyThreadView } from '@/features/chat/ReplyThreadView'
import { olderCursor } from '@/features/chat/threads'
import { TagChips } from '@/features/forum/TagChips'
import { formatShort } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import { useAuth } from '@/stores/auth'
import { colors, font, spacing } from '@/theme'

/** Publication de forum et ses réponses (comme PostView). */
export default function PostScreen() {
  const { valid, ids, text } = useRouteParams(['serverId', 'channelId', 'postId'] as const, ['title'])
  const myName = useAuth((s) => s.user?.username ?? '')
  const key = qk.forumPost(ids.postId ?? '')
  const q = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => forumApi.post(ids.serverId, ids.channelId, ids.postId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => olderCursor(last.replies, LIMITS.pageSize),
    enabled: valid,
  })
  const replies = useMemo(() => (q.data?.pages ?? []).flatMap((p) => [...p.replies].reverse()), [q.data])
  if (!valid) return <ErrorState message="Publication invalide." />
  const post = q.data?.pages[0]?.post
  const refresh = () => queryClient.invalidateQueries({ queryKey: key })

  return (
    <>
      <Stack.Screen options={{ title: post?.title ?? text.title ?? 'Publication' }} />
      <ReplyThreadView
        messages={replies}
        isLoading={q.isLoading}
        error={q.error ?? (q.isSuccess && !post ? new Error('Publication introuvable') : null)}
        onRetry={() => void q.refetch()}
        hasOlder={!!q.hasNextPage}
        loadingOlder={q.isFetchingNextPage}
        onLoadOlder={() => void q.fetchNextPage()}
        onReact={(m, emoji) =>
          void forumApi
            .react(ids.serverId, ids.channelId, ids.postId, m.id, emoji)
            .then(refresh)
            .catch((e) => Alert.alert('Réaction impossible', errorMessage(e)))
        }
        onSend={(t) =>
          forumApi.reply(ids.serverId, ids.channelId, ids.postId, t).then(() => {
            void refresh()
            void queryClient.invalidateQueries({ queryKey: qk.forum(ids.channelId) })
          })
        }
        disabledReason={post?.locked ? 'Cette publication est verrouillée.' : null}
        placeholder="Répondre à la publication"
        header={
          post ? (
            <View style={styles.post}>
              <Text style={styles.title} accessibilityRole="header">
                {post.title}
              </Text>
              <TagChips tags={post.tags} />
              <View style={styles.author}>
                <Avatar uri={post.creatorAvatar} name={post.creatorName} size={24} />
                <Text style={styles.meta}>
                  {post.creatorName} · {formatShort(post.lastActivity)}
                </Text>
              </View>
              {post.content ? <MessageText content={post.content} myName={myName} /> : null}
              <Text style={styles.meta}>
                {post.replyCount} réponse{post.replyCount > 1 ? 's' : ''}
              </Text>
            </View>
          ) : undefined
        }
      />
    </>
  )
}

const styles = StyleSheet.create({
  post: { padding: spacing.lg, gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  title: { color: colors.text, fontSize: font.xl, fontWeight: '800' },
  author: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  meta: { color: colors.textMuted, fontSize: font.xs },
})
