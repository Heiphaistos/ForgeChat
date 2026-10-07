import { useQuery } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { ScrollView } from 'react-native'
import { usersApi } from '@/api/users'
import { ErrorState, Loading, Row, Section } from '@/components/ui'
import { formatDay } from '@/lib/format'
import { useLang, useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { colors, spacing } from '@/theme'

/** Statistiques personnelles (users::get_my_stats). */
export default function StatsScreen() {
  const t = useT()
  const locale = useLang((st) => (st.lang === 'fr' ? 'fr-FR' : 'en-US'))
  const n = (v: number) => v.toLocaleString(locale)
  const q = useQuery({ queryKey: ['my-stats'], queryFn: usersApi.stats })
  if (q.isLoading) return <Loading />
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  const s = q.data
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }}>
      <Stack.Screen options={{ title: t('settings.stats.title') }} />
      <Section>
        <Row icon="chatbubble-outline" title={t('settings.stats.messages')} subtitle={n(s.messages_sent)} />
        <Row icon="server-outline" title={t('settings.stats.servers')} subtitle={n(s.servers_joined)} />
        <Row icon="people-outline" title={t('settings.stats.friends')} subtitle={n(s.friends_count)} />
        <Row icon="happy-outline" title={t('settings.stats.reactionsGiven')} subtitle={n(s.reactions_given)} />
        <Row icon="heart-outline" title={t('settings.stats.reactionsReceived')} subtitle={n(s.reactions_received)} />
        <Row icon="calendar-outline" title={t('settings.stats.memberSince')} subtitle={formatDay(s.member_since)} />
      </Section>
    </ScrollView>
  )
}
