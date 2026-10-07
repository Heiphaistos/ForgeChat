import { useQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { moderationApi } from '@/api/moderation'
import { Avatar } from '@/components/Avatar'
import { ErrorState, Loading, Row, TextField } from '@/components/ui'
import { useT } from '@/i18n'
import { formatShort } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { colors, spacing } from '@/theme'

/** Liste détaillée des membres (arrivée, rôles, tags) ; toucher un membre ouvre sa gestion. */
export default function MembersAdminScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const sid = ids.serverId ?? ''
  const q = useQuery({ queryKey: ['members-detailed', sid], queryFn: () => moderationApi.membersDetailed(sid), enabled: valid })
  const [search, setSearch] = useState('')
  const t = useT()
  const list = useMemo(() => {
    const n = search.trim().toLowerCase()
    return (q.data ?? [])
      .filter((m) => !n || m.username.toLowerCase().includes(n) || m.nickname?.toLowerCase().includes(n))
      .sort((a, b) => a.username.localeCompare(b.username))
  }, [q.data, search])

  if (!valid) return <ErrorState message={t('serverSettings.invalidServer')} />
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: t('serverSettings.membersCount', { n: q.data?.length ?? 0 }) }} />
      <View style={{ padding: spacing.md }}>
        <TextField value={search} onChangeText={setSearch} placeholder={t('serverSettings.searchMember')} accessibilityLabel={t('serverSettings.searchMember')} autoCapitalize="none" autoCorrect={false} />
      </View>
      <FlatList
        data={list}
        keyExtractor={(m) => m.user_id}
        renderItem={({ item: m }) => (
          <Row
            title={m.is_owner ? t('serverSettings.members.owner', { name: m.nickname || m.username }) : m.nickname || m.username}
            subtitle={[t('serverSettings.members.joined', { date: formatShort(m.joined_at) }), m.roles.map((r) => r.name).join(', '), m.tags.map((tag) => `[${tag.name}]`).join(' ')]
              .filter(Boolean)
              .join(' · ')}
            right={<Avatar uri={m.avatar} name={m.username} size={36} />}
            chevron
            onPress={() => router.push({ pathname: '/server/[serverId]/settings/member/[userId]', params: { serverId: sid, userId: m.user_id } })}
          />
        )}
      />
    </View>
  )
}
