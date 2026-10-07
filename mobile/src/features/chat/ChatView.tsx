import * as Clipboard from 'expo-clipboard'
import { router } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { useQuery } from '@tanstack/react-query'
import { create } from 'zustand'
import { Image } from 'expo-image'
import { Avatar } from '@/components/Avatar'
import { Sheet, type SheetAction } from '@/components/Sheet'
import { Button, EmptyState, ErrorState, Loading } from '@/components/ui'
import { apiOrigin } from '@/config/env'
import { announcementsApi } from '@/api/announcements'
import { dmsApi } from '@/api/dms'
import { messagesApi, type ReportReason } from '@/api/messages'
import { serversApi } from '@/api/servers'
import { threadsApi } from '@/api/threads'
import { EMOJI_PALETTE, QUICK_REACTIONS } from '@/lib/emojis'
import { isSameDay } from '@/lib/format'
import { useT } from '@/i18n'
import { ApiError, errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { useAuth } from '@/stores/auth'
import { useTyping } from '@/stores/typing'
import type { ChatMessage, ConversationRef } from '@/types/models'
import { colors, font, radius, spacing } from '@/theme'
import { hasEditableText, tenorGifUrl } from '@/features/composer/formats'
import { Composer } from './Composer'
import { buildEmojiMap, CustomEmojiContext } from './customEmojis'
import type { MentionCandidate } from './mentions'
import { MessageItem, SUPER_COLOR } from './MessageItem'
import { userRoute } from '@/features/servers/memberProfile'
import { messagesKey } from './cache'
import { useScrollTarget } from './pins'
import { messageLink, supportsMessageExtras, supportsReactionDetail, supportsTranslate, type ReactionUser } from './messageExtras'
import { threadsByParent } from './threads'
import { useConversation } from './useConversation'
import { useRoleDecor } from '@/features/servers/roleDecor'

/** Brouillons en mémoire uniquement (jamais persistés sur disque). */
const useDrafts = create<{ drafts: Record<string, string>; set: (id: string, v: string) => void }>((set) => ({
  drafts: {},
  set: (id, v) => set((s) => ({ drafts: { ...s.drafts, [id]: v } })),
}))

const GROUP_WINDOW_MS = 5 * 60_000
const HIGHLIGHT_MS = 2000

function TypingIndicator({ conversationId }: { conversationId: string }) {
  const t = useT()
  const typers = useTyping((s) => s.byConversation[conversationId])
  const names = typers ? Object.values(typers).map((x) => x.name) : []
  if (!names.length) return <View style={styles.typing} />
  const label =
    names.length === 1
      ? t('chat.typingOne', { a: names[0]! })
      : names.length === 2
        ? t('chat.typingTwo', { a: names[0]!, b: names[1]! })
        : t('chat.typingMany')
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
  publishable,
}: {
  conversation: ConversationRef
  placeholder: string
  readOnly?: boolean
  readOnlyReason?: string
  header?: React.ReactElement
  /** Salon d'annonces et droit de gérer les messages : « Publier » vers les salons abonnés. */
  publishable?: boolean
}) {
  const t = useT()
  const me = useAuth((s) => s.user)
  const conv = useConversation(conversation)
  const draft = useDrafts((s) => s.drafts[conv.id] ?? '')
  const setDraft = useDrafts((s) => s.set)
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const [selected, setSelected] = useState<ChatMessage | null>(null)
  const [paletteFor, setPaletteFor] = useState<ChatMessage | null>(null)
  const [translations, setTranslations] = useState<Record<string, string>>({})
  const [reactors, setReactors] = useState<{ emoji: string; users: ReactionUser[] } | null>(null)
  const listRef = useRef<FlatList<ChatMessage>>(null)
  // Distance haut de l'écran → haut de la vue (en-tête compris), mesurée nous-mêmes :
  // `automaticOffset` retombait par intermittence sur y = 0 (position relative au parent)
  // et le clavier recouvrait alors la zone de saisie.
  const [topOffset, setTopOffset] = useState(0)
  const onKavLayout = useCallback((e: LayoutChangeEvent) => {
    e.target.measureInWindow((_x, y) => setTopOffset((prev) => (Math.abs(prev - y) > 0.5 ? y : prev)))
  }, [])

  // DM et groupes : l'état « épinglé » n'est pas dans les messages, on le lit dans la liste des épinglés.
  const pins = useQuery({
    queryKey: qk.pins(conv.id),
    queryFn: () => messagesApi.pins(conversation),
    enabled: conversation.kind !== 'channel',
  })
  const pinnedIds = useMemo(() => new Set((pins.data ?? []).map((p) => p.messageId)), [pins.data])
  // Autocomplétion @mention : membres du serveur (salon) ou participants (groupe). Rien en DM 1:1.
  const serverId = conversation.kind === 'channel' ? conversation.serverId : ''
  const channelId = conversation.kind === 'channel' ? conversation.channelId : ''
  const groupId = conversation.kind === 'group' ? conversation.groupId : ''
  const members = useQuery({ queryKey: qk.members(serverId), queryFn: () => serversApi.members(serverId), enabled: !!serverId })
  const decorOf = useRoleDecor(serverId)
  const group = useQuery({ queryKey: qk.group(groupId), queryFn: () => dmsApi.group(groupId), enabled: !!groupId })
  // Emojis personnalisés du serveur (salons uniquement) : texte, réactions et palette.
  const emojiQuery = useQuery({ queryKey: qk.emojis(serverId), queryFn: () => serversApi.emojis(serverId), enabled: !!serverId, staleTime: 60_000 })
  const customEmojis = useMemo(() => buildEmojiMap(emojiQuery.data), [emojiQuery.data])
  const mentionCandidates = useMemo<MentionCandidate[]>(
    () =>
      serverId
        ? (members.data ?? []).map((m) => ({ id: m.user_id, username: m.username, nickname: m.nickname, avatar: m.avatar }))
        : (group.data?.members ?? []).map((m) => ({ id: m.id, username: m.username, avatar: m.avatar })),
    [serverId, members.data, group.data],
  )
  // Fils du salon (100 plus récents) : badge sous le message d'origine.
  const threads = useQuery({
    queryKey: [...qk.threads(channelId), 'list'],
    queryFn: () => threadsApi.list(serverId, channelId, { limit: 100 }),
    enabled: !!channelId,
    staleTime: 60_000,
  })
  const threadOf = useMemo(() => threadsByParent(threads.data ?? []), [threads.data])
  const openThread = useCallback(
    (m: ChatMessage) =>
      router.push({
        pathname: '/thread/[serverId]/[channelId]',
        params: { serverId, channelId, parent: m.id, preview: (m.content ?? '').slice(0, 100) },
      }),
    [serverId, channelId],
  )
  // Enregistrés : lus seulement quand le menu d'un message est ouvert (libellé Enregistrer / Retirer).
  const extras = supportsMessageExtras(conversation)
  const saved = useQuery({ queryKey: qk.saved, queryFn: messagesApi.saved, enabled: extras && !!selected })
  const savedIds = useMemo(() => new Set((saved.data ?? []).map((s) => s.messageId)), [saved.data])
  const isPinned = (m: ChatMessage) => (conversation.kind === 'channel' ? m.pinned : pinnedIds.has(m.id))

  // Défilement vers un message demandé (épinglés, recherche, mentions). Absent des pages chargées :
  // la conversation est rechargée autour de lui (?around=, comme le web), puis on y défile.
  const target = useScrollTarget((s) => (s.target?.conversationId === conv.id ? s.target.messageId : null))
  const highlightId = useScrollTarget((s) => s.highlightId)
  const jumping = useRef<string | null>(null)
  const [detached, setDetached] = useState(false)
  const { messages, hasOlder, isLoading } = conv
  // Fin du saut (bouton « Revenir au présent » ou sortie de la conversation) : on repart des messages récents.
  useEffect(() => {
    if (!detached) return
    const queryKey = messagesKey(conversation.kind, conv.id)
    return () => void queryClient.resetQueries({ queryKey, exact: true })
  }, [detached, conversation.kind, conv.id])
  useEffect(() => {
    if (!target || isLoading) return // conversation ouverte à l'instant : attendre la première page
    const index = messages.findIndex((m) => m.id === target)
    if (index >= 0) {
      listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true })
      useScrollTarget.getState().done(target)
      return
    }
    const notFound = () => {
      useScrollTarget.getState().done(null)
      Alert.alert(t('chat.notFound'), t('chat.maybeDeleted'))
    }
    if (!hasOlder) return notFound()
    if (jumping.current === target) return
    jumping.current = target
    messagesApi
      .around(conversation, target)
      .then((page) => {
        if (!page.some((m) => m.id === target)) return notFound()
        queryClient.setQueryData(messagesKey(conversation.kind, conv.id), { pages: [page], pageParams: [undefined] })
        setDetached(true)
      })
      .catch(notFound)
      .finally(() => {
        jumping.current = null
      })
  }, [target, messages, hasOlder, isLoading, conversation, conv.id, t])
  useEffect(() => {
    if (!highlightId) return
    const timer = setTimeout(() => useScrollTarget.getState().done(null), HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [highlightId])

  const react = useCallback(
    (m: ChatMessage, emoji: string, isSuper = false) => {
      if (m.pending || m.id.startsWith('tmp-')) return
      conv.react(m, emoji, isSuper).catch((e) => Alert.alert(t('chat.reactFailed'), errorMessage(e)))
    },
    [conv, t],
  )

  const confirmDelete = useCallback(
    (m: ChatMessage) =>
      Alert.alert(t('chat.deleteConfirm'), t('chat.deleteBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => conv.remove(m.id).catch((e) => Alert.alert(t('chat.deleteFailed'), errorMessage(e))),
        },
      ]),
    [conv, t],
  )

  const report = useCallback((m: ChatMessage) => {
    const send = (reason: ReportReason) =>
      messagesApi
        .report(m.id, reason)
        .then(() => Alert.alert(t('chat.thanks'), t('chat.reportSent')))
        .catch((e) => Alert.alert(t('chat.reportFailed'), errorMessage(e)))
    Alert.alert(t('chat.reportTitle'), t('chat.reportReason'), [
      { text: t('chat.spam'), onPress: () => void send('spam') },
      { text: t('chat.harassment'), onPress: () => void send('harassment') },
      { text: t('chat.inappropriate'), onPress: () => void send('nsfw') },
      { text: t('common.cancel'), style: 'cancel' },
    ])
  }, [t])

  const actionsFor = (m: ChatMessage): SheetAction[] => {
    const mine = m.authorId === me?.id
    if (m.failed && m.id.startsWith('tmp-')) {
      return [{ label: t('chat.deleteDraft'), icon: 'trash-outline', danger: true, onPress: () => conv.discardFailed(m.id) }]
    }
    const list: SheetAction[] = []
    if (!readOnly) list.push({ label: t('chat.reply'), icon: 'arrow-undo', onPress: () => setReplyTo(m) })
    list.push({ label: t('chat.addReaction'), icon: 'happy-outline', onPress: () => setPaletteFor(m) })
    const gif = tenorGifUrl(m.content)
    if (hasEditableText(m)) list.push({ label: t('chat.copyText'), icon: 'copy-outline', onPress: () => void Clipboard.setStringAsync(m.content ?? '') })
    else if (gif) list.push({ label: t('chat.copyGif'), icon: 'link-outline', onPress: () => void Clipboard.setStringAsync(gif) })
    // Vocal, sticker, GIF ou pièce jointe seule : rien à modifier.
    if (mine && hasEditableText(m) && !readOnly) list.push({ label: t('chat.edit'), icon: 'create-outline', onPress: () => setEditing(m) })
    if (conversation.kind === 'channel' || pins.isSuccess) {
      const pinned = isPinned(m)
      list.push({
        label: t(pinned ? 'chat.unpin' : 'chat.pin'),
        icon: 'pin-outline',
        onPress: () =>
          messagesApi
            .pin(conversation, m.id, !pinned)
            .then(() => queryClient.invalidateQueries({ queryKey: qk.pins(conv.id) }))
            .catch((e) => Alert.alert(t('common.actionFailed'), errorMessage(e))),
      })
    }
    if (publishable && conversation.kind === 'channel' && !m.pending && hasEditableText(m)) {
      const { serverId: sid, channelId: cid } = conversation
      list.push({
        label: t('chat.publish'),
        icon: 'megaphone-outline',
        onPress: () =>
          void announcementsApi
            .publish(sid, cid, m.id)
            .then((r) => Alert.alert(t('chat.published'), t(r.delivered > 1 ? 'chat.publishedToMany' : 'chat.publishedTo', { n: r.delivered })))
            .catch((e) => Alert.alert(t('chat.publishFailed'), errorMessage(e))),
      })
    }
    if (channelId && !m.pending) {
      if (threadOf.has(m.id)) list.push({ label: t('chat.openThread'), icon: 'chatbubbles-outline', onPress: () => openThread(m) })
      else if (!readOnly) list.push({ label: t('chat.createThread'), icon: 'chatbubbles-outline', onPress: () => openThread(m) })
    }
    if (extras && !m.pending) {
      const messageId = m.id
      list.push({ label: t('chat.forward'), icon: 'arrow-redo-outline', onPress: () => router.push({ pathname: '/forward', params: { messageId } }) })
      const isSaved = savedIds.has(m.id)
      list.push({
        label: t(isSaved ? 'chat.unsave' : 'chat.save'),
        icon: isSaved ? 'bookmark' : 'bookmark-outline',
        onPress: () =>
          (isSaved ? messagesApi.unsave(m.id) : messagesApi.save(conversation, m))
            .then(() => queryClient.invalidateQueries({ queryKey: qk.saved }))
            .catch((e) => Alert.alert(t('common.actionFailed'), errorMessage(e))),
      })
      list.push({ label: t('chat.remind'), icon: 'alarm-outline', onPress: () => router.push({ pathname: '/remind', params: { messageId } }) })
      if (m.editedAt) list.push({ label: t('chat.editHistory'), icon: 'time-outline', onPress: () => router.push({ pathname: '/edits', params: { messageId } }) })
    }
    if (!m.pending && supportsTranslate(conversation) && hasEditableText(m)) {
      list.push(
        translations[m.id]
          ? { label: t('chat.hideTranslation'), icon: 'language-outline', onPress: () => setTranslations(({ [m.id]: _, ...rest }) => rest) }
          : { label: t('chat.translate'), icon: 'language-outline', onPress: () => translate(m) },
      )
    }
    if (!m.pending) list.push({ label: t('chat.copyLink'), icon: 'link-outline', onPress: () => void Clipboard.setStringAsync(messageLink(apiOrigin(), conversation, m.id)) })
    if (!mine) list.push({ label: t('chat.viewProfile'), icon: 'person-circle-outline', onPress: () => router.push(userRoute(m.authorId, serverId)) })
    // MP 1-à-1 : le signalement part aux administrateurs du site (serveur : dm_reports).
    if (!mine && conversation.kind !== 'group') list.push({ label: t('chat.report'), icon: 'flag-outline', danger: true, onPress: () => report(m) })
    // Suppression : l'auteur, ou un modérateur (le serveur tranche — 403 sinon).
    if (mine || conversation.kind === 'channel') list.push({ label: t('chat.delete'), icon: 'trash-outline', danger: true, onPress: () => confirmDelete(m) })
    return list
  }

  const translate = (m: ChatMessage) =>
    messagesApi
      .translate(m.id)
      .then((text) => setTranslations((prev) => ({ ...prev, [m.id]: text })))
      .catch((e) => Alert.alert(t('chat.translateFailed'), errorMessage(e)))

  const showReactors = useMemo(
    () =>
      supportsReactionDetail(conversation)
        ? (m: ChatMessage, emoji: string, isSuper = false) =>
            void messagesApi
              .reactionUsers(m.id, emoji, isSuper)
              .then((users) => setReactors({ emoji, users }))
              .catch((e) => Alert.alert(t('chat.reactionsUnavailable'), errorMessage(e)))
        : undefined,
    [conversation, t],
  )

  const onPressAuthor = useCallback((userId: string) => router.push(userRoute(userId, serverId)), [serverId])
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
            serverId={serverId || undefined}
            channelId={channelId || undefined}
            thread={threadOf.get(item.id)}
            onOpenThread={openThread}
            onReactionLongPress={showReactors}
            translation={translations[item.id]}
            decor={serverId ? decorOf(item.authorId) : undefined}
          />
        </View>
      )
    },
    [conv.messages, me?.id, me?.username, onLongPress, react, onPressAuthor, highlightId, serverId, channelId, threadOf, openThread, showReactors, translations, decorOf],
  )

  const quickReactions = useMemo(
    () =>
      selected && !selected.pending && !selected.id.startsWith('tmp-') ? (
        <>
          {/* Seconde rangée : super réactions (salons de serveur, 10 par 24 h). */}
          {(conversation.kind === 'channel' ? [false, true] : [false]).map((isSuper) => (
            <View key={String(isSuper)} style={styles.quickRow}>
              {QUICK_REACTIONS.map((e) => (
                <Pressable
                  key={e}
                  style={[styles.quick, isSuper && styles.quickSuper]}
                  onPress={() => {
                    const m = selected
                    setSelected(null)
                    react(m, e, isSuper)
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t(isSuper ? 'chat.superReactTo' : 'chat.reactWith', { emoji: e })}
                >
                  <Text style={{ fontSize: 24 }}>{e}</Text>
                </Pressable>
              ))}
            </View>
          ))}
        </>
      ) : null,
    [selected, react, conversation.kind, t],
  )

  // Conversation inaccessible (lien vers une conversation dont on n'est pas membre) : pas de champ de saisie.
  const denied = !conv.messages.length && conv.error instanceof ApiError && (conv.error.status === 403 || conv.error.status === 404)
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
            header ?? <EmptyState icon="chatbubbles-outline" title={t('chat.start')} />
          ) : null
        }
        windowSize={11}
        initialNumToRender={20}
        removeClippedSubviews
      />
    )

  return (
    <CustomEmojiContext.Provider value={customEmojis}>
      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={topOffset} onLayout={onKavLayout} style={{ flex: 1, backgroundColor: colors.bg }}>
        {detached ? (
          <View style={styles.detached}>
            <Text style={styles.detachedText}>{t('chat.olderMessages')}</Text>
            <Button title={t('chat.backToPresent')} variant="ghost" icon="arrow-down" onPress={() => setDetached(false)} />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>{body}</View>
        <TypingIndicator conversationId={conv.id} />
        {denied ? null : (
          <Composer
            placeholder={placeholder}
            disabled={readOnly}
            disabledReason={readOnlyReason}
            replyTo={replyTo}
            editing={editing}
            onCancelReply={() => setReplyTo(null)}
            onCancelEdit={() => setEditing(null)}
            onSend={async (text, files, opts) => {
              const reply = replyTo
              setReplyTo(null)
              await conv.send(text, { replyTo: reply, files, expiresInSeconds: opts?.expiresInSeconds ?? null })
            }}
            onEdit={conv.edit}
            onTyping={conv.notifyTyping}
            draft={draft}
            onDraftChange={(text) => setDraft(conv.id, text)}
            mentionCandidates={mentionCandidates}
            myId={me?.id ?? null}
            serverId={serverId || undefined}
            channelId={channelId || undefined}
          />
        )}

        <Sheet
          visible={!!reactors}
          onClose={() => setReactors(null)}
          title={reactors ? t(reactors.users.length > 1 ? 'chat.reactorsMany' : 'chat.reactors', { emoji: reactors.emoji, n: reactors.users.length }) : undefined}
          actions={(reactors?.users ?? []).map((u) => ({
            label: u.username,
            icon: 'person-outline',
            leading: <Avatar uri={u.avatar} name={u.username} size={24} userId={u.id} />,
            onPress: () => router.push(`/user/${u.id}`),
          }))}
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
                  accessibilityLabel={t('chat.reactWith', { emoji: e })}
                >
                  <Text style={{ fontSize: 26 }}>{e}</Text>
                </Pressable>
              ))}
              {customEmojis.size ? <Text style={styles.paletteTitle}>{t('chat.serverEmojis')}</Text> : null}
              {[...customEmojis].map(([name, url]) => (
                <Pressable
                  key={`:${name}:`}
                  style={styles.paletteItem}
                  onPress={() => {
                    const m = paletteFor
                    setPaletteFor(null)
                    if (m) react(m, `:${name}:`)
                  }}
                  accessibilityLabel={t('chat.reactWith', { emoji: `:${name}:` })}
                >
                  <Image source={{ uri: url }} style={{ width: 28, height: 28 }} contentFit="contain" />
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Modal>
      </KeyboardAvoidingView>
    </CustomEmojiContext.Provider>
  )
}

const styles = StyleSheet.create({
  highlight: { backgroundColor: colors.primary + '33' },
  detached: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: spacing.lg, backgroundColor: colors.bgAlt },
  detachedText: { color: colors.textMuted, fontSize: font.sm, flexShrink: 1 },
  typing: { height: 20, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  typingText: { color: colors.textMuted, fontSize: font.xs, fontStyle: 'italic' },
  quickRow: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  quick: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.bgElevated, alignItems: 'center', justifyContent: 'center' },
  quickSuper: { borderWidth: 2, borderColor: SUPER_COLOR, backgroundColor: SUPER_COLOR + '33' },
  paletteBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.lg },
  palette: { backgroundColor: colors.bgAlt, borderRadius: radius.lg, padding: spacing.md, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  paletteTitle: { width: '100%', color: colors.textMuted, fontSize: font.xs, fontWeight: '700', textTransform: 'uppercase', marginTop: spacing.sm, paddingHorizontal: spacing.xs },
  paletteItem: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
})
