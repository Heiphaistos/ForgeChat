// Tutoriels vidéo : catégories (puces avec compteurs), sous-catégories distribution / version,
// recherche avec délai, cartes, défilement infini. Même contrat que le web (pages/TutorialsPage.tsx).
import { Ionicons } from '@expo/vector-icons'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { EmptyState, ErrorState, Loading } from '@/components/ui'
import { nextPage, tutorialsApi } from '@/features/tutorials/api'
import { TutorialCard } from '@/features/tutorials/TutorialCard'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { colors, font, radius, spacing } from '@/theme'

function Chip({ label, count, on, onPress, small }: { label: string; count?: number; on: boolean; onPress: () => void; small?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={count === undefined ? label : `${label}, ${count}`}
      accessibilityState={{ selected: on }}
      style={[styles.chip, small && { paddingVertical: 4 }, on && styles.chipOn]}
    >
      <Text style={[styles.chipText, on && { color: '#fff', fontWeight: '700' }]}>{label}</Text>
      {count !== undefined ? <Text style={[styles.chipCount, on && { color: '#ffffffcc' }]}>{count}</Text> : null}
    </Pressable>
  )
}

export default function TutorialsScreen() {
  const t = useT()
  const [category, setCategory] = useState('')
  const [group, setGroup] = useState('')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const h = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(h)
  }, [search])

  const catalog = useQuery({ queryKey: ['tutorials', 'catalog'], queryFn: tutorialsApi.catalog, staleTime: 300_000 })
  const cats = catalog.data ?? []
  const current = cats.find((c) => c.slug === category)
  const total = cats.reduce((n, c) => n + c.count, 0)

  const list = useInfiniteQuery({
    queryKey: ['tutorials', 'list', category, group, q],
    queryFn: ({ pageParam }) => tutorialsApi.list({ category, group, q, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: nextPage,
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []

  // Le champ et les puces restent montés pendant le chargement d'un filtre (clavier conservé).
  const header = (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.search}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput value={search} onChangeText={setSearch} placeholder={t('tuto.search')} placeholderTextColor={colors.textMuted} returnKeyType="search" autoCorrect={false} style={styles.searchInput} accessibilityLabel={t('tuto.search')} />
        {search ? (
          <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('tuto.clear')}>
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel={t('tuto.categories')}>
        <Chip label={t('tuto.all')} count={total} on={!category} onPress={() => { setCategory(''); setGroup('') }} />
        {cats.map((c) => (
          <Chip key={c.slug} label={c.name} count={c.count} on={c.slug === category} onPress={() => { setCategory(c.slug); setGroup('') }} />
        ))}
      </ScrollView>
      {current && current.groups.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel={t('tuto.versions')}>
          <Chip small label={t('tuto.allVersions')} on={!group} onPress={() => setGroup('')} />
          {current.groups.map((g) => (
            <Chip key={g.key} small label={g.label} count={g.count} on={group === g.key} onPress={() => setGroup(g.key)} />
          ))}
        </ScrollView>
      ) : null}
      <Text style={styles.heading} accessibilityRole="header">
        {q ? t('tuto.results', { q }) : current ? current.name : t('tuto.all')}
      </Text>
    </View>
  )

  if (catalog.isLoading) return <Loading />
  if (catalog.error) return <ErrorState message={errorMessage(catalog.error, t('tuto.error'))} onRetry={() => void catalog.refetch()} />
  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
      data={items}
      keyExtractor={(x) => x.slug}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={header}
      ListEmptyComponent={
        list.isLoading ? <Loading /> : list.error ? <ErrorState message={errorMessage(list.error, t('tuto.error'))} onRetry={() => void list.refetch()} /> : <EmptyState icon="school-outline" title={q ? t('tuto.noResult') : t('tuto.empty')} />
      }
      refreshControl={<RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => void list.refetch()} tintColor={colors.textMuted} />}
      onEndReached={() => { if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage() }}
      onEndReachedThreshold={0.5}
      ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={colors.textMuted} /> : null}
      renderItem={({ item }) => (
        <TutorialCard category={item.category} title={item.title} description={item.description} group={item.group} onPress={() => router.push({ pathname: '/tutos/[slug]', params: { slug: item.slug } })} />
      )}
    />
  )
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.bgAlt, borderRadius: radius.md, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, color: colors.text, fontSize: font.md, paddingVertical: spacing.sm },
  chips: { gap: spacing.sm, paddingVertical: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.full, backgroundColor: colors.bgAlt },
  chipOn: { backgroundColor: colors.primary },
  chipText: { color: colors.text, fontSize: font.sm },
  chipCount: { color: colors.textMuted, fontSize: font.xs },
  heading: { color: colors.text, fontSize: font.lg, fontWeight: '800', marginTop: spacing.xs },
})
