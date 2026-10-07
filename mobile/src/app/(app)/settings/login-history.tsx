import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { usersApi } from '@/api/users'
import { EmptyState, ErrorState, Loading } from '@/components/ui'
import { useT } from '@/i18n'
import { formatRelative } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { colors, font, spacing } from '@/theme'

const isMobile = (d: string | null) => !!d && /mobile|android|iphone/i.test(d)

/** 20 dernières connexions (users::get_login_history). */
export default function LoginHistoryScreen() {
  const t = useT()
  const q = useQuery({ queryKey: ['login-history'], queryFn: usersApi.loginHistory })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  return (
    <>
      <Stack.Screen options={{ title: t('settings.loginHistory.title') }} />
      <FlatList
        style={{ backgroundColor: colors.bg }}
        data={q.data ?? []}
        keyExtractor={(e) => e.id}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.textMuted} />}
        ListEmptyComponent={<EmptyState icon="time-outline" title={t('settings.loginHistory.empty')} />}
        renderItem={({ item }) => (
          <View style={styles.row} accessible>
            <Ionicons name={isMobile(item.device_info) ? 'phone-portrait-outline' : 'desktop-outline'} size={20} color={colors.textMuted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={2}>
                {item.device_info?.slice(0, 120) || t('settings.loginHistory.unknownDevice')}
              </Text>
              <Text style={styles.sub}>{[item.ip_address, t('settings.loginHistory.active', { when: formatRelative(item.last_seen) })].filter(Boolean).join(' · ')}</Text>
              <Text style={styles.sub}>{t('settings.loginHistory.login', { when: formatRelative(item.created_at) })}</Text>
            </View>
          </View>
        )}
      />
    </>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, alignItems: 'flex-start' },
  title: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  sub: { color: colors.textMuted, fontSize: font.sm, marginTop: 2 },
})
