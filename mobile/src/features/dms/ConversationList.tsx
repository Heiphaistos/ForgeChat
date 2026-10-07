import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native'
import { dmsApi } from '@/api/dms'
import { Avatar } from '@/components/Avatar'
import { UserName } from '@/components/UserName'
import { Sheet } from '@/components/Sheet'
import { Badge, EmptyState, ErrorState, IconButton, Loading } from '@/components/ui'
import { formatShort, unreadLabel } from '@/lib/format'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { useUnread } from '@/stores/unread'
import type { ConversationSummary } from '@/types/models'
import { colors, font, radius, spacing } from '@/theme'
import { applyConversationSettings, conversationName, filterConversations } from './conversations'

const nameOf = conversationName

function open(c: ConversationSummary) {
  if (c.is_group) router.push({ pathname: '/group/[groupId]', params: { groupId: c.id, name: c.name } })
  else router.push({ pathname: '/dm/[dmId]', params: { dmId: c.id, name: c.username, userId: c.other_user_id } })
}

/** Messages privés (DM + groupes) : partie droite de l'accueil quand « Messages privés » est sélectionné. */
export function ConversationList() {
  const t = useT()
  const q = useQuery({ queryKey: qk.conversations, queryFn: dmsApi.list })
  const counts = useUnread((s) => s.counts)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [selected, setSelected] = useState<ConversationSummary | null>(null)

  const { items, archivedCount } = useMemo(() => filterConversations(q.data ?? [], search, showArchived), [q.data, search, showArchived])

  // Sourdine / archivage (PATCH /dms/:id/settings, DM et groupes) : mise à jour optimiste.
  const updateSettings = (c: ConversationSummary, patch: { muted?: boolean; archived?: boolean }) => {
    const previous = queryClient.getQueryData<ConversationSummary[]>(qk.conversations)
    if (previous) queryClient.setQueryData(qk.conversations, applyConversationSettings(previous, c.id, patch))
    dmsApi.setSettings(c.id, patch).catch((e) => {
      if (previous) queryClient.setQueryData(qk.conversations, previous)
      Alert.alert(t('common.actionFailed'), errorMessage(e))
    })
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgAlt }}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {t('dms.title')}
        </Text>
        <IconButton icon="search" label={t('dms.search')} onPress={() => router.push('/search')} />
        <IconButton icon="people-outline" label={t('dms.newGroup')} onPress={() => router.push('/group/create')} />
      </View>
      <View style={styles.search}>
        <Ionicons name="search" size={16} color={colors.textFaint} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={t('dms.searchPlaceholder')}
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.primary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={t('dms.searchPlaceholder')}
          style={styles.searchInput}
        />
        {search ? (
          <Pressable onPress={() => setSearch('')} accessibilityRole="button" accessibilityLabel={t('dms.clearSearch')} hitSlop={8}>
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
              <EmptyState icon="search-outline" title={t('dms.noResults')} />
            ) : (
              <EmptyState icon="chatbubbles-outline" title={t('dms.empty')} subtitle={t('dms.emptyHint')} />
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
                ? t('dms.members', { n: item.member_count })
                : t('dms.start')
            return (
              <Pressable
                onPress={() => open(item)}
                onLongPress={() => setSelected(item)}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bgHover }]}
                accessibilityRole="button"
                accessibilityLabel={`${t('dms.with', { name })}${unread ? `, ${unreadLabel(unread)}` : ''}`}
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
                    {item.is_group ? (
                      <Text style={[styles.name, unread ? { fontWeight: '800' } : null]} numberOfLines={1}>
                        {name}
                      </Text>
                    ) : (
                      <UserName userId={item.other_user_id} name={name} style={[styles.name, unread ? { fontWeight: '800' } : null]} />
                    )}
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
          ListFooterComponent={
            archivedCount || showArchived ? (
              <Pressable
                onPress={() => setShowArchived((v) => !v)}
                style={({ pressed }) => [styles.archivedRow, pressed && { backgroundColor: colors.bgHover }]}
                accessibilityRole="button"
              >
                <Ionicons name={showArchived ? 'arrow-back' : 'archive-outline'} size={18} color={colors.textMuted} />
                <Text style={styles.archivedText}>{showArchived ? t('dms.backToList') : t('dms.archived', { n: archivedCount })}</Text>
              </Pressable>
            ) : null
          }
          contentContainerStyle={{ paddingBottom: spacing.xl }}
        />
      )}
      <Sheet
        visible={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? nameOf(selected) : undefined}
        actions={
          selected
            ? [
                {
                  label: t(selected.is_muted ? 'dms.unmute' : 'dms.mute'),
                  icon: selected.is_muted ? 'notifications-outline' : 'notifications-off-outline',
                  onPress: () => updateSettings(selected, { muted: !selected.is_muted }),
                },
                {
                  label: t(selected.is_archived ? 'dms.unarchive' : 'dms.archive'),
                  icon: 'archive-outline',
                  onPress: () => updateSettings(selected, { archived: !selected.is_archived }),
                },
              ]
            : []
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  archivedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  archivedText: { color: colors.textMuted, fontSize: font.sm, fontWeight: '600' },
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
