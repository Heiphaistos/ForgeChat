import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native'
import { dmsApi } from '@/api/dms'
import { Avatar } from '@/components/Avatar'
import { Badge, EmptyState, ErrorState, IconButton, Loading } from '@/components/ui'
import { formatShort, unreadLabel } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { qk } from '@/lib/queryClient'
import { useUnread } from '@/stores/unread'
import type { ConversationSummary } from '@/types/models'
import { colors, font, radius, spacing } from '@/theme'

const nameOf = (c: ConversationSummary) => (c.is_group ? c.name : c.username)

function open(c: ConversationSummary) {
  if (c.is_group) router.push({ pathname: '/group/[groupId]', params: { groupId: c.id, name: c.name } })
  else router.push({ pathname: '/dm/[dmId]', params: { dmId: c.id, name: c.username, userId: c.other_user_id } })
}

/** Messages privés (DM + groupes) : partie droite de l'accueil quand « Messages privés » est sélectionné. */
export function ConversationList() {
  const q = useQuery({ queryKey: qk.conversations, queryFn: dmsApi.list })
  const counts = useUnread((s) => s.counts)
  const [search, setSearch] = useState('')

  const items = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    const list = (q.data ?? []).filter((c) => !c.is_archived)
    return needle ? list.filter((c) => nameOf(c).toLocaleLowerCase().includes(needle)) : list
  }, [q.data, search])

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgAlt }}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Messages privés
        </Text>
        <IconButton icon="search" label="Rechercher" onPress={() => router.push('/search')} />
        <IconButton icon="people-outline" label="Nouveau groupe" onPress={() => router.push('/group/create')} />
      </View>
      <View style={styles.search}>
        <Ionicons name="search" size={16} color={colors.textFaint} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Rechercher une conversation"
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.primary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Rechercher une conversation"
          style={styles.searchInput}
        />
        {search ? (
          <Pressable onPress={() => setSearch('')} accessibilityRole="button" accessibilityLabel="Effacer la recherche" hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={colors.textFaint} />
          </Pressable>
        ) : null}
      </View>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(c) => c.id}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.textMuted} />}
          ListEmptyComponent={
            search.trim() ? (
              <EmptyState icon="search-outline" title="Aucun résultat" />
            ) : (
              <EmptyState icon="chatbubbles-outline" title="Aucune conversation" subtitle="Ouvre un message privé depuis l'onglet Amis." />
            )
          }
          renderItem={({ item }) => {
            const unread = counts[item.id] ?? 0
            const name = nameOf(item)
            const preview = item.last_message_content
              ? item.is_group && item.last_message_author
                ? `${item.last_message_author} : ${item.last_message_content}`
                : item.last_message_content
              : item.is_group
                ? `${item.member_count} membres`
                : 'Démarre la conversation'
            return (
              <Pressable
                onPress={() => open(item)}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bgHover }]}
                accessibilityRole="button"
                accessibilityLabel={`Conversation avec ${name}${unread ? `, ${unreadLabel(unread)}` : ''}`}
              >
                {item.is_group ? (
                  <View style={styles.groupIcon}>
                    <Ionicons name="people" size={20} color="#fff" />
                  </View>
                ) : (
                  <Avatar uri={item.avatar} name={item.username} userId={item.other_user_id} status={item.status} showStatus size={40} />
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.top}>
                    <Text style={[styles.name, unread ? { fontWeight: '800' } : null]} numberOfLines={1}>
                      {name}
                    </Text>
                    <Text style={styles.time}>{formatShort(item.last_message_at)}</Text>
                  </View>
                  <View style={styles.top}>
                    <Text style={[styles.preview, unread ? { color: colors.text } : null]} numberOfLines={1}>
                      {item.is_muted ? '🔕 ' : ''}
                      {preview}
                    </Text>
                    <Badge count={unread} />
                  </View>
                </View>
              </Pressable>
            )
          }}
          contentContainerStyle={{ paddingBottom: spacing.xl }}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    height: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { flex: 1, color: colors.text, fontSize: font.lg, fontWeight: '800' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    margin: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.bgDeep,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: font.sm, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { flex: 1, color: colors.text, fontSize: font.md, fontWeight: '600' },
  time: { color: colors.textFaint, fontSize: font.xs },
  preview: { flex: 1, color: colors.textMuted, fontSize: font.sm, marginTop: 2 },
  groupIcon: { width: 40, height: 40, borderRadius: radius.full, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
})
