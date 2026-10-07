import { useQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { serversApi } from '@/api/servers'
import { userRoute } from '@/features/servers/memberProfile'
import { Avatar } from '@/components/Avatar'
import { ErrorState, Loading } from '@/components/ui'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk } from '@/lib/queryClient'
import { usePresence } from '@/stores/presence'
import { colors, font, radius, spacing } from '@/theme'

export default function MembersScreen() {
  // `manage=1` : ouvert depuis les paramètres du serveur, toucher un membre ouvre sa gestion.
  const { valid, ids, text } = useRouteParams(['serverId'] as const, ['manage'])
  const manage = text.manage === '1'
  const q = useQuery({ queryKey: qk.members(ids.serverId ?? ''), queryFn: () => serversApi.members(ids.serverId), enabled: valid })
  const statuses = usePresence((s) => s.statuses)
  const [search, setSearch] = useState('')

  const sorted = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const list = (q.data ?? []).filter((m) => !needle || m.username.toLowerCase().includes(needle) || m.nickname?.toLowerCase().includes(needle))
    const online = (id: string, fallback?: string) => {
      const s = statuses[id] ?? fallback ?? 'offline'
      return s !== 'offline' && s !== 'invisible'
    }
    return [...list].sort((a, b) => Number(online(b.user_id, b.status)) - Number(online(a.user_id, a.status)) || a.username.localeCompare(b.username))
  }, [q.data, statuses, search])

  if (!valid) return <ErrorState message="Serveur invalide." />
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {manage ? <Stack.Screen options={{ title: 'Gérer les membres' }} /> : null}
      <TextInput
        style={styles.search}
        placeholder="Rechercher un membre"
        placeholderTextColor={colors.textFaint}
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <FlatList
        data={sorted}
        keyExtractor={(m) => m.user_id}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() =>
              manage
                ? router.push({ pathname: '/server/[serverId]/settings/member/[userId]', params: { serverId: ids.serverId, userId: item.user_id } })
                : router.push(userRoute(item.user_id, ids.serverId))
            }
            accessibilityRole="button"
            accessibilityLabel={`${item.nickname || item.username}${item.is_owner ? ', propriétaire' : ''}`}
          >
            <Avatar uri={item.avatar} name={item.username} userId={item.user_id} status={item.status} showStatus size={38} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>
                {item.nickname || item.username} {item.is_owner ? '👑' : ''}
              </Text>
              {item.nickname ? <Text style={styles.sub}>{item.username}</Text> : null}
            </View>
          </Pressable>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  search: { margin: spacing.md, backgroundColor: colors.bgDeep, color: colors.text, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  name: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  sub: { color: colors.textMuted, fontSize: font.xs },
})
