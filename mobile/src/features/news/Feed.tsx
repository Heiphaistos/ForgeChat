// Fil d'articles de l'écran Actualités (commun aux 10 thèmes) : « À la une », rubrique, genre (plusieurs
// rubriques fusionnées), site ou recherche. Les sources coupées sont retirées des articles.
import { useInfiniteQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native'
import { cleanCategory, newsApi, type NewsArticle } from '@/api/news'
import { EmptyState, ErrorState } from '@/components/ui'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { colors, font, spacing } from '@/theme'
import { ArticleCard } from './ArticleCard'
import { mergePages, viewId, type View as NewsView } from './logic'

type Article = NewsArticle & { site?: string; site_id?: string; category?: string }
const SITE_PAGE = 30

export function Feed({ view, query, muted, header, onRefresh }: { view: NewsView; query: string; muted: Set<string>; header: ReactNode; onRefresh: () => void }) {
  const t = useT()
  const q = useInfiniteQuery({
    queryKey: ['news', 'feed', view.kind, viewId(view), query],
    queryFn: async ({ pageParam }): Promise<{ articles: Article[]; next?: string }> => {
      const before = pageParam ?? undefined
      if (view.kind === 'site' && !query) return mergePages([await newsApi.articles(view.site.id, before)], SITE_PAGE)
      // Le serveur ne filtre qu'une rubrique par requête : une requête par rubrique, puis fusion.
      const cats = view.kind === 'category' ? [view.category] : view.kind === 'genre' ? view.categories : [undefined]
      return mergePages(await Promise.all(cats.map((category) => newsApi.latest({ category, q: query || undefined, before }))))
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
  })
  const articles = (q.data?.pages.flatMap((p) => p.articles) ?? []).filter((a) => !a.site_id || !muted.has(a.site_id))
  const title = query ? t('news.results', { q: query }) : view.kind === 'top' ? t('news.top') : view.kind === 'category' ? cleanCategory(view.category) : view.kind === 'genre' ? view.label : view.site.name

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingBottom: spacing.xl }}
      data={q.isLoading || q.error ? [] : articles}
      keyExtractor={(a) => a.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View>
          {header}
          <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm }}>
            <Text style={{ color: colors.text, fontSize: font.xxl, fontWeight: '800' }} accessibilityRole="header">{title}</Text>
            {view.kind === 'site' && !query ? <Text style={{ color: colors.textMuted, fontSize: font.sm }}>{cleanCategory(view.site.category)}</Text> : null}
          </View>
          {q.isLoading ? <ActivityIndicator color={colors.textMuted} style={{ padding: spacing.xl }} /> : null}
          {q.error ? <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} /> : null}
        </View>
      }
      ListEmptyComponent={q.isLoading || q.error ? null : <EmptyState icon="newspaper-outline" title={t(query ? 'news.noResult' : 'news.empty')} />}
      refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => { onRefresh(); void q.refetch() }} tintColor={colors.textMuted} />}
      onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage() }}
      onEndReachedThreshold={0.5}
      ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={colors.textMuted} /> : null}
      renderItem={({ item, index }) => (
        <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
          <ArticleCard a={item} big={index === 0} showSite={view.kind !== 'site'} />
        </View>
      )}
    />
  )
}
