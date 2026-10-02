import { Ionicons } from '@expo/vector-icons'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native'
import { searchApi } from '@/api/search'
import { Avatar } from '@/components/Avatar'
import { EmptyState, ErrorState } from '@/components/ui'
import { useScrollTarget } from '@/features/chat/pins'
import { SEARCH_DEBOUNCE_MS, searchQuery, type SearchChannel, type SearchMessage, type SearchUser } from '@/features/search/search'
import { formatShort } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { qk } from '@/lib/queryClient'
import { colors, font, radius, spacing } from '@/theme'

type Item = { kind: 'message'; v: SearchMessage } | { kind: 'user'; v: SearchUser } | { kind: 'channel'; v: SearchChannel }

function openItem(item: Item) {
  switch (item.kind) {
    case 'message':
      useScrollTarget.getState().request(item.v.channelId, item.v.id)
      router.push({ pathname: '/channel/[serverId]/[channelId]', params: { serverId: item.v.serverId, channelId: item.v.channelId, name: item.v.channelName } })
      return
    case 'user':
      router.push(`/user/${item.v.id}`)
      return
    case 'channel':
      if (item.v.type === 'voice') router.push({ pathname: '/voice/[serverId]/[channelId]', params: { serverId: item.v.serverId, channelId: item.v.id } })
      else router.push({ pathname: '/channel/[serverId]/[channelId]', params: { serverId: item.v.serverId, channelId: item.v.id, name: item.v.name } })
  }
}

export default function SearchScreen() {
  const [input, setInput] = useState('')
  const [debounced, setDebounced] = useState<string | null>(null)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(searchQuery(input)), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [input])

  const results = useQuery({
    queryKey: qk.search(debounced ?? ''),
    queryFn: ({ signal }) => searchApi.global(debounced!, signal),
    enabled: !!debounced,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

  const data = debounced ? results.data : undefined
  const sections = data
    ? [
        { title: 'Messages', data: data.messages.map((v): Item => ({ kind: 'message', v })) },
        { title: 'Salons', data: data.channels.map((v): Item => ({ kind: 'channel', v })) },
        { title: 'Personnes', data: data.users.map((v): Item => ({ kind: 'user', v })) },
      ].filter((s) => s.data.length)
    : []

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.search}>
        <Ionicons name="search" size={16} color={colors.textFaint} />
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Messages, salons, personnes"
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.primary}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          maxLength={100}
          accessibilityLabel="Rechercher"
          style={styles.input}
        />
        {results.isFetching ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
      </View>
      {!debounced ? (
        <EmptyState icon="search-outline" title="Rechercher" subtitle="Au moins 2 caractères. Les messages privés ne sont pas inclus." />
      ) : results.error ? (
        <ErrorState message={errorMessage(results.error)} onRetry={() => void results.refetch()} />
      ) : data && !sections.length ? (
        <EmptyState icon="search-outline" title="Aucun résultat" />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(it) => `${it.kind}-${it.v.id}`}
          keyboardShouldPersistTaps="handled"
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => openItem(item)}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bgHover }]}
              accessibilityRole="button"
              accessibilityLabel={
                item.kind === 'channel' ? `${item.v.type === 'voice' ? 'Salon vocal' : 'Salon'} ${item.v.name}, ${item.v.serverName}` : undefined
              }
            >
              {item.kind === 'message' ? (
                <>
                  <Avatar uri={item.v.authorAvatar} name={item.v.authorName} size={32} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.meta} numberOfLines={1}>
                      {item.v.authorName} · #{item.v.channelName} · {formatShort(item.v.createdAt)}
                    </Text>
                    <Text style={styles.body} numberOfLines={3}>
                      {item.v.content ?? 'Pièce jointe'}
                    </Text>
                  </View>
                </>
              ) : item.kind === 'channel' ? (
                <>
                  <Ionicons name={item.v.type === 'voice' ? 'volume-medium' : 'chatbubble-outline'} size={20} color={colors.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.body} numberOfLines={1}>
                      {item.v.type === 'voice' ? '' : '#'}
                      {item.v.name}
                    </Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {item.v.serverName}
                    </Text>
                  </View>
                </>
              ) : (
                <>
                  <Avatar uri={item.v.avatar} name={item.v.username} size={32} userId={item.v.id} />
                  <Text style={[styles.body, { flex: 1 }]} numberOfLines={1}>
                    {item.v.username}
                  </Text>
                </>
              )}
            </Pressable>
          )}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    margin: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.bgDeep,
  },
  input: { flex: 1, color: colors.text, fontSize: font.md, paddingVertical: spacing.sm },
  section: { color: colors.textMuted, fontSize: font.xs, fontWeight: '700', textTransform: 'uppercase', paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  meta: { color: colors.textMuted, fontSize: font.xs },
  body: { color: colors.text, fontSize: font.md },
})
