import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useMemo } from 'react'
import { Alert, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native'
import { serversApi } from '@/api/servers'
import { Badge, ErrorState, IconButton, Loading } from '@/components/ui'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { useAuth } from '@/stores/auth'
import { useUnread } from '@/stores/unread'
import { useVoice } from '@/stores/voice'
import type { Channel, Server } from '@/types/models'
import { colors, font, radius, spacing } from '@/theme'
import type { IconName } from '@/components/ui'
import { unreadLabel } from '@/lib/format'

const VOICE_TYPES = new Set(['voice', 'video'])

export function channelIcon(type: string): IconName {
  switch (type) {
    case 'voice':
    case 'video':
      return 'volume-medium'
    case 'announcement':
      return 'megaphone-outline'
    case 'forum':
      return 'chatbox-ellipses-outline'
    case 'stage':
      return 'radio-outline'
    default:
      return 'chatbubble-outline'
  }
}

export function openChannel(server: Server, ch: Channel) {
  if (ch.type === 'text' || ch.type === 'announcement') {
    router.push({ pathname: '/channel/[serverId]/[channelId]', params: { serverId: server.id, channelId: ch.id, name: ch.name } })
  } else if (VOICE_TYPES.has(ch.type)) {
    router.push({ pathname: '/voice/[serverId]/[channelId]', params: { serverId: server.id, channelId: ch.id, name: ch.name, locked: ch.has_voice_password ? '1' : '0' } })
  } else {
    Alert.alert('Bientôt sur mobile', `Les salons de type « ${ch.type} » sont disponibles sur la version web/desktop.`)
  }
}

export function ChannelList({ server }: { server: Server }) {
  const channels = useQuery({ queryKey: qk.channels(server.id), queryFn: () => serversApi.channels(server.id) })
  const categories = useQuery({ queryKey: qk.categories(server.id), queryFn: () => serversApi.categories(server.id) })
  const counts = useUnread((s) => s.counts)
  const voiceChannel = useVoice((s) => s.channelId)
  // Le serveur exige MANAGE_CHANNELS ; ici on n'affiche le bouton qu'au propriétaire.
  const isOwner = useAuth((s) => s.user?.id) === server.owner_id

  const sections = useMemo(() => {
    const list = (channels.data ?? []).filter((c) => !c.hidden && !c.archived)
    const cats = [...(categories.data ?? [])].sort((a, b) => a.position - b.position)
    const byCat = new Map<string | null, Channel[]>()
    for (const c of list) {
      const key = c.category_id && cats.some((k) => k.id === c.category_id) ? c.category_id : null
      byCat.set(key, [...(byCat.get(key) ?? []), c])
    }
    const sort = (arr: Channel[]) => [...arr].sort((a, b) => a.position - b.position)
    const out: { title: string | null; data: Channel[] }[] = []
    if (byCat.get(null)?.length) out.push({ title: null, data: sort(byCat.get(null)!) })
    for (const k of cats) if (byCat.get(k.id)?.length) out.push({ title: k.name, data: sort(byCat.get(k.id)!) })
    return out
  }, [channels.data, categories.data])

  if (channels.isLoading) return <Loading />
  if (channels.error) return <ErrorState message={errorMessage(channels.error)} onRetry={() => void channels.refetch()} />

  const markServerRead = () =>
    serversApi
      .markRead(server.id)
      .then(() => {
        const { counts: c, serverOf } = useUnread.getState()
        Object.keys(c).forEach((id) => serverOf[id] === server.id && useUnread.getState().clear(id))
      })
      .catch((e) => Alert.alert('Erreur', errorMessage(e)))

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgAlt }}>
      <View style={styles.header}>
        <Text style={styles.serverName} numberOfLines={1}>
          {server.name}
        </Text>
        {isOwner ? (
          <IconButton icon="add" label="Créer un salon" onPress={() => router.push(`/server/${server.id}/channel-create`)} size={22} />
        ) : null}
        <IconButton icon="checkmark-done" label="Tout marquer comme lu" onPress={markServerRead} size={20} />
        <IconButton icon="person-add-outline" label="Inviter" onPress={() => router.push(`/server/${server.id}/invite`)} size={20} />
        <IconButton icon="people-outline" label="Membres" onPress={() => router.push(`/server/${server.id}/members`)} size={20} />
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(c) => c.id}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl
            refreshing={channels.isRefetching}
            tintColor={colors.textMuted}
            onRefresh={() => {
              void queryClient.invalidateQueries({ queryKey: qk.channels(server.id) })
              void queryClient.invalidateQueries({ queryKey: qk.categories(server.id) })
            }}
          />
        }
        renderSectionHeader={({ section }) =>
          section.title ? <Text style={styles.category}>{section.title.toUpperCase()}</Text> : <View style={{ height: spacing.sm }} />
        }
        renderItem={({ item }) => {
          const unread = counts[item.id] ?? 0
          const inVoice = voiceChannel === item.id
          return (
            <Pressable
              onPress={() => openChannel(server, item)}
              style={({ pressed }) => [styles.channel, (pressed || inVoice) && { backgroundColor: colors.bgHover }]}
              accessibilityRole="button"
              accessibilityLabel={`Salon ${item.name}${unread ? `, ${unreadLabel(unread)}` : ''}`}
            >
              <Ionicons name={channelIcon(item.type)} size={18} color={unread ? colors.text : colors.textMuted} />
              <Text style={[styles.channelName, unread ? { color: colors.text, fontWeight: '700' } : null]} numberOfLines={1}>
                {item.name}
              </Text>
              {item.has_voice_password ? <Ionicons name="lock-closed" size={12} color={colors.textFaint} /> : null}
              <Badge count={unread} />
            </Pressable>
          )
        }}
        ListEmptyComponent={<Text style={[styles.category, { textAlign: 'center' }]}>Aucun salon</Text>}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    height: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  serverName: { flex: 1, color: colors.text, fontSize: font.lg, fontWeight: '800' },
  category: { color: colors.textMuted, fontSize: font.xs, fontWeight: '700', paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xs },
  channel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    borderRadius: radius.sm,
  },
  channelName: { flex: 1, color: colors.textMuted, fontSize: font.md },
})
