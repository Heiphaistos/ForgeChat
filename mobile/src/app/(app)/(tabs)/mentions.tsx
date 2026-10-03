import { useQuery } from '@tanstack/react-query'
import { router, useFocusEffect } from 'expo-router'
import { useCallback } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { usersApi } from '@/api/users'
import { Avatar } from '@/components/Avatar'
import { EmptyState, ErrorState, Loading } from '@/components/ui'
import { formatRelative } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { qk } from '@/lib/queryClient'
import { colors, font, radius, spacing } from '@/theme'

export default function MentionsScreen() {
  const q = useQuery({ queryKey: qk.mentions, queryFn: usersApi.mentions })
  // Le serveur ne renvoie que les mentions NON LUES : la liste change dès qu'on lit un salon ou
  // qu'une nouvelle mention arrive. Rechargée à chaque ouverture de l'onglet.
  const { refetch } = q
  useFocusEffect(
    useCallback(() => {
      void refetch()
    }, [refetch]),
  )
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      data={q.data ?? []}
      keyExtractor={(m) => m.message_id}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.textMuted} />}
      ListEmptyComponent={<EmptyState icon="at" title="Aucune mention non lue" subtitle="Les messages non lus qui te mentionnent (7 derniers jours) apparaîtront ici." />}
      renderItem={({ item }) => (
        <Pressable
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}
          onPress={() =>
            router.push({ pathname: '/channel/[serverId]/[channelId]', params: { serverId: item.server_id, channelId: item.channel_id, name: item.channel_name } })
          }
          accessibilityRole="button"
        >
          <Text style={styles.where} numberOfLines={1}>
            {item.server_name} · #{item.channel_name}
          </Text>
          <View style={styles.top}>
            <Avatar uri={item.author_avatar} name={item.author_username} size={28} />
            <Text style={styles.author}>{item.author_username}</Text>
            <Text style={styles.time}>{formatRelative(item.created_at)}</Text>
          </View>
          <Text style={styles.content} numberOfLines={4}>
            {item.content}
          </Text>
        </Pressable>
      )}
      contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
    />
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.bgAlt, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  where: { color: colors.textMuted, fontSize: font.xs, fontWeight: '700' },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  author: { color: colors.text, fontWeight: '700', flex: 1 },
  time: { color: colors.textFaint, fontSize: font.xs },
  content: { color: colors.textSecondary, fontSize: font.md },
})
