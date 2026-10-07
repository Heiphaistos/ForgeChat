import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { memo, useEffect, useState, type ReactNode } from 'react'
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native'
import { Avatar } from '@/components/Avatar'
import { MessageText } from '@/components/MessageText'
import { formatDay, formatTime } from '@/lib/format'
import { mentionsUser, previewUrl } from '@/lib/markdown'
import type { ChatMessage, Reaction } from '@/types/models'
import { colors, font, radius, spacing } from '@/theme'
import { isVoiceAttachment, isVoiceMessageText, parseSticker, remainingLabel, remoteGif } from '@/features/composer/formats'
import { openExternalUrl } from '@/lib/links'
import { RoleIcon } from '@/features/servers/roleDecor'
import type { RoleDecor } from '@/features/servers/perms'
import { Attachments } from './Attachments'
import { LinkPreview } from './LinkPreview'
import { PollCard } from './PollCard'
import type { ThreadSummary } from './threads'
import { reactionEmojiName, safeEmojiUrl, useCustomEmojis } from './customEmojis'

interface Props {
  message: ChatMessage
  grouped: boolean
  daySeparator: boolean
  myId: string
  myName: string
  onLongPress: (m: ChatMessage) => void
  onReact: (m: ChatMessage, emoji: string, isSuper?: boolean) => void
  onPressAuthor: (userId: string) => void
  onRetry: (m: ChatMessage) => void
  /** Salon courant (sondages) ; absent en DM et groupe. */
  serverId?: string
  channelId?: string
  /** Fil ouvert depuis ce message (salons). */
  thread?: ThreadSummary
  onOpenThread?: (m: ChatMessage) => void
  /** Appui long sur une réaction : qui a réagi (salons et DM). */
  onReactionLongPress?: (m: ChatMessage, emoji: string, isSuper?: boolean) => void
  /** Traduction demandée depuis le menu du message. */
  translation?: string
  /** Couleur et icône du rôle de l'auteur (salons). */
  decor?: RoleDecor
}

/**
 * Contenu spécial envoyé par la barre de saisie (web ou app) : sticker ou GIF Tenor. null = texte
 * normal. Les GIF sont les SEULES images chargées depuis un service externe (GIPHY, Wikimedia ; Tenor et KLIPY pour les anciens messages).
 */
function SpecialContent({ content, pending, onLongPress }: { content: string; pending?: boolean; onLongPress?: () => void }) {
  const sticker = parseSticker(content)
  if (sticker) {
    if (sticker.emoji !== undefined) {
      return (
        <Text style={styles.stickerEmoji} accessibilityLabel={`Sticker ${sticker.name}`}>
          {sticker.emoji}
        </Text>
      )
    }
    const src = safeEmojiUrl(sticker.url)
    return src ? (
      <Image source={{ uri: src }} style={[styles.stickerImage, pending && { opacity: 0.6 }]} contentFit="contain" accessibilityLabel={`Sticker ${sticker.name}`} />
    ) : (
      <Text style={styles.meta}>[sticker {sticker.name}]</Text>
    )
  }
  const gif = remoteGif(content)
  return gif ? <RemoteGif url={gif.url} provider={gif.provider} onLongPress={onLongPress} /> : null
}

/** GIF animé (GIPHY, Wikimedia, Tenor ou KLIPY) ; introuvable ou hors ligne → simple lien (comme un message texte). */
function RemoteGif({ url, provider, onLongPress }: { url: string; provider: string; onLongPress?: () => void }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <MessageText content={url} myName="" />
  return (
    <Pressable
      onPress={() => void openExternalUrl(url)}
      onLongPress={onLongPress}
      delayLongPress={300}
      accessibilityRole="imagebutton"
      accessibilityLabel={`GIF (${provider})`}
    >
      <Image source={{ uri: url }} style={styles.gif} contentFit="contain" autoplay cachePolicy="memory-disk" onError={() => setFailed(true)} />
      <Text style={styles.meta}>GIF via {provider}</Text>
    </Pressable>
  )
}

/** « ⏱ disparaît dans 4 min », rafraîchi toutes les 30 s. */
function ExpiryBadge({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const left = remainingLabel(expiresAt, now)
  return (
    <Text style={[styles.meta, { color: colors.danger }]} accessibilityLabel={`Message éphémère, disparaît dans ${left}`}>
      ⏱ disparaît dans {left}
    </Text>
  )
}

/** Réaction : emoji Unicode, ou « :nom: » affiché en image si le serveur le connaît. */
function ReactionEmoji({ emoji }: { emoji: string }) {
  const emojis = useCustomEmojis()
  const name = reactionEmojiName(emoji)
  const url = name ? emojis.get(name) : undefined
  if (url) return <Image source={{ uri: url }} style={{ width: 18, height: 18 }} contentFit="contain" accessibilityLabel={emoji} />
  return <Text style={{ fontSize: 15 }}>{emoji}</Text>
}

/** Super réaction : l'emoji jaillit (agrandi, pivoté) à l'apparition et à chaque changement de `trigger`. */
function SuperBurst({ trigger, children }: { trigger: string; children: ReactNode }) {
  const [v] = useState(() => new Animated.Value(0))
  useEffect(() => {
    let cancelled = false
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled || reduce) return
      v.setValue(0)
      Animated.timing(v, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }).start()
    })
    return () => {
      cancelled = true
    }
  }, [trigger, v])
  const scale = v.interpolate({ inputRange: [0, 0.3, 0.6, 1], outputRange: [1, 1.9, 0.9, 1] })
  const rotate = v.interpolate({ inputRange: [0, 0.3, 0.6, 1], outputRange: ['0deg', '-12deg', '8deg', '0deg'] })
  return <Animated.View style={{ transform: [{ scale }, { rotate }] }}>{children}</Animated.View>
}

