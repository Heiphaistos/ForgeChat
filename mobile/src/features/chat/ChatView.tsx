import * as Clipboard from 'expo-clipboard'
import { router } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { useQuery } from '@tanstack/react-query'
import { create } from 'zustand'
import { Sheet, type SheetAction } from '@/components/Sheet'
import { EmptyState, ErrorState, Loading } from '@/components/ui'
import { dmsApi } from '@/api/dms'
import { messagesApi, type ReportReason } from '@/api/messages'
import { serversApi } from '@/api/servers'
import { EMOJI_PALETTE, QUICK_REACTIONS } from '@/lib/emojis'
import { isSameDay } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { useAuth } from '@/stores/auth'
import { useTyping } from '@/stores/typing'
import type { ChatMessage, ConversationRef } from '@/types/models'
import { colors, font, radius, spacing } from '@/theme'
import { Composer } from './Composer'
import type { MentionCandidate } from './mentions'
import { MessageItem } from './MessageItem'
import { useScrollTarget } from './pins'
import { useConversation } from './useConversation'

/** Brouillons en mémoire uniquement (jamais persistés sur disque). */
const useDrafts = create<{ drafts: Record<string, string>; set: (id: string, v: string) => void }>((set) => ({
  drafts: {},
  set: (id, v) => set((s) => ({ drafts: { ...s.drafts, [id]: v } })),
}))

const GROUP_WINDOW_MS = 5 * 60_000
/** Pages plus anciennes chargées au maximum pour atteindre un message épinglé. */
const MAX_SCROLL_PAGES = 5
const HIGHLIGHT_MS = 2000

function TypingIndicator({ conversationId }: { conversationId: string }) {
  const typers = useTyping((s) => s.byConversation[conversationId])
  const names = typers ? Object.values(typers).map((t) => t.name) : []
  if (!names.length) return <View style={styles.typing} />
  const label =
    names.length === 1 ? `${names[0]} écrit…` : names.length === 2 ? `${names[0]} et ${names[1]} écrivent…` : 'Plusieurs personnes écrivent…'
  return (
    <View style={styles.typing} accessibilityLiveRegion="polite">
      <Text style={styles.typingText}>{label}</Text>
    </View>
  )
}

