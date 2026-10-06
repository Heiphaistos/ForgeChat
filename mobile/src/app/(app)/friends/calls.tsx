import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { friendsApi, type CallEntry } from '@/api/friends'
import { Avatar } from '@/components/Avatar'
import { EmptyState, ErrorState, Loading } from '@/components/ui'
import { formatCallDuration } from '@/features/account/rules'
import { formatRelative } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { colors, font, spacing } from '@/theme'

function describe(c: CallEntry): { label: string; missed: boolean } {
  const missed = c.status === 'missed' || c.status === 'declined'
  const kind = c.call_type === 'video' ? 'Appel vidéo' : 'Appel'
  const dir = c.direction === 'outgoing' ? 'sortant' : missed ? 'manqué' : 'entrant'
  const dur = formatCallDuration(c.duration_s)
  return { label: `${kind} ${dir}${dur ? ` · ${dur}` : ''}`, missed: missed && c.direction === 'incoming' }
}

/** Historique des 50 derniers appels privés (friends::get_call_history). */
export default function CallHistoryScreen() {
  const q = useQuery({ queryKey: ['call-history'], queryFn: friendsApi.calls })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  return (
    <>
      <Stack.Screen options={{ title: 'Historique des appels' }} />
      <FlatList
        style={{ backgroundColor: colors.bg }}
        data={q.data ?? []}
        keyExtractor={(c) => c.id}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.textMuted} />}
        ListEmptyComponent={<EmptyState icon="call-outline" title="Aucun appel pour le moment" />}
        renderItem={({ item }) => {
          const d = describe(item)
          const open = () => (item.dm_id ? router.push(`/dm/${item.dm_id}`) : router.push(`/user/${item.other_user.id}`))
          return (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bgHover }]}
              onPress={open}
              accessibilityRole="button"
              accessibilityLabel={`${item.other_user.username}, ${d.label}, ${formatRelative(item.started_at)}`}
            >
              <Avatar uri={item.other_user.avatar} name={item.other_user.username} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.other_user.username}
                </Text>
                <Text style={[styles.sub, d.missed && { color: colors.danger }]}>{d.label}</Text>
              </View>
              <Ionicons
                name={item.direction === 'outgoing' ? 'arrow-up-outline' : 'arrow-down-outline'}
                size={16}
                color={d.missed ? colors.danger : colors.textMuted}
              />
              <Text style={styles.sub}>{formatRelative(item.started_at)}</Text>
            </Pressable>
          )
        }}
      />
    </>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  name: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  sub: { color: colors.textMuted, fontSize: font.sm },
})
