// Actualités : recherche, « À la une », puis les rubriques repliables (comme les catégories d'un serveur)
// avec leurs sites ; un site ouvre ses articles, « Tout » ouvre la rubrique entière.
import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, TextInput, View } from 'react-native'
import { cleanCategory, newsApi, type NewsSite } from '@/api/news'
import { EmptyState, ErrorState, Loading } from '@/components/ui'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { colors, font, radius, spacing } from '@/theme'

export default function NewsScreen() {
  const t = useT()
  const q = useQuery({ queryKey: ['news'], queryFn: newsApi.sites, refetchInterval: 120_000 })
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState('')
  const sections = useMemo(() => {
    const m = new Map<string, NewsSite[]>()
    for (const s of q.data ?? []) m.set(s.category, [...(m.get(s.category) ?? []), s])
    return [...m.entries()]
      .sort(([a], [b]) => cleanCategory(a).localeCompare(cleanCategory(b)))
      .map(([key, all]) => ({ key, title: cleanCategory(key), today: all.reduce((n, s) => n + s.today, 0), count: all.length, data: open[key] ? all : [] }))
  }, [q.data, open])

  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  const submit = () => { const s = search.trim(); if (s) router.push({ pathname: '/news/feed', params: { q: s } }) }
  return (
    <SectionList
      style={{ backgroundColor: colors.bg }}
      sections={sections}
      keyExtractor={(s) => s.id}
      stickySectionHeadersEnabled={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.textMuted} />}
      ListHeaderComponent={
        <View style={{ padding: spacing.md, gap: spacing.md }}>
          <View style={styles.search}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              onSubmitEditing={submit}
              placeholder={t('news.search')}
              placeholderTextColor={colors.textMuted}
              returnKeyType="search"
              style={styles.searchInput}
              accessibilityLabel={t('news.search')}
            />
          </View>
          <Pressable style={styles.top} onPress={() => router.push('/news/feed')} accessibilityRole="button">
            <Ionicons name="flame" size={20} color="#fb923c" />
            <Text style={styles.topText}>{t('news.top')}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      }
      ListEmptyComponent={<EmptyState icon="newspaper-outline" title={t('news.empty')} />}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionRow}>
          <Pressable
            style={styles.sectionToggle}
            onPress={() => setOpen((o) => ({ ...o, [section.key]: !o[section.key] }))}
            accessibilityRole="button"
            accessibilityState={{ expanded: !!open[section.key] }}
            accessibilityLabel={`${section.title}, ${section.count}`}
          >
            <Ionicons name={open[section.key] ? 'chevron-down' : 'chevron-forward'} size={14} color={colors.textMuted} />
            <Text style={styles.section}>{section.title}</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={() => router.push({ pathname: '/news/feed', params: { category: section.key } })} accessibilityRole="button" accessibilityLabel={t('news.allOf', { name: section.title })}>
            <Text style={[styles.badge, !section.today && styles.badgeIdle]}>{section.today || t('news.all')}</Text>
          </Pressable>
        </View>
      )}
      renderItem={({ item }) => (
        <Pressable
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bgHover }]}
          onPress={() => router.push({ pathname: '/news/[siteId]', params: { siteId: item.id, name: item.name, category: cleanCategory(item.category) } })}
          accessibilityRole="button"
          accessibilityLabel={item.today ? t('news.siteToday', { name: item.name, n: item.today }) : item.name}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
            {item.last_title ? <Text style={styles.last} numberOfLines={1}>{item.last_title}</Text> : null}
          </View>
          {item.today ? <Text style={styles.count}>{item.today}</Text> : null}
        </Pressable>
      )}
    />
  )
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.bgAlt, borderRadius: radius.md, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, color: colors.text, fontSize: font.md, paddingVertical: 10 },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.bgAlt, borderRadius: radius.md, padding: spacing.md },
  topText: { flex: 1, color: colors.text, fontSize: font.md, fontWeight: '700' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs },
  sectionToggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  section: { color: colors.textMuted, fontSize: font.xs, fontWeight: '700', textTransform: 'uppercase' },
  badge: { color: '#fff', backgroundColor: colors.primary, borderRadius: radius.full, fontSize: font.xs, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  badgeIdle: { backgroundColor: colors.bgAlt, color: colors.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingLeft: spacing.xl, paddingRight: spacing.lg, paddingVertical: spacing.md },
  name: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  last: { color: colors.textMuted, fontSize: font.sm },
  count: { minWidth: 22, textAlign: 'center', color: colors.primary, fontSize: font.xs, fontWeight: '700' },
})