/** Pastille de réaction ; une super réaction rejoue son animation au toucher et à chaque nouveau compte. */
function ReactionChip({
  m,
  r,
  onReact,
  onReactionLongPress,
}: {
  m: ChatMessage
  r: Reaction
  onReact: Props['onReact']
  onReactionLongPress: Props['onReactionLongPress']
}) {
  const [replay, setReplay] = useState(0)
  const isSuper = !!r.is_super
  return (
    <Pressable
      onPressIn={isSuper ? () => setReplay((n) => n + 1) : undefined}
      onPress={() => onReact(m, r.emoji, isSuper)}
      onLongPress={onReactionLongPress ? () => onReactionLongPress(m, r.emoji, isSuper) : undefined}
      accessibilityHint={onReactionLongPress ? 'Appui long pour voir qui a réagi' : undefined}
      style={[styles.reaction, r.me && styles.reactionMine, isSuper && styles.reactionSuper]}
      accessibilityRole="button"
      accessibilityLabel={`${isSuper ? 'Super réaction ' : ''}${r.emoji} ${r.count}${r.me ? ', ta réaction' : ''}`}
    >
      {isSuper ? (
        <SuperBurst trigger={`${r.count}:${replay}`}>
          <ReactionEmoji emoji={r.emoji} />
        </SuperBurst>
      ) : (
        <ReactionEmoji emoji={r.emoji} />
      )}
      <Text style={[styles.reactionCount, r.me && { color: colors.text }]}>{r.count}</Text>
    </Pressable>
  )
}

/** Texte du message, puis l'aperçu de son premier lien (pas pendant l'envoi). */
function TextWithPreview({ content, myName, pending }: { content: string; myName: string; pending?: boolean }) {
  const url = pending ? null : previewUrl(content)
  return (
    <>
      <MessageText content={content} myName={myName} />
      {url ? <LinkPreview url={url} /> : null}
    </>
  )
}

