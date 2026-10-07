import { useQuery } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { messagesApi } from '@/api/messages'
import { Avatar } from '@/components/Avatar'
import { MessageText } from '@/components/MessageText'
import { EmptyState, ErrorState, IconButton, Loading } from '@/components/ui'
import { conversationId } from '@/features/chat/adapters'
import { conversationRefFromParams, useScrollTarget, type PinnedItem } from '@/features/chat/pins'
import { formatShort } from '@/lib/format'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { useAuth } from '@/stores/auth'
import { colors, font, radius, spacing } from '@/theme'

export default function PinsScreen() {
  const t = useT()
  const raw = useLocalSearchParams<Record<string, string>>()
  const ref = conversationRefFromParams(raw)
  const id = ref ? conversationId(ref) : ''
  const myName = useAuth((s) => s.user?.username ?? '')
  const pins = useQuery({ queryKey: qk.pins(id), queryFn: () => messagesApi.pins(ref!), enabled: !!ref })
  if (!ref) return <ErrorState message={t('social.pins.invalid')} />

  const open = (p: PinnedItem) => {
    useScrollTarget.getState().request(id, p.messageId)
    router.back()
  }

  const unpin = (p: PinnedItem) =>
    Alert.alert(t('social.pins.unpinConfirm'), p.content?.slice(0, 120) ?? undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('chat.unpin'),
        style: 'destructive',
        onPress: () =>
          messagesApi
            .pin(ref, p.messageId, false)
            .then(() => queryClient.invalidateQueries({ queryKey: qk.pins(id) }))
            .catch((e) => Alert.alert(t('common.actionFailed'), errorMessage(e))),
      },
    ])

  if (pins.isLoading) return <Loading />
  if (pins.error) return <ErrorState message={errorMessage(pins.error)} onRetry={() => void pins.refetch()} />

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, flexGrow: 1 }}
      data={pins.data ?? []}
      keyExtractor={(p) => p.messageId}
      refreshControl={<RefreshControl refreshing={pins.isRefetching} onRefresh={() => void pins.refetch()} tintColor={colors.textMuted} />}
      ListEmptyComponent={<EmptyState icon="pin-outline" title={t('social.pins.empty')} />}
      renderItem={({ item: p }) => (
        <Pressable
          onPress={() => open(p)}
          accessibilityRole="button"
          accessibilityHint={t('social.pins.goTo')}
          style={({ pressed }) => [styles.card, pressed && { backgroundColor: colors.bgHover }]}
        >
          <View style={styles.head}>
            <Avatar uri={p.authorAvatar} name={p.authorName} size={24} />
            <Text style={styles.author} numberOfLines={1}>
              {p.authorName}
            </Text>
            <Text style={styles.date}>{formatShort(p.createdAt)}</Text>
            <IconButton icon="close" size={18} label={t('chat.unpin')} onPress={() => unpin(p)} />
          </View>
          {p.content ? <MessageText content={p.content} myName={myName} /> : <Text style={styles.empty}>{t('msg.attachment')}</Text>}
        </Pressable>
      )}
    />
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.bgAlt, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  author: { flex: 1, color: colors.text, fontWeight: '700', fontSize: font.sm },
  date: { color: colors.textMuted, fontSize: font.xs },
  empty: { color: colors.textMuted, fontStyle: 'italic' },
})
