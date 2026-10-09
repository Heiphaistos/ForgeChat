// Articles d'un site d'actualité : image, titre, résumé ; un appui ouvre l'article dans le navigateur.
import { useInfiniteQuery } from '@tanstack/react-query'
import { Stack, useLocalSearchParams } from 'expo-router'
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text } from 'react-native'
import { newsApi } from '@/api/news'
import { ArticleCard } from '@/features/news/ArticleCard'
import { EmptyState, ErrorState, Loading } from '@/components/ui'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { colors, font, spacing } from '@/theme'


export default function NewsSiteScreen() {
  const t = useT()
  const { siteId, name, category } = useLocalSearchParams<{ siteId: string; name?: string; category?: string }>()
  const q = useInfiniteQuery({
    queryKey: ['news', siteId],
    queryFn: ({ pageParam }) => newsApi.articles(siteId, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.length === 30 ? last.at(-1)?.published_at : undefined),
  })
  const articles = q.data?.pages.flat() ?? []

  return (
    <>
      <Stack.Screen options={{ title: name ?? t('news.title') }} />
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
          ListHeaderComponent={category ? <Text style={styles.category}>{category}</Text> : null}
          ListEmptyComponent={<EmptyState icon="newspaper-outline" title={t('news.empty')} />}
          refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void q.refetch()} tintColor={colors.textMuted} />}
          onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage() }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={colors.textMuted} /> : null}
          renderItem={({ item, index }) => <ArticleCard a={item} big={index === 0} />}
        />
      )}
    </>
  )
}

const styles = StyleSheet.create({
  category: { color: colors.textMuted, fontSize: font.xs, fontWeight: '700', textTransform: 'uppercase' },
})
