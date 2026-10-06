import { useInfiniteQuery } from '@tanstack/react-query'
import { router, Stack } from 'expo-router'
import { useMemo, useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'
import { forumApi } from '@/api/forum'
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
  if (!valid) return <ErrorState message="Publication invalide." />
  const post = q.data?.pages[0]?.post
  const refresh = () => queryClient.invalidateQueries({ queryKey: key })
  const refreshList = () => queryClient.invalidateQueries({ queryKey: qk.forum(ids.channelId) })
  const fail = (e: unknown) => Alert.alert('Action impossible', errorMessage(e))
  const patchPost = (patch: { content?: string; pinned?: boolean; locked?: boolean }) =>
    forumApi.updatePost(ids.serverId, ids.channelId, ids.postId, patch).then(() => Promise.all([refresh(), refreshList()]))

  // update_post / delete_post : texte = créateur ; épingler, verrouiller = MANAGE_MESSAGES ; supprimer = les deux.
  const mine = !!post?.creatorId && post.creatorId === meId
  const menuActions: SheetAction[] = []
  if (post && mine) menuActions.push({ label: 'Modifier le texte', icon: 'create-outline', onPress: () => setEditText(post.content ?? '') })
  if (post && canModerate) {
    menuActions.push({ label: post.pinned ? 'Désépingler' : 'Épingler', icon: 'pin-outline', onPress: () => void patchPost({ pinned: !post.pinned }).catch(fail) })
    menuActions.push({
      label: post.locked ? 'Déverrouiller' : 'Verrouiller',
      icon: post.locked ? 'lock-open-outline' : 'lock-closed-outline',
      onPress: () => void patchPost({ locked: !post.locked }).catch(fail),
    })
  }
  if (post && (mine || canModerate))
    menuActions.push({
      label: 'Supprimer la publication',
      icon: 'trash-outline',
      danger: true,
      onPress: () =>
        Alert.alert('Supprimer la publication ?', 'Elle disparaît avec toutes ses réponses.', [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Supprimer',
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
    if (editText === null) return
    setSaving(true)
    patchPost({ content: editText.trim() })
      .then(() => setEditText(null))
      .catch(fail)
      .finally(() => setSaving(false))
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: post?.title ?? text.title ?? 'Publication',
          headerRight: menuActions.length ? () => <IconButton icon="ellipsis-vertical" label="Gérer la publication" onPress={() => setMenu(true)} /> : undefined,
        }}
      />
      <Sheet visible={menu} onClose={() => setMenu(false)} title={post?.title} actions={menuActions} />
      <FormSheet visible={editText !== null} onClose={() => setEditText(null)} title="Modifier la publication">
        <TextField
          label="Texte"
          value={editText ?? ''}
          onChangeText={setEditText}
          multiline
          maxLength={LIMITS.messageMaxChars}
          style={{ minHeight: 120, textAlignVertical: 'top' }}
        />
        <Button title="Enregistrer" icon="checkmark" loading={saving} onPress={saveText} />
      </FormSheet>
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
        onSend={(t, files) =>
          sendWithAttachments(
            t,
            files,
            (has) => forumApi.reply(ids.serverId, ids.channelId, ids.postId, t, has),
            (id, f) => forumApi.uploadReply(ids.serverId, ids.channelId, ids.postId, id, f),
            (id) => forumApi.deleteReply(ids.serverId, ids.channelId, ids.postId, id),
          ).finally(() => {
            void refresh()
            void refreshList()
          })
        }
        onEdit={(m, t) => forumApi.editReply(ids.serverId, ids.channelId, ids.postId, m.id, t).then(refresh)}
        onDelete={(m) => forumApi.deleteReply(ids.serverId, ids.channelId, ids.postId, m.id).then(() => Promise.all([refresh(), refreshList()]))}
        canModerate={canModerate}
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
