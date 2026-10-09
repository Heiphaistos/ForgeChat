// Articles d'un site d'actualité : image, titre, résumé ; un appui ouvre l'article dans le navigateur.
import { useInfiniteQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { Stack, useLocalSearchParams } from 'expo-router'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { newsApi, type NewsArticle } from '@/api/news'
import { EmptyState, ErrorState, Loading } from '@/components/ui'
import { useLang, useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { openExternalUrl } from '@/lib/links'
import { colors, font, radius, spacing } from '@/theme'

const host = (link: string) => { try { return new URL(link).hostname.replace(/^www\./, '') } catch { return '' } }

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
          renderItem={({ item }) => <ArticleCard a={item} />}
        />
      )}
    </>
  )
}

function ArticleCard({ a }: { a: NewsArticle }) {
  const lang = useLang((l) => l.lang)
  const when = new Date(a.published_at).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <Pressable onPress={() => void openExternalUrl(a.link)} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]} accessibilityRole="link" accessibilityLabel={a.title}>
      {a.image?.startsWith('https://') ? <Image source={{ uri: a.image }} style={styles.image} contentFit="cover" accessible={false} /> : null}
      <View style={styles.body}>
        <Text style={styles.title}>{a.title}</Text>
        {a.summary ? <Text style={styles.summary} numberOfLines={6}>{a.summary}</Text> : null}
        <Text style={styles.meta}>{when} · {host(a.link)}</Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  category: { color: colors.textMuted, fontSize: font.xs, fontWeight: '700', textTransform: 'uppercase' },
  card: { backgroundColor: colors.bgAlt, borderRadius: radius.lg, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  image: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  body: { padding: spacing.md, gap: 6 },
  title: { color: colors.text, fontSize: font.md, fontWeight: '700' },
  summary: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 20 },
  meta: { color: colors.textMuted, fontSize: font.xs },
})
