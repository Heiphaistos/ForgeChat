import { useQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, FlatList, ScrollView, View } from 'react-native'
import { communityApi, type DirectoryServer } from '@/api/community'
import { serversApi } from '@/api/servers'
import { Avatar } from '@/components/Avatar'
import { Button, EmptyState, ErrorState, Loading, T, TextField } from '@/components/ui'
import { ChoiceRow } from '@/features/servers/ChoiceRow'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { useUi } from '@/stores/ui'
import { colors, radius, spacing } from '@/theme'

const CATEGORIES = ['all', 'gaming', 'community', 'tech', 'music', 'education', 'arts', '18plus'] as const
const SORTS = ['members', 'activity', 'recent', 'alpha'] as const

/** Annuaire des serveurs publics (GET /explore) : catégorie, étiquette, recherche et tri par le serveur. */
export default function ExploreScreen() {
  const t = useT()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('all')
  const [sort, setSort] = useState<string>('members')
  const [tag, setTag] = useState<string | null>(null)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(id)
  }, [search])
  const q = useQuery({
    queryKey: ['explore', category, sort, tag, debounced],
    queryFn: () => communityApi.directory({ category: category === 'all' ? undefined : category, sort, tag: tag ?? undefined, q: debounced || undefined }),
  })
  const mine = useQuery({ queryKey: qk.servers, queryFn: serversApi.list })
  const [joining, setJoining] = useState<string | null>(null)
  const joined = new Set((mine.data ?? []).map((s) => s.id))
  const list = q.data ?? []

  const open = (id: string) => {
    useUi.getState().selectServer(id)
    router.dismissTo('/')
  }

  const join = async (s: DirectoryServer) => {
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
        <TextField value={search} onChangeText={setSearch} placeholder={t('server.explore.search')} accessibilityLabel={t('server.explore.search')} autoCorrect={false} maxLength={100} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.sm }}>
          {CATEGORIES.map((c) => (
            <Button key={c} title={t(`community.directory.cat.${c}`)} variant={category === c ? 'primary' : 'secondary'} onPress={() => setCategory(c)}
              accessibilityState={{ selected: category === c }} />
          ))}
        </ScrollView>
        <ChoiceRow icon="swap-vertical-outline" title={t('community.directory.sort')} value={sort}
          options={SORTS.map((s) => ({ value: s as string, label: t(`community.directory.sort.${s}`) }))} onChange={setSort} />
        {tag ? <Button title={`✕ #${tag}`} variant="secondary" onPress={() => setTag(null)} /> : null}
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
              <T variant="muted">{t('community.directory.line', { online: s.online_count ?? 0, activity: s.activity ?? 0 })}</T>
              {s.tags?.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                  {s.tags.map((tg) => <Button key={tg} title={`#${tg}`} variant="ghost" onPress={() => setTag(tg)} />)}
                </View>
              ) : null}
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
