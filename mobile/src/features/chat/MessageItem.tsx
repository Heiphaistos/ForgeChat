import { Ionicons } from '@expo/vector-icons'
import { memo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Avatar } from '@/components/Avatar'
import { MessageText } from '@/components/MessageText'
import { formatDay, formatTime } from '@/lib/format'
import { mentionsUser } from '@/lib/markdown'
import type { ChatMessage } from '@/types/models'
import { colors, font, radius, spacing } from '@/theme'
import { Attachments } from './Attachments'

interface Props {
  message: ChatMessage
  grouped: boolean
  daySeparator: boolean
  myId: string
  myName: string
  onLongPress: (m: ChatMessage) => void
  onReact: (m: ChatMessage, emoji: string) => void
  onPressAuthor: (userId: string) => void
  onRetry: (m: ChatMessage) => void
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
              <Text style={styles.author} numberOfLines={1} onPress={() => onPressAuthor(m.authorId)}>
                {m.authorName}
              </Text>
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

          {m.content ? (
            <View style={m.pending ? { opacity: 0.6 } : undefined}>
              <MessageText content={m.content} myName={myName} />
            </View>
          ) : null}

          <Attachments items={m.attachments} pending={m.pending} />
          {m.awaitingAttachments && m.attachments.length === 0 ? <Text style={styles.meta}>Pièce jointe en cours d’envoi…</Text> : null}

          {m.editedAt ? <Text style={styles.meta}>(modifié)</Text> : null}
          {m.pinned ? <Text style={styles.meta}>📌 Épinglé</Text> : null}

          {m.failed ? (
            <Pressable onPress={() => onRetry(m)} style={styles.failed} accessibilityRole="button">
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={{ color: colors.danger, fontSize: font.sm }}>Échec de l’envoi — toucher pour les options</Text>
            </Pressable>
          ) : null}

          {m.reactions.length ? (
            <View style={styles.reactions}>
              {m.reactions.map((r) => (
                <Pressable
                  key={r.emoji}
                  onPress={() => onReact(m, r.emoji)}
                  style={[styles.reaction, r.me && styles.reactionMine]}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.emoji} ${r.count}${r.me ? ', ta réaction' : ''}`}
                >
                  <Text style={{ fontSize: 15 }}>{r.emoji}</Text>
                  <Text style={[styles.reactionCount, r.me && { color: colors.text }]}>{r.count}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      </Pressable>
    </View>
  )
})

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
  reactionMine: { borderColor: colors.primary, backgroundColor: 'rgba(88,101,242,0.2)' },
  reactionCount: { color: colors.textMuted, fontSize: font.sm, fontWeight: '600' },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, marginTop: spacing.lg },
  dayLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  dayText: { color: colors.textMuted, fontSize: font.xs, fontWeight: '700' },
})
