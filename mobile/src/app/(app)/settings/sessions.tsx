import { useMutation, useQuery } from '@tanstack/react-query'
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native'
import { authApi } from '@/api/auth'
import { EmptyState, ErrorState, IconButton, Loading } from '@/components/ui'
import { t as tr, useT } from '@/i18n'
import { formatRelative } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { colors, font, radius, spacing } from '@/theme'
import { Ionicons } from '@expo/vector-icons'

/** Le serveur ne garde qu'une étiquette (« Chrome · Windows », « ForgeChat Android »), ni IP ni user-agent. */
function deviceLabel(label: string | null): { label: string; icon: 'phone-portrait-outline' | 'desktop-outline' | 'globe-outline' } {
  if (!label) return { label: tr('settings.loginHistory.unknownDevice'), icon: 'globe-outline' }
  if (/Android|iOS/.test(label)) return { label, icon: 'phone-portrait-outline' }
  return { label, icon: label.startsWith('ForgeChat') ? 'desktop-outline' : 'globe-outline' }
}

export default function SessionsScreen() {
  const t = useT()
  const q = useQuery({ queryKey: qk.sessions, queryFn: authApi.sessions })
  const revoke = useMutation({
    mutationFn: (id: string) => authApi.revokeSession(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.sessions }),
    onError: (e) => Alert.alert(tr('settings.sessions.revokeFailed'), errorMessage(e)),
  })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
      data={q.data ?? []}
      keyExtractor={(s) => s.id}
      ListHeaderComponent={
        <Text style={{ color: colors.textMuted, marginBottom: spacing.sm }}>
          {t('settings.sessions.header')}
        </Text>
      }
      ListEmptyComponent={<EmptyState icon="phone-portrait-outline" title={t('settings.sessions.empty')} />}
      renderItem={({ item }) => {
        const d = deviceLabel(item.device)
        return (
          <View style={styles.card}>
            <Ionicons name={d.icon} size={26} color={colors.textMuted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{d.label}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {t('settings.sessions.meta', { when: formatRelative(item.last_seen) })}
              </Text>
            </View>
            <IconButton
              icon="close-circle-outline"
              label={t('settings.sessions.revokeA11y')}
              color={colors.danger}
              onPress={() =>
                Alert.alert(t('settings.sessions.revokeTitle'), t('settings.sessions.revokeBody'), [
                  { text: t('common.cancel'), style: 'cancel' },
                  { text: t('settings.sessions.revoke'), style: 'destructive', onPress: () => revoke.mutate(item.id) },
                ])
              }
            />
          </View>
        )
      }}
    />
  )
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.bgAlt, borderRadius: radius.lg, padding: spacing.md },
  title: { color: colors.text, fontWeight: '700', fontSize: font.md },
  sub: { color: colors.textMuted, fontSize: font.xs },
})
