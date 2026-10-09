// Fil d'articles : « À la une » (tous les sites), une rubrique entière ou des résultats de recherche.
import { useInfiniteQuery } from '@tanstack/react-query'
import { Stack, useLocalSearchParams } from 'expo-router'
import { ActivityIndicator, FlatList, RefreshControl } from 'react-native'
import { cleanCategory, newsApi } from '@/api/news'
import { EmptyState, ErrorState, Loading } from '@/components/ui'
import { ArticleCard } from '@/features/news/ArticleCard'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { colors, spacing } from '@/theme'

export default function NewsFeedScreen() {
  const t = useT()
  const { category, q: search } = useLocalSearchParams<{ category?: string; q?: string }>()
  const q = useInfiniteQuery({
    queryKey: ['news', 'feed', category ?? '', search ?? ''],
    queryFn: ({ pageParam }) => newsApi.latest({ category: category || undefined, q: search || undefined, before: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.length >= 40 ? last.at(-1)?.published_at : undefined),
  })
  const articles = q.data?.pages.flat() ?? []
  const title = search ? t('news.results', { q: search }) : category ? cleanCategory(category) : t('news.top')

  return (
    <>
      <Stack.Screen options={{ title }} />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          style={{ backgroundColor: colors.bg }}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
          data={articles}
          keyExtractor={(a) => a.id}
          ListEmptyComponent={<EmptyState icon="newspaper-outline" title={t(search ? 'news.noResult' : 'news.empty')} />}
          refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void q.refetch()} tintColor={colors.textMuted} />}
          onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage() }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={colors.textMuted} /> : null}
          renderItem={({ item, index }) => <ArticleCard a={item} big={index === 0} showSite />}
        />
      )}
    </>
  )
}