export function ChatView({
  conversation,
  placeholder,
  readOnly,
  readOnlyReason,
  header,
}: {
  conversation: ConversationRef
  placeholder: string
  readOnly?: boolean
  readOnlyReason?: string
  header?: React.ReactElement
}) {
  const me = useAuth((s) => s.user)
  const conv = useConversation(conversation)
  const draft = useDrafts((s) => s.drafts[conv.id] ?? '')
  const setDraft = useDrafts((s) => s.set)
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const [selected, setSelected] = useState<ChatMessage | null>(null)
  const [paletteFor, setPaletteFor] = useState<ChatMessage | null>(null)
  const listRef = useRef<FlatList<ChatMessage>>(null)

  // DM et groupes : l'état « épinglé » n'est pas dans les messages, on le lit dans la liste des épinglés.
  const pins = useQuery({
    queryKey: qk.pins(conv.id),
    queryFn: () => messagesApi.pins(conversation),
    enabled: conversation.kind !== 'channel',
  })
  const pinnedIds = useMemo(() => new Set((pins.data ?? []).map((p) => p.messageId)), [pins.data])
  // Autocomplétion @mention : membres du serveur (salon) ou participants (groupe). Rien en DM 1:1.
  const serverId = conversation.kind === 'channel' ? conversation.serverId : ''
  const groupId = conversation.kind === 'group' ? conversation.groupId : ''
  const members = useQuery({ queryKey: qk.members(serverId), queryFn: () => serversApi.members(serverId), enabled: !!serverId })
  const group = useQuery({ queryKey: qk.group(groupId), queryFn: () => dmsApi.group(groupId), enabled: !!groupId })
  const mentionCandidates = useMemo<MentionCandidate[]>(
    () =>
      serverId
        ? (members.data ?? []).map((m) => ({ id: m.user_id, username: m.username, nickname: m.nickname, avatar: m.avatar }))
        : (group.data?.members ?? []).map((m) => ({ id: m.id, username: m.username, avatar: m.avatar })),
    [serverId, members.data, group.data],
  )
  const isPinned = (m: ChatMessage) => (conversation.kind === 'channel' ? m.pinned : pinnedIds.has(m.id))

  // Défilement vers un message demandé par l'écran des épinglés (chargement de pages plus anciennes si besoin).
  const target = useScrollTarget((s) => (s.target?.conversationId === conv.id ? s.target.messageId : null))
  const highlightId = useScrollTarget((s) => s.highlightId)
  const pagesLoaded = useRef(0)
  const { messages, hasOlder, loadingOlder, loadOlder } = conv
  useEffect(() => {
    if (!target) {
      pagesLoaded.current = 0
      return
    }
    const index = messages.findIndex((m) => m.id === target)
    if (index >= 0) {
      listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true })
      useScrollTarget.getState().done(target)
    } else if (hasOlder && pagesLoaded.current < MAX_SCROLL_PAGES) {
      if (!loadingOlder) {
        pagesLoaded.current += 1
        loadOlder()
      }
    } else {
      useScrollTarget.getState().done(null)
      Alert.alert('Message introuvable', 'Il est trop ancien ou a été supprimé.')
    }
  }, [target, messages, hasOlder, loadingOlder, loadOlder])
  useEffect(() => {
    if (!highlightId) return
    const t = setTimeout(() => useScrollTarget.getState().done(null), HIGHLIGHT_MS)
    return () => clearTimeout(t)
  }, [highlightId])

  const react = useCallback(
    (m: ChatMessage, emoji: string) => {
      if (m.pending || m.id.startsWith('tmp-')) return
      conv.react(m, emoji).catch((e) => Alert.alert('Réaction impossible', errorMessage(e)))
    },
    [conv],
  )

  const confirmDelete = useCallback(
    (m: ChatMessage) =>
      Alert.alert('Supprimer le message ?', 'Cette action est définitive.', [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => conv.remove(m.id).catch((e) => Alert.alert('Suppression impossible', errorMessage(e))),
        },
      ]),
    [conv],
  )

  const report = useCallback((m: ChatMessage) => {
    const send = (reason: ReportReason) =>
      messagesApi
        .report(m.id, reason)
        .then(() => Alert.alert('Merci', 'Le signalement a été transmis aux modérateurs.'))
        .catch((e) => Alert.alert('Signalement impossible', errorMessage(e)))
    Alert.alert('Signaler ce message', 'Motif du signalement :', [
      { text: 'Spam', onPress: () => void send('spam') },
      { text: 'Harcèlement', onPress: () => void send('harassment') },
      { text: 'Contenu inapproprié', onPress: () => void send('nsfw') },
      { text: 'Annuler', style: 'cancel' },
    ])
  }, [])

  const actionsFor = (m: ChatMessage): SheetAction[] => {
    const mine = m.authorId === me?.id
    if (m.failed && m.id.startsWith('tmp-')) {
      return [{ label: 'Supprimer le brouillon', icon: 'trash-outline', danger: true, onPress: () => conv.discardFailed(m.id) }]
    }
    const list: SheetAction[] = []
    if (!readOnly) list.push({ label: 'Répondre', icon: 'arrow-undo', onPress: () => setReplyTo(m) })
    list.push({ label: 'Ajouter une réaction', icon: 'happy-outline', onPress: () => setPaletteFor(m) })
    if (m.content) list.push({ label: 'Copier le texte', icon: 'copy-outline', onPress: () => void Clipboard.setStringAsync(m.content ?? '') })
    if (mine && m.content && !readOnly) list.push({ label: 'Modifier', icon: 'create-outline', onPress: () => setEditing(m) })
    if (conversation.kind === 'channel' || pins.isSuccess) {
      const pinned = isPinned(m)
      list.push({
        label: pinned ? 'Désépingler' : 'Épingler',
        icon: 'pin-outline',
        onPress: () =>
          messagesApi
            .pin(conversation, m.id, !pinned)
            .then(() => queryClient.invalidateQueries({ queryKey: qk.pins(conv.id) }))
            .catch((e) => Alert.alert('Action impossible', errorMessage(e))),
      })
    }
    if (!mine) list.push({ label: 'Voir le profil', icon: 'person-circle-outline', onPress: () => router.push(`/user/${m.authorId}`) })
    if (!mine && conversation.kind === 'channel') list.push({ label: 'Signaler', icon: 'flag-outline', danger: true, onPress: () => report(m) })
    // Suppression : l'auteur, ou un modérateur (le serveur tranche — 403 sinon).
    if (mine || conversation.kind === 'channel') list.push({ label: 'Supprimer', icon: 'trash-outline', danger: true, onPress: () => confirmDelete(m) })
    return list
  }

  const onPressAuthor = useCallback((userId: string) => router.push(`/user/${userId}`), [])
  const onLongPress = useCallback((m: ChatMessage) => setSelected(m), [])

  const renderItem = useCallback(
    ({ item, index }: { item: ChatMessage; index: number }) => {
      // Liste inversée : l'élément « précédent » chronologiquement est à index+1.
      const prev = conv.messages[index + 1]
      const daySeparator = !prev || !isSameDay(prev.createdAt, item.createdAt)
      const grouped =
        !!prev &&
        !daySeparator &&
        prev.authorId === item.authorId &&
        !item.reply &&
        new Date(item.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS
      return (
        <View style={item.id === highlightId ? styles.highlight : undefined}>
          <MessageItem
            message={item}
            grouped={grouped}
            daySeparator={daySeparator}
            myId={me?.id ?? ''}
            myName={me?.username ?? ''}
            onLongPress={onLongPress}
            onReact={react}
            onPressAuthor={onPressAuthor}
            onRetry={onLongPress}
          />
        </View>
      )
    },
    [conv.messages, me?.id, me?.username, onLongPress, react, onPressAuthor, highlightId],
  )

  const quickReactions = useMemo(
    () =>
      selected && !selected.pending && !selected.id.startsWith('tmp-') ? (
        <View style={styles.quickRow}>
          {QUICK_REACTIONS.map((e) => (
            <Pressable
              key={e}
              style={styles.quick}
              onPress={() => {
                const m = selected
                setSelected(null)
                react(m, e)
              }}
              accessibilityRole="button"
              accessibilityLabel={`Réagir ${e}`}
            >
              <Text style={{ fontSize: 24 }}>{e}</Text>
            </Pressable>
          ))}
        </View>
      ) : null,
    [selected, react],
  )

  let body: React.ReactNode
  if (conv.isLoading) body = <Loading />
  else if (conv.error && !conv.messages.length) body = <ErrorState message={errorMessage(conv.error)} onRetry={() => void conv.refetch()} />
  else
    body = (
      <FlatList
        ref={listRef}
        data={conv.messages}
        inverted
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          // Hauteurs variables : on s'approche, puis on réessaie une fois les éléments mesurés.
          listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false })
          setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true }), 250)
        }}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        onEndReached={conv.loadOlder}
        onEndReachedThreshold={0.4}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 80 }}
        contentContainerStyle={{ paddingVertical: spacing.sm }}
        ListFooterComponent={
          conv.loadingOlder ? (
            <ActivityIndicator color={colors.primary} style={{ margin: spacing.lg }} />
          ) : !conv.hasOlder ? (
            header ?? <EmptyState icon="chatbubbles-outline" title="C'est le début de la conversation" />
          ) : null
        }
        windowSize={11}
        initialNumToRender={20}
        removeClippedSubviews
      />
    )

  return (
    <KeyboardAvoidingView behavior="padding" automaticOffset style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1 }}>{body}</View>
      <TypingIndicator conversationId={conv.id} />
      <Composer
        placeholder={placeholder}
        disabled={readOnly}
        disabledReason={readOnlyReason}
        replyTo={replyTo}
        editing={editing}
        onCancelReply={() => setReplyTo(null)}
        onCancelEdit={() => setEditing(null)}
        onSend={async (text, files) => {
          const reply = replyTo
          setReplyTo(null)
          await conv.send(text, { replyTo: reply, files })
        }}
        onEdit={conv.edit}
        onTyping={conv.notifyTyping}
        draft={draft}
        onDraftChange={(t) => setDraft(conv.id, t)}
        mentionCandidates={mentionCandidates}
        myId={me?.id ?? null}
      />

      <Sheet
        visible={!!selected}
        onClose={() => setSelected(null)}
        header={quickReactions}
        actions={selected ? actionsFor(selected) : []}
      />

      <Modal visible={!!paletteFor} transparent animationType="fade" onRequestClose={() => setPaletteFor(null)}>
        <Pressable style={styles.paletteBackdrop} onPress={() => setPaletteFor(null)}>
          <View style={styles.palette}>
            {EMOJI_PALETTE.map((e) => (
              <Pressable
                key={e}
                style={styles.paletteItem}
                onPress={() => {
                  const m = paletteFor
                  setPaletteFor(null)
                  if (m) react(m, e)
                }}
                accessibilityLabel={`Réagir ${e}`}
              >
                <Text style={{ fontSize: 26 }}>{e}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  highlight: { backgroundColor: colors.primary + '33' },
  typing: { height: 20, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  typingText: { color: colors.textMuted, fontSize: font.xs, fontStyle: 'italic' },
  quickRow: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  quick: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.bgElevated, alignItems: 'center', justifyContent: 'center' },
  paletteBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.lg },
  palette: { backgroundColor: colors.bgAlt, borderRadius: radius.lg, padding: spacing.md, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  paletteItem: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
})
