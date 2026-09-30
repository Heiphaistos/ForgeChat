import { useMutation, useQuery } from '@tanstack/react-query'
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native'
import { authApi } from '@/api/auth'
import { EmptyState, ErrorState, IconButton, Loading } from '@/components/ui'
import { formatRelative } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { colors, font, radius, spacing } from '@/theme'
import { Ionicons } from '@expo/vector-icons'

function deviceLabel(ua: string | null): { label: string; icon: 'phone-portrait-outline' | 'desktop-outline' | 'globe-outline' } {
  const s = ua ?? ''
  if (/forgechat-mobile|okhttp|CFNetwork|Darwin/i.test(s)) return { label: 'Application mobile', icon: 'phone-portrait-outline' }
  if (/tauri|Electron/i.test(s)) return { label: 'Application desktop', icon: 'desktop-outline' }
  const browser = /Firefox/.test(s) ? 'Firefox' : /Edg\//.test(s) ? 'Edge' : /Chrome/.test(s) ? 'Chrome' : /Safari/.test(s) ? 'Safari' : 'Navigateur'
  return { label: browser, icon: 'globe-outline' }
}

export default function SessionsScreen() {
  const q = useQuery({ queryKey: qk.sessions, queryFn: authApi.sessions })
  const revoke = useMutation({
    mutationFn: (id: string) => authApi.revokeSession(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.sessions }),
    onError: (e) => Alert.alert('Révocation impossible', errorMessage(e)),
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
          Si tu ne reconnais pas une session, révoque-la puis change ton mot de passe.
        </Text>
      }
      ListEmptyComponent={<EmptyState icon="phone-portrait-outline" title="Aucune session" />}
      renderItem={({ item }) => {
        const d = deviceLabel(item.device)
        return (
          <View style={styles.card}>
            <Ionicons name={d.icon} size={26} color={colors.textMuted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{d.label}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {item.ip ?? 'IP inconnue'} · actif {formatRelative(item.last_seen)}
              </Text>
            </View>
            <IconButton
              icon="close-circle-outline"
              label="Révoquer cette session"
              color={colors.danger}
              onPress={() =>
                Alert.alert('Révoquer cette session ?', "L'appareil concerné sera déconnecté (y compris celui-ci s'il s'agit de lui).", [
                  { text: 'Annuler', style: 'cancel' },
                  { text: 'Révoquer', style: 'destructive', onPress: () => revoke.mutate(item.id) },
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
