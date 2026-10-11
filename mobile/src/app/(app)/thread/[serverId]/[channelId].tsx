import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Alert, Modal, ScrollView, StyleSheet, Text, View } from 'react-native'
import { threadsApi } from '@/api/threads'
import { e2eErrorText } from '@/e2e/conversations'
import { Sheet, type SheetAction } from '@/components/Sheet'
import { Button, ErrorState, IconButton, Loading, TextField } from '@/components/ui'
import { LIMITS } from '@/config/env'
import { ReplyThreadView } from '@/features/chat/ReplyThreadView'
import { createThreadBody, olderCursor, sendWithAttachments, type ThreadSummary } from '@/features/chat/threads'
import { autoThreadTitle } from '@/features/chat/messaging'
import { PERM } from '@/features/servers/perms'
import { useServerPerms } from '@/features/servers/menus'
import { useAuth } from '@/stores/auth'
import { outgoingText } from '@/stores/uxPrefs'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { isUuid, useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import { colors, font, radius, spacing } from '@/theme'
import { withPreparedUploads } from '@/e2e/files'

/**
 * Fil de discussion d'un salon (comme ThreadPanel). Ouvert depuis un message (`parent`) ou un fil
 * précis (`threadId`) ; sans fil existant pour ce message, formulaire de création.
 */
export default function ThreadScreen() {
  const t = useT()
  const { valid, ids, text } = useRouteParams(['serverId', 'channelId'] as const, ['parent', 'threadId', 'preview', 'auto'])
  const parent = isUuid(text.parent) ? text.parent.toLowerCase() : null
  const directId = isUuid(text.threadId) ? text.threadId.toLowerCase() : null
  const lookup = useQuery({
    queryKey: [...qk.threads(ids.channelId ?? ''), 'one', directId ?? parent],
    queryFn: () => threadsApi.list(ids.serverId, ids.channelId, directId ? { thread_id: directId } : { parent_message_id: parent ?? undefined }),
    enabled: valid && !!(directId || parent),
  })
  if (!valid || !(directId || parent)) return <ErrorState message={t('social.thread.invalid')} />
  if (lookup.isLoading) return <Loading />
  if (lookup.error) return <ErrorState message={errorMessage(lookup.error)} onRetry={() => void lookup.refetch()} />
  const thread = lookup.data?.[0]
  return thread ? (
    <ThreadConversation serverId={ids.serverId} channelId={ids.channelId} thread={thread} />
  ) : (
    <CreateThread serverId={ids.serverId} channelId={ids.channelId} parent={parent} preview={text.preview} auto={text.auto === '1'} />
  )
}

function ThreadConversation({ serverId, channelId, thread }: { serverId: string; channelId: string; thread: ThreadSummary }) {
  const t = useT()
  const key = qk.threadMessages(thread.id)
  const q = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => threadsApi.messages(serverId, channelId, thread, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => olderCursor(last, LIMITS.pageSize),
  })
  // Pages : la plus récente d'abord, chacune en ordre chronologique → liste du plus récent au plus ancien.
  const messages = useMemo(() => (q.data?.pages ?? []).flatMap((p) => [...p].reverse()), [q.data])
  const lastId = messages[0]?.id
  useEffect(() => {
    if (!lastId) return
    threadsApi
      .ack(serverId, channelId, thread.id)
      .then(() => queryClient.invalidateQueries({ queryKey: qk.threads(channelId) }))
      .catch(() => undefined) // lecture non marquée : sans conséquence
  }, [lastId, serverId, channelId, thread.id])
  const refresh = () => queryClient.invalidateQueries({ queryKey: key })
  const meId = useAuth((s) => s.user?.id)
  const canModerate = useServerPerms(serverId).has(PERM.MANAGE_MESSAGES)
  const [menu, setMenu] = useState(false)
  // archive_thread : archiver = créateur ou MANAGE_MESSAGES ; verrouiller = MANAGE_MESSAGES.
  const [renameText, setRenameText] = useState<string | null>(null)
  const update = (body: { archived?: boolean; locked?: boolean; title?: string }) =>
    threadsApi
      .update(serverId, channelId, thread.id, body)
      .then(() => queryClient.invalidateQueries({ queryKey: qk.threads(channelId) }))
      .catch((e) => Alert.alert(t('common.actionFailed'), errorMessage(e)))
  const menuActions: SheetAction[] = []
  if (canModerate || thread.creatorId === meId) {
    // Titre chiffré : le serveur ne sait renommer qu'en clair, ce qui le révélerait.
    if (!thread.titleEncrypted) menuActions.push({ label: t('social.thread.rename'), icon: 'create-outline', onPress: () => setRenameText(thread.title) })
    menuActions.push({
      label: thread.archived ? t('social.thread.unarchive') : t('social.thread.archive'),
      icon: 'archive-outline',
      onPress: () => void update({ archived: !thread.archived }),
    })
  }
  if (canModerate)
    menuActions.push({
      label: thread.locked ? t('social.thread.unlock') : t('social.thread.lock'),
      icon: thread.locked ? 'lock-open-outline' : 'lock-closed-outline',
      onPress: () => void update({ archived: thread.archived, locked: !thread.locked }),
    })

  return (
    <>
      <Stack.Screen
        options={{
          title: thread.title,
          headerRight: menuActions.length ? () => <IconButton icon="ellipsis-vertical" label={t('social.thread.manage')} onPress={() => setMenu(true)} /> : undefined,
        }}
      />
      <Sheet visible={menu} onClose={() => setMenu(false)} title={thread.title} actions={menuActions} />
      <Modal visible={renameText !== null} transparent animationType="fade" onRequestClose={() => setRenameText(null)}>
        <View style={styles.renameBackdrop}>
          <View style={styles.renameBox}>
            <TextField label={t('social.thread.titleLabel')} value={renameText ?? ''} onChangeText={setRenameText} maxLength={100} autoFocus />
            <View style={styles.renameRow}>
              <Button title={t('common.cancel')} variant="secondary" onPress={() => setRenameText(null)} />
              <Button
                title={t('social.thread.renameButton')}
                disabled={!renameText?.trim()}
                onPress={() => {
                  const title = renameText?.trim()
                  setRenameText(null)
                  if (title) void update({ title })
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
      <ReplyThreadView
        messages={messages}
        isLoading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        hasOlder={!!q.hasNextPage}
        loadingOlder={q.isFetchingNextPage}
        onLoadOlder={() => void q.fetchNextPage()}
        onReact={(m, emoji) =>
          void threadsApi
            .react(serverId, channelId, thread.id, m.id, emoji)
            .then(refresh)
            .catch((e) => Alert.alert(t('chat.reactFailed'), errorMessage(e)))
        }
        onSend={(raw, files) => {
          // Liens nettoyés et émoticônes converties sur l'appareil, avant le chiffrement.
          const body = outgoingText(raw)
          // Fichiers chiffrés avant l'envoi (clés dans le message chiffré, §12).
          return withPreparedUploads('channel', channelId, files, (p) =>
            sendWithAttachments(
              body,
              p.uploads,
              (has) => threadsApi.send(serverId, channelId, thread, body, has, p.entries),
              (id, f) => threadsApi.upload(serverId, channelId, thread.id, id, f),
              (id) => threadsApi.remove(serverId, channelId, thread.id, id),
            ),
          ).finally(refresh)
        }}
        onEdit={(m, body) => threadsApi.edit(serverId, channelId, thread, m, body).then(refresh)}
        onDelete={(m) => threadsApi.remove(serverId, channelId, thread.id, m.id).then(refresh)}
        canModerate={canModerate}
        disabledReason={thread.locked ? t('social.thread.locked') : thread.archived ? t('social.thread.archived') : null}
        placeholder={t('social.thread.replyIn', { title: thread.title })}
        header={
          <View style={{ padding: spacing.lg }}>
            <Text style={styles.title}>{thread.title}</Text>
            <Text style={styles.muted}>{t('social.thread.start')}</Text>
          </View>
        }
      />
    </>
  )
}

function CreateThread({ serverId, channelId, parent, preview, auto }: { serverId: string; channelId: string; parent: string | null; preview?: string; auto?: boolean }) {
  const t = useT()
  // Fils automatiques : pas de titre à saisir, celui du fil est le début du message d'origine.
  const [title, setTitle] = useState(auto ? autoThreadTitle(preview, t('messaging.autothread.reply')) : '')
  const [first, setFirst] = useState('')
  const [busy, setBusy] = useState(false)
  const create = () => {
    const body = createThreadBody(title, first, parent)
    if (!body) return
    setBusy(true)
    threadsApi
      .create(serverId, channelId, title, body.first_message, parent)
      .then(() => queryClient.invalidateQueries({ queryKey: qk.threads(channelId) }))
      .catch((e) => Alert.alert(t('social.thread.createFailed'), e2eErrorText(e) ?? errorMessage(e)))
      .finally(() => setBusy(false))
  }
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: t('social.thread.new') }} />
      {preview ? (
        <View style={styles.preview}>
          <Text style={styles.muted}>{t('social.thread.fromMessage')}</Text>
          <Text style={{ color: colors.textSecondary }} numberOfLines={3}>
            {preview}
          </Text>
        </View>
      ) : null}
      {auto ? null : <TextField label={t('social.thread.optionalTitle')} accessibilityLabel={t('social.thread.optionalTitleLabel')} value={title} onChangeText={setTitle} maxLength={100} placeholder={t('social.thread.titlePlaceholder')} />}
      <TextField label={t('social.thread.first')} accessibilityLabel={t('social.thread.firstLabel')} value={first} onChangeText={setFirst} multiline maxLength={LIMITS.messageMaxChars} style={{ minHeight: 100, textAlignVertical: 'top' }} />
      <Button title={t('social.thread.create')} icon="chatbubbles-outline" loading={busy} disabled={!first.trim()} onPress={create} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  renameBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.lg },
  renameBox: { backgroundColor: colors.bgElevated, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  renameRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  title: { color: colors.text, fontSize: font.xl, fontWeight: '800' },
  muted: { color: colors.textMuted, fontSize: font.sm },
  preview: { backgroundColor: colors.bgAlt, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs, borderLeftWidth: 3, borderLeftColor: colors.primary },
})
