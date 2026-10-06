import { useQuery } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { ScrollView } from 'react-native'
import { usersApi } from '@/api/users'
import { ErrorState, Loading, Row, Section } from '@/components/ui'
import { formatDay } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { colors, spacing } from '@/theme'

const n = (v: number) => v.toLocaleString('fr-FR')

/** Statistiques personnelles (users::get_my_stats). */
export default function StatsScreen() {
  const q = useQuery({ queryKey: ['my-stats'], queryFn: usersApi.stats })
  if (q.isLoading) return <Loading />
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  const s = q.data
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }}>
      <Stack.Screen options={{ title: 'Mes statistiques' }} />
      <Section>
        <Row icon="chatbubble-outline" title="Messages envoyés" subtitle={n(s.messages_sent)} />
        <Row icon="server-outline" title="Serveurs rejoints" subtitle={n(s.servers_joined)} />
        <Row icon="people-outline" title="Amis" subtitle={n(s.friends_count)} />
        <Row icon="happy-outline" title="Réactions données" subtitle={n(s.reactions_given)} />
        <Row icon="heart-outline" title="Réactions reçues" subtitle={n(s.reactions_received)} />
        <Row icon="calendar-outline" title="Membre depuis" subtitle={formatDay(s.member_since)} />
      </Section>
    </ScrollView>
  )
}
