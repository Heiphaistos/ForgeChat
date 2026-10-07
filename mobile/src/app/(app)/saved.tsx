import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { messagesApi } from '@/api/messages'
import { Avatar } from '@/components/Avatar'
import { MessageText } from '@/components/MessageText'
import { EmptyState, ErrorState, IconButton, Loading } from '@/components/ui'
import { conversationId } from '@/features/chat/adapters'
import { savedConversation, type SavedItem } from '@/features/chat/messageExtras'
import { useScrollTarget } from '@/features/chat/pins'
import { formatShort } from '@/lib/format'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { useAuth } from '@/stores/auth'
import { colors, font, radius, spacing } from '@/theme'

export default function SavedScreen() {
  const t = useT()
  const myName = useAuth((s) => s.user?.username ?? '')
  const saved = useQuery({ queryKey: qk.saved, queryFn: messagesApi.saved })

  const open = (s: SavedItem) => {
    const ref = savedConversation(s)
    useScrollTarget.getState().request(conversationId(ref), s.messageId)
    if (ref.kind === 'channel') {
      router.push({ pathname: '/channel/[serverId]/[channelId]', params: { serverId: ref.serverId, channelId: ref.channelId, name: s.channelName ?? '' } })
    } else if (ref.kind === 'dm') {
      router.push(`/dm/${ref.dmId}`)
    }
  }

  const remove = (s: SavedItem) =>
    messagesApi
      .unsave(s.messageId)
      .then(() => queryClient.invalidateQueries({ queryKey: qk.saved }))
      .catch((e) => Alert.alert(t('common.actionFailed'), errorMessage(e)))

  if (saved.isLoading) return <Loading />
  if (saved.error) return <ErrorState message={errorMessage(saved.error)} onRetry={() => void saved.refetch()} />

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, flexGrow: 1 }}
      data={saved.data ?? []}
      keyExtractor={(s) => s.messageId}
      refreshControl={<RefreshControl refreshing={saved.isRefetching} onRefresh={() => void saved.refetch()} tintColor={colors.textMuted} />}
      ListEmptyComponent={<EmptyState icon="bookmark-outline" title={t('social.saved.empty')} subtitle={t('social.saved.emptyHint')} />}
      renderItem={({ item: s }) => (
        <Pressable
          onPress={() => open(s)}
          accessibilityRole="button"
          accessibilityHint={t('social.saved.openOriginal')}
          style={({ pressed }) => [styles.card, pressed && { backgroundColor: colors.bgHover }]}
        >
          <Text style={styles.where} numberOfLines={1}>
            {s.serverId ? `${s.serverName ?? t('social.saved.server')} · #${s.channelName ?? t('conv.channelFallback')}` : t('conv.dmFallback')}
          </Text>
          <View style={styles.head}>
            <Avatar uri={s.authorAvatar} name={s.authorName} size={24} />
            <Text style={styles.author} numberOfLines={1}>
              {s.authorName}
            </Text>
            {s.createdAt ? <Text style={styles.date}>{formatShort(s.createdAt)}</Text> : null}
            <IconButton icon="close" size={18} label={t('chat.unsave')} onPress={() => void remove(s)} />
          </View>
          {s.content ? (
            <MessageText content={s.content} myName={myName} />
          ) : (
            <Text style={styles.empty}>{s.attachments.length ? t('msg.attachment') : t('social.saved.noText')}</Text>
          )}
        </Pressable>
      )}
    />
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.bgAlt, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  where: { color: colors.textMuted, fontSize: font.xs, fontWeight: '600' },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  author: { flex: 1, color: colors.text, fontWeight: '700', fontSize: font.sm },
  date: { color: colors.textMuted, fontSize: font.xs },
  empty: { color: colors.textMuted, fontStyle: 'italic' },
})
