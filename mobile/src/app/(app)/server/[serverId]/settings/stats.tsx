import { useQuery } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { RefreshControl, ScrollView, View } from 'react-native'
import { communityApi } from '@/api/community'
import { moderationApi } from '@/api/moderation'
import { ErrorState, Loading, Row, Section, T } from '@/components/ui'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { colors, spacing } from '@/theme'

/** Statistiques du serveur (MANAGE_SERVER) : membres, messages, salons les plus actifs, activité par heure. */
export default function StatsScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const sid = ids.serverId ?? ''
  const t = useT()
  const q = useQuery({ queryKey: ['server-stats', sid], queryFn: () => moderationApi.stats(sid), enabled: valid })
  const history = useQuery({ queryKey: ['server-stats-history', sid], queryFn: () => communityApi.stats(sid, 30), enabled: valid })
  if (!valid) return <ErrorState message={t('serverSettings.invalidServer')} />
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
      <Stack.Screen options={{ title: t('serverSettings.title.stats') }} />
      <Section title={t('screen.members')}>
        <Row icon="people-outline" title={t('screen.members')} right={<T>{s.member_count}</T>} />
        <Row icon="radio-button-on-outline" title={t('status.online')} right={<T>{s.online_count}</T>} />
        <Row icon="person-add-outline" title={t('serverSettings.stats.joins')} right={<T>{`${s.new_members_today} / ${s.new_members_week}`}</T>} />
      </Section>
      <Section title={t('serverSettings.stats.activity')}>
        <Row icon="chatbubbles-outline" title={t('serverSettings.stats.messages')} right={<T>{`${s.message_count_today} / ${s.message_count_week}`}</T>} />
        <Row icon="list-outline" title={t('serverSettings.channelsLabel')} right={<T>{s.channel_count}</T>} />
      </Section>
      <Section title={t('serverSettings.stats.topChannels')}>
        {s.top_channels.length ? (
          s.top_channels.map((c) => <Row key={c.id} icon="chatbubble-outline" title={c.name} right={<T>{c.messages}</T>} />)
        ) : (
          <Row title={t('serverSettings.stats.noMessagesWeek')} />
        )}
      </Section>
      {history.data ? (
        <>
          <Bars title={t('community.stats.members')} values={history.data.series.map((d) => d.members)} />
          <Bars title={t('community.stats.messages')} values={history.data.series.map((d) => d.messages)} />
          <Bars title={t('community.stats.voice')} values={history.data.series.map((d) => d.voice_minutes)} footer={t('community.stats.privacy')} />
        </>
      ) : null}
      <Section title={t('serverSettings.stats.perHour')} footer={hours[peak] ? t('serverSettings.stats.peak', { h: peak }) : undefined}>
        <View
          style={{ flexDirection: 'row', alignItems: 'flex-end', height: 100, gap: 2, padding: spacing.md }}
          accessible
          accessibilityLabel={hours[peak] ? t('serverSettings.stats.peakA11y', { h: peak, n: hours[peak] }) : t('serverSettings.stats.noActivity')}
        >
          {hours.map((n, h) => (
            <View key={h} style={{ flex: 1, height: `${Math.max(2, (n / max) * 100)}%`, backgroundColor: n ? colors.primary : colors.bgHover, borderRadius: 2 }} />
          ))}
        </View>
      </Section>
    </ScrollView>
  )
}

/** 30 jours en barres (des comptes, jamais de contenu). */
function Bars({ title, values, footer }: { title: string; values: number[]; footer?: string }) {
  const max = Math.max(1, ...values)
  const last = values[values.length - 1] ?? 0
  return (
    <Section title={`${title} · ${last}`} footer={footer}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 80, gap: 1, padding: spacing.md }} accessible accessibilityLabel={`${title} : ${values.join(', ')}`}>
        {values.map((n, i) => (
          <View key={i} style={{ flex: 1, height: `${Math.max(2, (n / max) * 100)}%`, backgroundColor: n ? colors.primary : colors.bgHover, borderRadius: 1 }} />
        ))}
      </View>
    </Section>
  )
}
