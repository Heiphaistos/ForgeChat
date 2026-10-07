import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { messagesApi } from '@/api/messages'
import { Avatar } from '@/components/Avatar'
import { MessageText } from '@/components/MessageText'
import { useT } from '@/i18n'
import type { ChatMessage } from '@/types/models'
import { colors, font, radius, spacing } from '@/theme'

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

/**
 * Messages système du lot communauté. Bienvenue : carte dessinée ici (avatar, pseudo,
 * numéro de membre). Starboard : seule une RÉFÉRENCE est publiée, le message mis en
 * avant est rechargé depuis son salon et déchiffré sur l'appareil.
 */
export function SystemCard({ m, serverId }: { m: ChatMessage; serverId: string }) {
  const t = useT()
  const meta = m.system?.meta ?? {}
  if (m.system?.kind === 'welcome') {
    const n = typeof meta.member_number === 'number' ? meta.member_number : null
    return (
      <View style={[styles.card, { backgroundColor: colors.primary }]} accessibilityRole="summary">
        <Avatar uri={m.authorAvatar} name={m.authorName} size={56} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('community.welcome.cardTitle', { name: m.authorName })}</Text>
          {m.content ? <Text style={styles.text}>{m.content}</Text> : null}
          {n ? <Text style={styles.footer}>{t('community.welcome.memberNumber', { n })}</Text> : null}
        </View>
      </View>
    )
  }
  return <Starboard serverId={serverId} channelId={str(meta.source_channel_id)} messageId={str(meta.source_message_id)} emoji={str(meta.emoji) ?? '⭐'} label={m.content} />
}

function Starboard({ serverId, channelId, messageId, emoji, label }: { serverId: string; channelId?: string; messageId?: string; emoji: string; label: string | null }) {
  const t = useT()
  const q = useQuery({
    queryKey: ['starboard_ref', messageId],
    enabled: !!channelId && !!messageId,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const list = await messagesApi.around({ kind: 'channel', serverId, channelId: channelId!, }, messageId!)
      return list.find((x) => x.id === messageId) ?? null
    },
  })
  const src = q.data
  const stars = src?.reactions.find((r) => r.emoji === emoji)?.count
  return (
    <View style={styles.star}>
      <Text style={styles.starHead} numberOfLines={1}>{emoji} {stars ?? ''} · {label ?? ''}</Text>
      {src ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Avatar uri={src.authorAvatar} name={src.authorName} size={28} />
          <View style={{ flex: 1 }}>
            <Text style={styles.starAuthor}>{src.authorName}</Text>
            <MessageText content={src.content ?? ''} myName="" />
          </View>
        </View>
      ) : (
        <Text style={styles.muted}>{q.isError || src === null ? t('community.starboard.unavailable') : '…'}</Text>
      )}
      {channelId ? (
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/channel/[serverId]/[channelId]', params: { serverId, channelId } })}>
          <Text style={styles.link}>{t('community.starboard.jump')}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, marginTop: spacing.xs },
  title: { color: '#fff', fontSize: font.lg, fontWeight: '700' },
  text: { color: 'rgba(255,255,255,0.9)', fontSize: font.md, marginTop: 2 },
  footer: { color: 'rgba(255,255,255,0.75)', fontSize: font.sm, marginTop: spacing.xs },
  star: { borderLeftWidth: 4, borderLeftColor: '#facc15', backgroundColor: colors.bgAlt, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, marginTop: spacing.xs },
  starHead: { color: colors.textMuted, fontSize: font.sm },
  starAuthor: { color: colors.text, fontWeight: '700', fontSize: font.md },
  muted: { color: colors.textFaint, fontSize: font.sm, fontStyle: 'italic' },
  link: { color: colors.primary, fontSize: font.sm },
})
