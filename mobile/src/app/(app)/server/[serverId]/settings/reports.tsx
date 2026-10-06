import { useQuery } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { useState } from 'react'
import { Alert, FlatList, View } from 'react-native'
import { moderationApi, type Report, type ReportStatus } from '@/api/moderation'
import { Button, EmptyState, ErrorState, Loading, T } from '@/components/ui'
import { formatShort } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { colors, radius, spacing } from '@/theme'

const TABS: { status: ReportStatus; label: string }[] = [
  { status: 'pending', label: 'Ouverts' },
  { status: 'resolved', label: 'Traités' },
  { status: 'dismissed', label: 'Rejetés' },
]

/** File des signalements de messages (BAN_MEMBERS ou BAN_TEMP). */
export default function ReportsScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const sid = ids.serverId ?? ''
  const q = useQuery({ queryKey: ['reports', sid], queryFn: () => moderationApi.reports(sid), enabled: valid })
  const [tab, setTab] = useState<ReportStatus>('pending')
  if (!valid) return <ErrorState message="Serveur invalide." />
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />

  const set = (r: Report, status: ReportStatus) =>
    void moderationApi
      .setReport(sid, r.id, status)
      .then(() => q.refetch())
      .catch((e) => Alert.alert('Action impossible', errorMessage(e)))

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: 'Signalements' }} />
      <View style={{ flexDirection: 'row', gap: spacing.sm, padding: spacing.md }} accessibilityRole="tablist">
        {TABS.map((t) => (
          <Button
            key={t.status}
            title={`${t.label} (${(q.data ?? []).filter((r) => r.status === t.status).length})`}
            variant={tab === t.status ? 'primary' : 'secondary'}
            onPress={() => setTab(t.status)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.status }}
            style={{ flex: 1, paddingHorizontal: spacing.xs }}
          />
        ))}
      </View>
      <FlatList
        data={(q.data ?? []).filter((r) => r.status === tab)}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
        ListEmptyComponent={<EmptyState icon="checkmark-circle-outline" title="Aucun signalement" />}
        renderItem={({ item: r }) => (
          <View style={{ backgroundColor: colors.bgAlt, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm }}>
            <T variant="label">
              {r.reason} · {r.reporter_username} · {formatShort(r.created_at)}
            </T>
            <T selectable>{r.message_content ?? '(message supprimé)'}</T>
            {r.comment ? <T variant="muted">« {r.comment} »</T> : null}
            {r.status === 'pending' ? (
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Button title="Traité" icon="checkmark" onPress={() => set(r, 'resolved')} style={{ flex: 1 }} />
                <Button title="Rejeter" variant="secondary" icon="close" onPress={() => set(r, 'dismissed')} style={{ flex: 1 }} />
              </View>
            ) : (
              <Button title="Remettre en attente" variant="ghost" onPress={() => set(r, 'pending')} />
            )}
          </View>
        )}
      />
    </View>
  )
}
