import { useQuery } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { useState } from 'react'
import { Alert, FlatList, View } from 'react-native'
import { moderationApi, type Report, type ReportStatus } from '@/api/moderation'
import { Button, EmptyState, ErrorState, Loading, T } from '@/components/ui'
import { useT, type Key } from '@/i18n'
import { formatShort } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { colors, radius, spacing } from '@/theme'

const TABS: { status: ReportStatus; label: Key }[] = [
  { status: 'pending', label: 'serverSettings.reports.pending' },
  { status: 'resolved', label: 'serverSettings.reports.resolved' },
  { status: 'dismissed', label: 'serverSettings.reports.dismissed' },
]

/** File des signalements de messages (BAN_MEMBERS ou BAN_TEMP). */
export default function ReportsScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const sid = ids.serverId ?? ''
  const q = useQuery({ queryKey: ['reports', sid], queryFn: () => moderationApi.reports(sid), enabled: valid })
  const [tab, setTab] = useState<ReportStatus>('pending')
  const t = useT()
  if (!valid) return <ErrorState message={t('serverSettings.invalidServer')} />
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />

  const set = (r: Report, status: ReportStatus) =>
    void moderationApi
      .setReport(sid, r.id, status)
      .then(() => q.refetch())
      .catch((e) => Alert.alert(t('common.actionFailed'), errorMessage(e)))

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: t('serverSettings.title.reports') }} />
      <View style={{ flexDirection: 'row', gap: spacing.sm, padding: spacing.md }} accessibilityRole="tablist">
        {TABS.map((tb) => (
          <Button
            key={tb.status}
            title={t('serverSettings.reports.tab', { label: t(tb.label), n: (q.data ?? []).filter((r) => r.status === tb.status).length })}
            variant={tab === tb.status ? 'primary' : 'secondary'}
            onPress={() => setTab(tb.status)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === tb.status }}
            style={{ flex: 1, paddingHorizontal: spacing.xs }}
          />
        ))}
      </View>
      <FlatList
        data={(q.data ?? []).filter((r) => r.status === tab)}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
        ListEmptyComponent={<EmptyState icon="checkmark-circle-outline" title={t('serverSettings.reports.empty')} />}
        renderItem={({ item: r }) => (
          <View style={{ backgroundColor: colors.bgAlt, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm }}>
            <T variant="label">
              {r.reason} · {r.reporter_username} · {formatShort(r.created_at)}
            </T>
            <T selectable>{r.message_content ?? t('serverSettings.reports.deletedMessage')}</T>
            {r.comment ? <T variant="muted">{t('serverSettings.reports.quote', { text: r.comment })}</T> : null}
            {r.status === 'pending' ? (
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Button title={t('serverSettings.reports.resolve')} icon="checkmark" onPress={() => set(r, 'resolved')} style={{ flex: 1 }} />
                <Button title={t('serverSettings.reports.dismiss')} variant="secondary" icon="close" onPress={() => set(r, 'dismissed')} style={{ flex: 1 }} />
              </View>
            ) : (
              <Button title={t('serverSettings.reports.reopen')} variant="ghost" onPress={() => set(r, 'pending')} />
            )}
          </View>
        )}
      />
    </View>
  )
}
