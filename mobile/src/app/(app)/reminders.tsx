import { useMutation, useQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { EmptyState, ErrorState, IconButton, Loading } from '@/components/ui'
import { useT } from '@/i18n'
import { formatRelative } from '@/lib/format'
import { errorMessage, http } from '@/lib/http'
import { queryClient } from '@/lib/queryClient'
import { colors, font, radius, spacing } from '@/theme'

// Rappels à venir (amélioration n° 47) : ouvrir le message, annuler. Le texte n'est pas repris
// (il peut être chiffré) : on ouvre la conversation à la place.
interface Reminder {
  id: string; message_id: string; remind_at: string
  channel_id: string | null; server_id: string | null; dm_id: string | null
}
const KEY = ['reminders'] as const

export default function RemindersScreen() {
  const t = useT()
  const list = useQuery({ queryKey: KEY, queryFn: () => http.get<Reminder[]>('/reminders'), refetchInterval: 60_000 })
  const cancel = useMutation({
    mutationFn: (id: string) => http.delete<void>(`/reminders/${encodeURIComponent(id)}`, { noQueue: true }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }),
  })
  const open = (r: Reminder) => {
    if (r.server_id && r.channel_id) router.push({ pathname: '/channel/[serverId]/[channelId]', params: { serverId: r.server_id, channelId: r.channel_id } })
    else if (r.dm_id) router.push(`/dm/${r.dm_id}`)
  }
  let body: React.ReactNode
  if (list.isLoading) body = <Loading />
  else if (list.error) body = <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
  else if (!list.data?.length) body = <EmptyState icon="alarm-outline" title={t('reminders.upcoming')} />
  else
    body = (
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        {list.data.map((r) => (
          <View key={r.id} style={styles.card}>
            <Pressable style={{ flex: 1 }} onPress={() => open(r)} accessibilityRole="button">
              <Text style={styles.title}>{formatRelative(r.remind_at)}</Text>
              <Text style={styles.sub}>{t(r.dm_id ? 'reminders.inDm' : 'reminders.inChannel')}</Text>
            </Pressable>
            <IconButton icon="close-circle-outline" label={t('reminders.cancel')} color={colors.danger} onPress={() => cancel.mutate(r.id)} />
          </View>
        ))}
      </ScrollView>
    )
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: t('reminders.upcoming') }} />
      {body}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.bgAlt, borderRadius: radius.lg, padding: spacing.md },
  title: { color: colors.text, fontWeight: '700', fontSize: font.md },
  sub: { color: colors.textMuted, fontSize: font.xs },
})
