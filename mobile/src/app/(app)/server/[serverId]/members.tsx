import { useQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { serversApi } from '@/api/servers'
import { userRoute } from '@/features/servers/memberProfile'
import { openUserMenu } from '@/features/userMenu/UserMenuHost'
import { Avatar } from '@/components/Avatar'
import { AvatarRing, effectiveRing } from '@/components/AvatarRing'
import { UserName } from '@/components/UserName'
import { ErrorState, Loading } from '@/components/ui'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk } from '@/lib/queryClient'
import { RoleIcon, useRoleDecor } from '@/features/servers/roleDecor'
import { usePresence } from '@/stores/presence'
import { RichStatusText } from '@/features/social/RichStatusText'
import { colors, font, radius, spacing } from '@/theme'

export default function MembersScreen() {
  const t = useT()
  // `manage=1` : ouvert depuis les paramètres du serveur, toucher un membre ouvre sa gestion.
  const { valid, ids, text } = useRouteParams(['serverId'] as const, ['manage'])
  const manage = text.manage === '1'
  const q = useQuery({ queryKey: qk.members(ids.serverId ?? ''), queryFn: () => serversApi.members(ids.serverId), enabled: valid })
  const statuses = usePresence((s) => s.statuses)
  const activities = usePresence((s) => s.activities)
  const decorOf = useRoleDecor(ids.serverId ?? '')
  const [search, setSearch] = useState('')

  const sorted = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const list = (q.data ?? []).filter((m) => !needle || m.username.toLowerCase().includes(needle) || m.nickname?.toLowerCase().includes(needle))
    const online = (id: string, fallback?: string) => {
      const s = statuses[id] ?? fallback ?? 'offline'
      return s !== 'offline' && s !== 'invisible'
    }
    return [...list].sort((a, b) => Number(online(b.user_id, b.status)) - Number(online(a.user_id, a.status)) || a.username.localeCompare(b.username))
  }, [q.data, statuses, search])

  if (!valid) return <ErrorState message={t('server.invalid')} />
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {manage ? <Stack.Screen options={{ title: t('server.members.manageTitle') }} /> : null}
      <TextInput
        style={styles.search}
        placeholder={t('server.members.search')}
        placeholderTextColor={colors.textFaint}
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <FlatList
        data={sorted}
        keyExtractor={(m) => m.user_id}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() =>
              manage
                ? router.push({ pathname: '/server/[serverId]/settings/member/[userId]', params: { serverId: ids.serverId, userId: item.user_id } })
                : router.push(userRoute(item.user_id, ids.serverId))
            }
            onLongPress={() => openUserMenu({ userId: item.user_id, name: item.nickname || item.username, avatar: item.avatar, serverId: ids.serverId })}
            delayLongPress={300}
            accessibilityRole="button"
            accessibilityLabel={item.is_owner ? t('server.members.owner', { name: item.nickname || item.username }) : item.nickname || item.username}
          >
            {/* Anneau effectif : profil de serveur, sinon anneau global du compte. */}
            <AvatarRing ring={effectiveRing(item)} size={38}>
              <Avatar uri={item.avatar} name={item.username} userId={item.user_id} status={item.status} showStatus size={38} decoration={item.avatar_decoration} decorationOpts={item.avatar_decoration_opts} />
            </AvatarRing>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                <UserName
                  userId={item.user_id}
                  name={item.username}
                  nickname={item.nickname}
                  roleColor={decorOf(item.user_id)?.color}
                  serverId={ids.serverId}
                  style={[styles.name, { flexShrink: 1 }]}
                  showTag
                />
                {item.is_owner ? <Text>👑</Text> : null}
                <RoleIcon icon={decorOf(item.user_id)?.icon} title={decorOf(item.user_id)?.iconTitle} />
              </View>
              {item.nickname ? <Text style={styles.sub}>{item.username}</Text> : null}
              <RichStatusText activity={activities[item.user_id]} style={styles.sub} />
            </View>
          </Pressable>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  search: { margin: spacing.md, backgroundColor: colors.bgDeep, color: colors.text, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  name: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  sub: { color: colors.textMuted, fontSize: font.xs },
})