export const MessageItem = memo(function MessageItem({
  message: m,
  grouped,
  daySeparator,
  myId,
  myName,
  onLongPress,
  onReact,
  onPressAuthor,
  onRetry,
  serverId,
  channelId,
  thread,
  onOpenThread,
  onReactionLongPress,
  translation,
  decor,
}: Props) {
  const mentioned = m.authorId !== myId && mentionsUser(m.content, myId, myName)
  return (
    <View>
      {daySeparator ? (
        <View style={styles.dayRow} accessibilityRole="header">
          <View style={styles.dayLine} />
          <Text style={styles.dayText}>{formatDay(m.createdAt)}</Text>
          <View style={styles.dayLine} />
        </View>
      ) : null}
      <Pressable
        onLongPress={() => onLongPress(m)}
        delayLongPress={300}
        style={({ pressed }) => [
          styles.row,
          grouped ? styles.rowGrouped : null,
          mentioned && styles.mentioned,
          pressed && { backgroundColor: colors.bgAlt },
        ]}
        accessibilityHint="Appui long pour les actions"
      >
        <View style={styles.gutter}>
          {grouped ? null : (
            <Pressable onPress={() => onPressAuthor(m.authorId)} accessibilityRole="button" accessibilityLabel={`Profil de ${m.authorName}`}>
              <Avatar uri={m.authorAvatar} name={m.authorName} size={40} />
            </Pressable>
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          {grouped ? null : (
            <View style={styles.header}>
              <Text style={[styles.author, decor?.color ? { color: decor.color } : null]} numberOfLines={1} onPress={() => onPressAuthor(m.authorId)}>
                {m.authorName}
              </Text>
              <RoleIcon icon={decor?.icon} title={decor?.iconTitle} />
              {m.authorIsBot ? <Text style={styles.bot}>BOT</Text> : null}
              <Text style={styles.time}>{formatTime(m.createdAt)}</Text>
            </View>
          )}

          {m.reply ? (
            <View style={styles.reply}>
              <Ionicons name="return-down-forward" size={14} color={colors.textFaint} />
              <Text style={styles.replyText} numberOfLines={1}>
                <Text style={{ fontWeight: '700' }}>{m.reply.authorName ?? 'Message'} </Text>
                {m.reply.content ?? 'Pièce jointe'}
              </Text>
            </View>
          ) : null}

          {m.forwardedFrom ? <Text style={styles.forward}>↪ Transféré de {m.forwardedFrom}</Text> : null}

          {m.content && !(isVoiceMessageText(m.content) && m.attachments.some(isVoiceAttachment)) ? (
            <View style={m.pending ? { opacity: 0.6 } : undefined}>
              {SpecialContent({ content: m.content, pending: m.pending, onLongPress: () => onLongPress(m) }) ?? <TextWithPreview content={m.content} myName={myName} pending={m.pending} />}
            </View>
          ) : null}

          {translation ? (
            <View style={styles.translation} accessibilityLabel={`Traduction : ${translation}`}>
              <Text style={styles.meta}>Traduction</Text>
              <MessageText content={translation} myName={myName} />
            </View>
          ) : null}

          {m.pollId && serverId && channelId ? <PollCard serverId={serverId} channelId={channelId} pollId={m.pollId} myId={myId} /> : null}

          <Attachments items={m.attachments} pending={m.pending} onLongPress={() => onLongPress(m)} />
          {m.awaitingAttachments && m.attachments.length === 0 ? <Text style={styles.meta}>Pièce jointe en cours d’envoi…</Text> : null}

          {m.editedAt ? <Text style={styles.meta}>(modifié)</Text> : null}
          {m.expiresAt ? <ExpiryBadge expiresAt={m.expiresAt} /> : null}
          {m.pinned ? <Text style={styles.meta}>📌 Épinglé</Text> : null}

          {m.failed ? (
            <Pressable onPress={() => onRetry(m)} style={styles.failed} accessibilityRole="button">
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={{ color: colors.danger, fontSize: font.sm }}>Échec de l’envoi — toucher pour les options</Text>
            </Pressable>
          ) : null}

          {thread && onOpenThread ? (
            <Pressable
              onPress={() => onOpenThread(m)}
              style={styles.thread}
              accessibilityRole="button"
              accessibilityLabel={`Ouvrir le fil ${thread.title}, ${thread.messageCount} message${thread.messageCount > 1 ? 's' : ''}`}
            >
              <Ionicons name="chatbubbles-outline" size={14} color={colors.primary} />
              <Text style={styles.threadTitle} numberOfLines={1}>
                {thread.title}
              </Text>
              <Text style={[styles.meta, { marginTop: 0 }]}>
                {thread.messageCount} message{thread.messageCount > 1 ? 's' : ''}
                {thread.unreadCount ? ` · ${thread.unreadCount} non lu${thread.unreadCount > 1 ? 's' : ''}` : ''}
              </Text>
            </Pressable>
          ) : null}

          {m.reactions.length ? (
            <View style={styles.reactions}>
              {m.reactions.map((r) => (
                <ReactionChip key={`${r.is_super ? 's' : 'n'}:${r.emoji}`} m={m} r={r} onReact={onReact} onReactionLongPress={onReactionLongPress} />
              ))}
            </View>
          ) : null}
        </View>
      </Pressable>
    </View>
  )
})

/** Couleur des super réactions (même teinte que le web). */
export const SUPER_COLOR = '#d946ef'

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: 2, gap: spacing.md },
  rowGrouped: { paddingTop: 2 },
  mentioned: { backgroundColor: colors.mention, borderLeftWidth: 2, borderLeftColor: colors.warning },
  gutter: { width: 40 },
  header: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginBottom: 2 },
  author: { color: colors.text, fontWeight: '700', fontSize: font.md, flexShrink: 1 },
  bot: { backgroundColor: colors.primary, color: '#fff', fontSize: 9, fontWeight: '800', paddingHorizontal: 4, borderRadius: 3, overflow: 'hidden' },
  time: { color: colors.textFaint, fontSize: font.xs },
  reply: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  replyText: { color: colors.textMuted, fontSize: font.sm, flex: 1 },
  forward: { color: colors.textMuted, fontSize: font.xs, fontStyle: 'italic' },
  meta: { color: colors.textFaint, fontSize: font.xs, marginTop: 2 },
  translation: { marginTop: 4, paddingLeft: spacing.sm, borderLeftWidth: 2, borderLeftColor: colors.primary },
  thread: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, alignSelf: 'flex-start', maxWidth: '100%', backgroundColor: colors.bgAlt, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 5 },
  threadTitle: { color: colors.text, fontSize: font.sm, fontWeight: '600', flexShrink: 1 },
  failed: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  reaction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.bgAlt,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  reactionMine: { borderColor: colors.primary, backgroundColor: colors.primary + '33' },
  reactionSuper: { borderColor: SUPER_COLOR, backgroundColor: SUPER_COLOR + '33' },
  reactionCount: { color: colors.textMuted, fontSize: font.sm, fontWeight: '600' },
  stickerEmoji: { fontSize: 64, lineHeight: 76 },
  stickerImage: { width: 120, height: 120 },
  gif: { width: 220, height: 165, borderRadius: radius.md, backgroundColor: colors.bgElevated },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, marginTop: spacing.lg },
  dayLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  dayText: { color: colors.textMuted, fontSize: font.xs, fontWeight: '700' },
})
