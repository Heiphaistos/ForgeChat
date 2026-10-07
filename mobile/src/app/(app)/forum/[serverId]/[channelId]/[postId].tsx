import { useInfiniteQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { router, Stack } from 'expo-router'
import { useMemo, useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'
import { forumApi } from '@/api/forum'
import { e2eErrorText } from '@/e2e/conversations'
import { Avatar } from '@/components/Avatar'
import { MessageText } from '@/components/MessageText'
import { Sheet, type SheetAction } from '@/components/Sheet'
import { Button, ErrorState, IconButton, TextField } from '@/components/ui'
import { LIMITS } from '@/config/env'
import { ReplyThreadView } from '@/features/chat/ReplyThreadView'
import { olderCursor, sendWithAttachments } from '@/features/chat/threads'
import { FormSheet } from '@/features/composer/ChannelExtras'
import { PERM } from '@/features/servers/perms'
import { useServerPerms } from '@/features/servers/menus'
import { TagChips } from '@/features/forum/TagChips'
import { isVideoMedia } from '@/features/forum/forum'
import { VideoAttachment } from '@/features/chat/MediaPlayers'
import { resolveMediaUrl } from '@/lib/links'
import { formatShort } from '@/lib/format'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import { useAuth } from '@/stores/auth'
import { colors, font, spacing } from '@/theme'

/** Publication de forum et ses réponses (comme PostView). */
export default function PostScreen() {
  const t = useT()
  const { valid, ids, text } = useRouteParams(['serverId', 'channelId', 'postId'] as const, ['title'])
  const myName = useAuth((s) => s.user?.username ?? '')
  const meId = useAuth((s) => s.user?.id)
  const canModerate = useServerPerms(ids.serverId ?? '', valid).has(PERM.MANAGE_MESSAGES)
  const [menu, setMenu] = useState(false)
  const [editText, setEditText] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const key = qk.forumPost(ids.postId ?? '')
  const q = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => forumApi.post(ids.serverId, ids.channelId, ids.postId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => olderCursor(last.replies, LIMITS.pageSize),
    enabled: valid,
  })
  const replies = useMemo(() => (q.data?.pages ?? []).flatMap((p) => [...p.replies].reverse()), [q.data])
  if (!valid) return <ErrorState message={t('social.post.invalid')} />
  const post = q.data?.pages[0]?.post
  const refresh = () => queryClient.invalidateQueries({ queryKey: key })
  const refreshList = () => queryClient.invalidateQueries({ queryKey: qk.forum(ids.channelId) })
  const fail = (e: unknown) => Alert.alert(t('common.actionFailed'), errorMessage(e))
  const patchPost = (patch: { pinned?: boolean; locked?: boolean }) =>
    forumApi.updatePost(ids.serverId, ids.channelId, ids.postId, patch).then(() => Promise.all([refresh(), refreshList()]))

  // update_post / delete_post : texte = créateur ; épingler, verrouiller = MANAGE_MESSAGES ; supprimer = les deux.
  const mine = !!post?.creatorId && post.creatorId === meId
  const menuActions: SheetAction[] = []
  // Publication chiffrée illisible (clé en attente) : rien à modifier.
  if (post && mine && post.e2e !== 'locked') menuActions.push({ label: t('social.post.editText'), icon: 'create-outline', onPress: () => setEditText(post.content ?? '') })
  if (post && canModerate) {
    menuActions.push({ label: post.pinned ? t('chat.unpin') : t('chat.pin'), icon: 'pin-outline', onPress: () => void patchPost({ pinned: !post.pinned }).catch(fail) })
    menuActions.push({
      label: post.locked ? t('social.post.unlock') : t('social.post.lock'),
      icon: post.locked ? 'lock-open-outline' : 'lock-closed-outline',
      onPress: () => void patchPost({ locked: !post.locked }).catch(fail),
    })
  }
  if (post && (mine || canModerate))
    menuActions.push({
      label: t('social.post.delete'),
      icon: 'trash-outline',
      danger: true,
      onPress: () =>
        Alert.alert(t('social.post.deleteConfirm'), t('social.post.deleteBody'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: () =>
              forumApi
                .deletePost(ids.serverId, ids.channelId, ids.postId)
                .then(() => {
                  void refreshList()
                  router.back()
                })
                .catch(fail),
          },
        ]),
    })

  const saveText = () => {
    if (editText === null || !post) return
    setSaving(true)
    forumApi
      .editPost(ids.serverId, ids.channelId, post, editText.trim())
      .then(() => Promise.all([refresh(), refreshList()]))
      .then(() => setEditText(null))
      .catch((e) => Alert.alert(t('common.actionFailed'), e2eErrorText(e) ?? errorMessage(e)))
      .finally(() => setSaving(false))
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: post?.title ?? text.title ?? t('screen.post'),
          headerRight: menuActions.length ? () => <IconButton icon="ellipsis-vertical" label={t('social.post.manage')} onPress={() => setMenu(true)} /> : undefined,
        }}
      />
      <Sheet visible={menu} onClose={() => setMenu(false)} title={post?.title} actions={menuActions} />
      <FormSheet visible={editText !== null} onClose={() => setEditText(null)} title={t('social.post.editTitle')}>
        <TextField
          label={t('social.post.text')}
          value={editText ?? ''}
          onChangeText={setEditText}
          multiline
          maxLength={LIMITS.messageMaxChars}
          style={{ minHeight: 120, textAlignVertical: 'top' }}
        />
        <Button title={t('composer.save')} icon="checkmark" loading={saving} onPress={saveText} />
      </FormSheet>
      <ReplyThreadView
        messages={replies}
        isLoading={q.isLoading}
        error={q.error ?? (q.isSuccess && !post ? new Error(t('social.post.notFound')) : null)}
        onRetry={() => void q.refetch()}
        hasOlder={!!q.hasNextPage}
        loadingOlder={q.isFetchingNextPage}
        onLoadOlder={() => void q.fetchNextPage()}
        onReact={(m, emoji) =>
          void forumApi
            .react(ids.serverId, ids.channelId, ids.postId, m.id, emoji)
            .then(refresh)
            .catch((e) => Alert.alert(t('chat.reactFailed'), errorMessage(e)))
        }
        onSend={(body, files) =>
          sendWithAttachments(
            body,
            files,
            (has) => (post ? forumApi.reply(ids.serverId, ids.channelId, post, body, has) : Promise.resolve(null)),
            (id, f) => forumApi.uploadReply(ids.serverId, ids.channelId, ids.postId, id, f),
            (id) => forumApi.deleteReply(ids.serverId, ids.channelId, ids.postId, id),
          ).finally(() => {
            void refresh()
            void refreshList()
          })
        }
        onEdit={(m, body) => (post ? forumApi.editReply(ids.serverId, ids.channelId, post, m, body).then(refresh) : Promise.resolve())}
        onDelete={(m) => forumApi.deleteReply(ids.serverId, ids.channelId, ids.postId, m.id).then(() => Promise.all([refresh(), refreshList()]))}
        canModerate={canModerate}
        disabledReason={post?.locked ? t('social.post.locked') : null}
        placeholder={t('social.post.replyPlaceholder')}
        header={
          post ? (
            <View style={styles.post}>
              {post.mediaUrl ? <PostMedia url={post.mediaUrl} /> : null}
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
                {t(post.replyCount > 1 ? 'social.post.repliesMany' : 'social.post.replies', { n: post.replyCount })}
              </Text>
            </View>
          ) : undefined
        }
      />
    </>
  )
}

/** Média d'une publication de salon média, en grand (vidéo : plein écran natif du lecteur). */
function PostMedia({ url }: { url: string }) {
  const t = useT()
  const src = resolveMediaUrl(url)
  if (!src) return null
  return isVideoMedia(url) ? (
    <VideoAttachment src={src} label={t('social.post.video')} />
  ) : (
    <Image source={{ uri: src }} style={styles.media} contentFit="contain" accessibilityLabel={t('social.post.image')} />
  )
}

const styles = StyleSheet.create({
  media: { width: '100%', aspectRatio: 1, backgroundColor: '#000', borderRadius: 8 },
  post: { padding: spacing.lg, gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  title: { color: colors.text, fontSize: font.xl, fontWeight: '800' },
  author: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  meta: { color: colors.textMuted, fontSize: font.xs },
})
