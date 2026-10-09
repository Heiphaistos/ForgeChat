// Actualités : sites des flux RSS (bot RSSDI) classés par rubrique ; un site ouvre ses articles.
import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useMemo } from 'react'
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native'
import { cleanCategory, newsApi, type NewsSite } from '@/api/news'
import { EmptyState, ErrorState, Loading } from '@/components/ui'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { colors, font, radius, spacing } from '@/theme'

export default function NewsScreen() {
  const t = useT()
  const q = useQuery({ queryKey: ['news'], queryFn: newsApi.sites, refetchInterval: 120_000 })
  const sections = useMemo(() => {
    const m = new Map<string, NewsSite[]>()
    for (const s of q.data ?? []) m.set(cleanCategory(s.category), [...(m.get(cleanCategory(s.category)) ?? []), s])
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([title, data]) => ({ title, data }))
  }, [q.data])

  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  return (
    <SectionList
      style={{ backgroundColor: colors.bg }}
      sections={sections}
      keyExtractor={(s) => s.id}
      stickySectionHeadersEnabled={false}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.textMuted} />}
      ListEmptyComponent={<EmptyState icon="newspaper-outline" title={t('news.empty')} />}
      renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
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
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>
      )}
    />
  )
}

const styles = StyleSheet.create({
  section: { color: colors.textMuted, fontSize: font.xs, fontWeight: '700', textTransform: 'uppercase', paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  name: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  last: { color: colors.textMuted, fontSize: font.sm },
  count: { minWidth: 22, textAlign: 'center', color: '#fff', backgroundColor: colors.primary, borderRadius: radius.full, fontSize: font.xs, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
})
