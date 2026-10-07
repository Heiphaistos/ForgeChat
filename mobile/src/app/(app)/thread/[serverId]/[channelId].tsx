import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Alert, Modal, ScrollView, StyleSheet, Text, View } from 'react-native'
import { threadsApi } from '@/api/threads'
import { Sheet, type SheetAction } from '@/components/Sheet'
import { Button, ErrorState, IconButton, Loading, TextField } from '@/components/ui'
import { LIMITS } from '@/config/env'
import { ReplyThreadView } from '@/features/chat/ReplyThreadView'
import { createThreadBody, olderCursor, sendWithAttachments, type ThreadSummary } from '@/features/chat/threads'
import { PERM } from '@/features/servers/perms'
import { useServerPerms } from '@/features/servers/menus'
import { useAuth } from '@/stores/auth'
import { errorMessage } from '@/lib/http'
import { isUuid, useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import { colors, font, radius, spacing } from '@/theme'

/**
 * Fil de discussion d'un salon (comme ThreadPanel). Ouvert depuis un message (`parent`) ou un fil
 * précis (`threadId`) ; sans fil existant pour ce message, formulaire de création.
 */
export default function ThreadScreen() {
  const { valid, ids, text } = useRouteParams(['serverId', 'channelId'] as const, ['parent', 'threadId', 'preview'])
  const parent = isUuid(text.parent) ? text.parent.toLowerCase() : null
  const directId = isUuid(text.threadId) ? text.threadId.toLowerCase() : null
  const lookup = useQuery({
    queryKey: [...qk.threads(ids.channelId ?? ''), 'one', directId ?? parent],
    queryFn: () => threadsApi.list(ids.serverId, ids.channelId, directId ? { thread_id: directId } : { parent_message_id: parent ?? undefined }),
    enabled: valid && !!(directId || parent),
  })
  if (!valid || !(directId || parent)) return <ErrorState message="Fil invalide." />
  if (lookup.isLoading) return <Loading />
  if (lookup.error) return <ErrorState message={errorMessage(lookup.error)} onRetry={() => void lookup.refetch()} />
  const thread = lookup.data?.[0]
  return thread ? (
    <ThreadConversation serverId={ids.serverId} channelId={ids.channelId} thread={thread} />
  ) : (
    <CreateThread serverId={ids.serverId} channelId={ids.channelId} parent={parent} preview={text.preview} />
  )
}

function ThreadConversation({ serverId, channelId, thread }: { serverId: string; channelId: string; thread: ThreadSummary }) {
  const key = qk.threadMessages(thread.id)
  const q = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => threadsApi.messages(serverId, channelId, thread.id, pageParam),
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
      .catch((e) => Alert.alert('Action impossible', errorMessage(e)))
  const menuActions: SheetAction[] = []
  if (canModerate || thread.creatorId === meId) {
    menuActions.push({ label: 'Renommer le fil', icon: 'create-outline', onPress: () => setRenameText(thread.title) })
    menuActions.push({
      label: thread.archived ? 'Désarchiver le fil' : 'Archiver le fil',
      icon: 'archive-outline',
      onPress: () => void update({ archived: !thread.archived }),
    })
  }
  if (canModerate)
    menuActions.push({
      label: thread.locked ? 'Déverrouiller le fil' : 'Verrouiller le fil',
      icon: thread.locked ? 'lock-open-outline' : 'lock-closed-outline',
      onPress: () => void update({ archived: thread.archived, locked: !thread.locked }),
    })

  return (
    <>
      <Stack.Screen
        options={{
          title: thread.title,
          headerRight: menuActions.length ? () => <IconButton icon="ellipsis-vertical" label="Gérer le fil" onPress={() => setMenu(true)} /> : undefined,
        }}
      />
      <Sheet visible={menu} onClose={() => setMenu(false)} title={thread.title} actions={menuActions} />
      <Modal visible={renameText !== null} transparent animationType="fade" onRequestClose={() => setRenameText(null)}>
        <View style={styles.renameBackdrop}>
          <View style={styles.renameBox}>
            <TextField label="Titre du fil" value={renameText ?? ''} onChangeText={setRenameText} maxLength={100} autoFocus />
            <View style={styles.renameRow}>
              <Button title="Annuler" variant="secondary" onPress={() => setRenameText(null)} />
              <Button
                title="Renommer"
                disabled={!renameText?.trim()}
                onPress={() => {
                  const t = renameText?.trim()
                  setRenameText(null)
                  if (t) void update({ title: t })
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
            .catch((e) => Alert.alert('Réaction impossible', errorMessage(e)))
        }
        onSend={(t, files) =>
          sendWithAttachments(
            t,
            files,
            (has) => threadsApi.send(serverId, channelId, thread.id, t, has),
            (id, f) => threadsApi.upload(serverId, channelId, thread.id, id, f),
            (id) => threadsApi.remove(serverId, channelId, thread.id, id),
          ).finally(refresh)
        }
        onEdit={(m, t) => threadsApi.edit(serverId, channelId, thread.id, m.id, t).then(refresh)}
        onDelete={(m) => threadsApi.remove(serverId, channelId, thread.id, m.id).then(refresh)}
        canModerate={canModerate}
        disabledReason={thread.locked ? 'Ce fil est verrouillé.' : thread.archived ? 'Ce fil est archivé.' : null}
        placeholder={`Répondre dans ${thread.title}`}
        header={
          <View style={{ padding: spacing.lg }}>
            <Text style={styles.title}>{thread.title}</Text>
            <Text style={styles.muted}>Début du fil</Text>
          </View>
        }
      />
    </>
  )
}

function CreateThread({ serverId, channelId, parent, preview }: { serverId: string; channelId: string; parent: string | null; preview?: string }) {
  const [title, setTitle] = useState('')
  const [first, setFirst] = useState('')
  const [busy, setBusy] = useState(false)
  const create = () => {
    const body = createThreadBody(title, first, parent)
    if (!body) return
    setBusy(true)
    threadsApi
      .create(serverId, channelId, body)
      .then(() => queryClient.invalidateQueries({ queryKey: qk.threads(channelId) }))
      .catch((e) => Alert.alert('Création impossible', errorMessage(e)))
      .finally(() => setBusy(false))
  }
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Nouveau fil' }} />
      {preview ? (
        <View style={styles.preview}>
          <Text style={styles.muted}>À partir du message</Text>
          <Text style={{ color: colors.textSecondary }} numberOfLines={3}>
            {preview}
          </Text>
        </View>
      ) : null}
      <TextField label="Titre (facultatif)" accessibilityLabel="Titre du fil, facultatif" value={title} onChangeText={setTitle} maxLength={100} placeholder="Par défaut : début du premier message" />
      <TextField label="Premier message" accessibilityLabel="Premier message du fil" value={first} onChangeText={setFirst} multiline maxLength={LIMITS.messageMaxChars} style={{ minHeight: 100, textAlignVertical: 'top' }} />
      <Button title="Créer le fil" icon="chatbubbles-outline" loading={busy} disabled={!first.trim()} onPress={create} />
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
