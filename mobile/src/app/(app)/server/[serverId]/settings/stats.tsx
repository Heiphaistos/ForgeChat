import { useQuery } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { RefreshControl, ScrollView, View } from 'react-native'
import { moderationApi } from '@/api/moderation'
import { ErrorState, Loading, Row, Section, T } from '@/components/ui'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { colors, spacing } from '@/theme'

/** Statistiques du serveur (MANAGE_SERVER) : membres, messages, salons les plus actifs, activité par heure. */
export default function StatsScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const sid = ids.serverId ?? ''
  const q = useQuery({ queryKey: ['server-stats', sid], queryFn: () => moderationApi.stats(sid), enabled: valid })
  if (!valid) return <ErrorState message="Serveur invalide." />
  if (q.isLoading) return <Loading />
  if (!q.data) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  const s = q.data
  const hours = s.active_hours.length === 24 ? s.active_hours : Array<number>(24).fill(0)
  const max = Math.max(1, ...hours)
  const peak = hours.indexOf(Math.max(...hours))

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg }}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.textMuted} />}
    >
      <Stack.Screen options={{ title: 'Statistiques' }} />
      <Section title="Membres">
        <Row icon="people-outline" title="Membres" right={<T>{s.member_count}</T>} />
        <Row icon="radio-button-on-outline" title="En ligne" right={<T>{s.online_count}</T>} />
        <Row icon="person-add-outline" title="Arrivées (24 h / 7 j)" right={<T>{`${s.new_members_today} / ${s.new_members_week}`}</T>} />
      </Section>
      <Section title="Activité">
        <Row icon="chatbubbles-outline" title="Messages (24 h / 7 j)" right={<T>{`${s.message_count_today} / ${s.message_count_week}`}</T>} />
        <Row icon="list-outline" title="Salons" right={<T>{s.channel_count}</T>} />
      </Section>
      <Section title="Salons les plus actifs (7 j)">
        {s.top_channels.length ? (
          s.top_channels.map((c) => <Row key={c.id} icon="chatbubble-outline" title={c.name} right={<T>{c.messages}</T>} />)
        ) : (
          <Row title="Aucun message cette semaine" />
        )}
      </Section>
      <Section title="Messages par heure (24 h)" footer={hours[peak] ? `Pic d'activité vers ${peak} h (heure du serveur).` : undefined}>
        <View
          style={{ flexDirection: 'row', alignItems: 'flex-end', height: 100, gap: 2, padding: spacing.md }}
          accessible
          accessibilityLabel={hours[peak] ? `Pic d'activité vers ${peak} heures, ${hours[peak]} messages` : 'Aucune activité'}
        >
          {hours.map((n, h) => (
            <View key={h} style={{ flex: 1, height: `${Math.max(2, (n / max) * 100)}%`, backgroundColor: n ? colors.primary : colors.bgHover, borderRadius: 2 }} />
          ))}
        </View>
      </Section>
    </ScrollView>
  )
}
