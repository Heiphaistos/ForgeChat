import { useQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { useMemo, useState } from 'react'
import { Alert, FlatList, View } from 'react-native'
import { serversApi, type PublicServer } from '@/api/servers'
import { Avatar } from '@/components/Avatar'
import { Button, EmptyState, ErrorState, Loading, T, TextField } from '@/components/ui'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { useUi } from '@/stores/ui'
import { colors, radius, spacing } from '@/theme'

/** Serveurs publics (GET /explore), rejoints par leur code d'invitation. */
export default function ExploreScreen() {
  const t = useT()
  const q = useQuery({ queryKey: ['explore'], queryFn: serversApi.explore })
  const mine = useQuery({ queryKey: qk.servers, queryFn: serversApi.list })
  const [search, setSearch] = useState('')
  const [joining, setJoining] = useState<string | null>(null)
  const joined = new Set((mine.data ?? []).map((s) => s.id))
  const list = useMemo(() => {
    const n = search.trim().toLowerCase()
    return (q.data ?? []).filter((s) => !n || s.name.toLowerCase().includes(n) || s.description?.toLowerCase().includes(n))
  }, [q.data, search])

  const open = (id: string) => {
    useUi.getState().selectServer(id)
    router.dismissTo('/')
  }

  const join = async (s: PublicServer) => {
    if (!s.invite_code) return
    setJoining(s.id)
    try {
      await serversApi.join(s.invite_code)
      await queryClient.invalidateQueries({ queryKey: qk.servers })
      open(s.id)
    } catch (e) {
      Alert.alert(t('server.explore.joinFailed'), errorMessage(e))
    } finally {
      setJoining(null)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: t('server.explore.title') }} />
      <View style={{ padding: spacing.md }}>
        <TextField value={search} onChangeText={setSearch} placeholder={t('server.explore.search')} accessibilityLabel={t('server.explore.search')} autoCorrect={false} />
      </View>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
          ListEmptyComponent={<EmptyState icon="compass-outline" title={t('server.explore.empty')} />}
          renderItem={({ item: s }) => (
            <View style={{ backgroundColor: colors.bgAlt, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Avatar uri={s.icon} name={s.name} size={48} rounded={false} />
                <View style={{ flex: 1 }}>
                  <T variant="subtitle" numberOfLines={1}>
                    {s.name}
                  </T>
                  <T variant="muted">
                    {t(s.member_count > 1 ? 'server.explore.membersMany' : 'server.explore.membersOne', { n: s.member_count })}
                  </T>
                </View>
              </View>
              {s.description ? <T numberOfLines={3}>{s.description}</T> : null}
              {joined.has(s.id) ? (
                <Button title={t('server.explore.open')} variant="secondary" onPress={() => open(s.id)} />
              ) : (
                <Button title={s.invite_code ? t('server.explore.join') : t('server.explore.noInvite')} disabled={!s.invite_code} loading={joining === s.id} onPress={() => void join(s)} />
              )}
            </View>
          )}
        />
      )}
    </View>
  )
}
