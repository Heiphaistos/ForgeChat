import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { dmsApi } from '@/api/dms'
import { friendsApi } from '@/api/friends'
import { Avatar } from '@/components/Avatar'
import { Button, EmptyState, ErrorState, Loading, T, TextField } from '@/components/ui'
import { GROUP_MAX_OTHERS, GROUP_NAME_MAX, groupCreateError, groupCreateIds, normalizeGroupName } from '@/features/groups/rules'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { getMyId } from '@/stores/auth'
import { colors, font, radius, spacing } from '@/theme'

export default function CreateGroupScreen() {
  const t = useT()
  const friends = useQuery({ queryKey: qk.friends('all'), queryFn: () => friendsApi.list('all') })
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= GROUP_MAX_OTHERS ? s : [...s, id]))

  const submit = async () => {
    const myId = getMyId()
    const invalid = groupCreateError(selected, myId)
    if (invalid) {
      setError(invalid)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const g = await dmsApi.createGroup(normalizeGroupName(name), groupCreateIds(selected, myId))
      void queryClient.invalidateQueries({ queryKey: qk.conversations })
      router.replace({ pathname: '/group/[groupId]', params: { groupId: g.id, name: g.name } })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  if (friends.isLoading) return <Loading />
  if (friends.error) return <ErrorState message={errorMessage(friends.error)} onRetry={() => void friends.refetch()} />
  const list = (friends.data?.friends ?? []).filter((f) => f.direction === 'accepted')

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.xl, gap: spacing.sm }}
      keyboardShouldPersistTaps="handled"
      data={list}
      keyExtractor={(f) => f.friend_id}
      ListHeaderComponent={
        <View style={{ gap: spacing.md, marginBottom: spacing.sm }}>
          <TextField label={t('social.group.nameOptional')} value={name} onChangeText={setName} maxLength={GROUP_NAME_MAX} placeholder={t('conv.groupFallback')} />
          <T variant="muted">
            {t('social.group.friendsCount', { n: selected.length, max: GROUP_MAX_OTHERS })}
          </T>
        </View>
      }
      ListEmptyComponent={<EmptyState icon="people-outline" title={t('social.group.noFriends')} subtitle={t('social.group.noFriendsHint')} />}
      renderItem={({ item: f }) => {
        const on = selected.includes(f.friend_id)
        return (
          <Pressable
            onPress={() => toggle(f.friend_id)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={f.custom_nickname ?? f.username}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bgHover }]}
          >
            <Avatar uri={f.avatar} name={f.username} size={36} userId={f.friend_id} />
            <Text style={styles.name} numberOfLines={1}>
              {f.custom_nickname ?? f.username}
            </Text>
            <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.primary : colors.textFaint} />
          </Pressable>
        )
      }}
      ListFooterComponent={
        <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
          {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
          <Button title={t('social.group.create')} onPress={submit} loading={loading} disabled={list.length === 0} />
        </View>
      }
    />
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radius.md },
  name: { flex: 1, color: colors.text, fontSize: font.md },
})
