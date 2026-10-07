import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { Image } from 'expo-image'
import { useMemo, useState } from 'react'
import { Alert, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native'
import { serversApi } from '@/api/servers'
import { Avatar } from '@/components/Avatar'
import { Sheet } from '@/components/Sheet'
import { Badge, ErrorState, IconButton, Loading } from '@/components/ui'
import { errorMessage } from '@/lib/http'
import { resolveMediaUrl } from '@/lib/links'
import { qk, queryClient } from '@/lib/queryClient'
import { useUnread } from '@/stores/unread'
import { useVoice } from '@/stores/voice'
import type { Category, Channel, Server } from '@/types/models'
import { channelSections } from './channels'
import { CategoryMenu, ChannelMenu, ServerMenu, setChannelHidden, useServerPerms } from './menus'
import { colors, font, radius, spacing } from '@/theme'
import type { IconName } from '@/components/ui'
import { t as tr, useT } from '@/i18n'
import { unreadLabel } from '@/lib/format'

const VOICE_TYPES = new Set(['voice', 'video', 'stage'])

export function channelIcon(type: string): IconName {
  switch (type) {
    case 'voice':
    case 'video':
      return 'volume-medium'
    case 'announcement':
      return 'megaphone-outline'
    case 'forum':
      return 'chatbox-ellipses-outline'
    case 'media':
      return 'images-outline'
    case 'stage':
      return 'radio-outline'
    default:
      return 'chatbubble-outline'
  }
}

export function openChannel(server: Server, ch: Channel) {
  if (ch.type === 'text' || ch.type === 'announcement') {
    router.push({ pathname: '/channel/[serverId]/[channelId]', params: { serverId: server.id, channelId: ch.id, name: ch.name } })
  } else if (ch.type === 'forum' || ch.type === 'media') {
    // Salon média = forum affiché en grille (media=1)
    router.push({ pathname: '/forum/[serverId]/[channelId]', params: { serverId: server.id, channelId: ch.id, name: ch.name, media: ch.type === 'media' ? '1' : '0' } })
  } else if (VOICE_TYPES.has(ch.type)) {
    router.push({
      pathname: '/voice/[serverId]/[channelId]',
      params: { serverId: server.id, channelId: ch.id, name: ch.name, locked: ch.has_voice_password ? '1' : '0', stage: ch.type === 'stage' ? '1' : '0' },
    })
  } else {
    Alert.alert(tr('channels.soon'), tr('channels.soonBody', { type: ch.type }))
  }
}

export function ChannelList({ server }: { server: Server }) {
  const t = useT()
  const channels = useQuery({ queryKey: qk.channels(server.id), queryFn: () => serversApi.channels(server.id) })
  const categories = useQuery({ queryKey: qk.categories(server.id), queryFn: () => serversApi.categories(server.id) })
  const counts = useUnread((s) => s.counts)
  const voiceChannel = useVoice((s) => s.channelId)
  const perms = useServerPerms(server.id)
  const [menu, setMenu] = useState(false)
  const [channelMenu, setChannelMenu] = useState<Channel | null>(null)
  const [categoryMenu, setCategoryMenu] = useState<Category | null>(null)
  const [hiddenMenu, setHiddenMenu] = useState(false)

  const sections = useMemo(() => channelSections(channels.data ?? [], categories.data ?? []), [channels.data, categories.data])
  // Masqués pour moi seul (POST /channels/:id/hide) : réaffichables d'ici.
  const hidden = (channels.data ?? []).filter((c) => c.hidden && !c.archived)

  if (channels.isLoading) return <Loading />
  if (channels.error) return <ErrorState message={errorMessage(channels.error)} onRetry={() => void channels.refetch()} />

  const banner = resolveMediaUrl(server.banner)

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgAlt }}>
      <Pressable
        onPress={() => setMenu(true)}
        accessibilityRole="button"
        accessibilityLabel={t('channels.serverOptions', { name: server.name })}
        style={({ pressed }) => [pressed && { opacity: 0.8 }]}
      >
        {banner ? <Image source={{ uri: banner }} style={styles.banner} contentFit="cover" accessible={false} /> : null}
        <View style={styles.header}>
          {banner ? null : <Avatar uri={server.icon} name={server.name} size={28} rounded={false} />}
          <Text style={styles.serverName} numberOfLines={1}>
            {server.name}
          </Text>
          <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
        </View>
      </Pressable>
      <View style={styles.toolbar}>
        {perms.canCreateChannels ? (
          <IconButton icon="add" label={t('channels.create')} onPress={() => router.push(`/server/${server.id}/channel-create`)} size={20} />
        ) : null}
        <IconButton icon="people-outline" label={t('channels.members')} onPress={() => router.push(`/server/${server.id}/members`)} size={20} />
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
              void queryClient.invalidateQueries({ queryKey: qk.server(server.id) })
            }}
          />
        }
        renderSectionHeader={({ section }) => {
          const cat = section.category
          return cat ? (
            <Pressable
              onLongPress={() => setCategoryMenu(cat)}
              accessibilityRole="header"
              accessibilityHint={t('channels.categoryHint')}
              accessibilityActions={[{ name: 'longpress', label: t('channels.categoryOptions') }]}
              onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && setCategoryMenu(cat)}
            >
              <Text style={styles.category}>{cat.name.toUpperCase()}</Text>
            </Pressable>
          ) : (
            <View style={{ height: spacing.sm }} />
          )
        }}
        renderItem={({ item }) => {
          const unread = counts[item.id] ?? 0
          const inVoice = voiceChannel === item.id
          return (
            <Pressable
              onPress={() => openChannel(server, item)}
              onLongPress={() => setChannelMenu(item)}
              style={({ pressed }) => [styles.channel, (pressed || inVoice) && { backgroundColor: colors.bgHover }]}
              accessibilityRole="button"
              accessibilityLabel={`${t('channels.channel', { name: item.name })}${unread ? `, ${unreadLabel(unread)}` : ''}`}
              accessibilityHint={t('channels.channelHint')}
              accessibilityActions={[{ name: 'longpress', label: t('channels.channelOptions') }]}
              onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && setChannelMenu(item)}
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
        ListFooterComponent={
          hidden.length ? (
            <Pressable onPress={() => setHiddenMenu(true)} accessibilityRole="button" style={styles.channel}>
              <Ionicons name="eye-off-outline" size={18} color={colors.textFaint} />
              <Text style={styles.channelName}>
                {t(hidden.length > 1 ? 'channels.hiddenMany' : 'channels.hiddenOne', { n: hidden.length })}
              </Text>
            </Pressable>
          ) : null
        }
        ListEmptyComponent={<Text style={[styles.category, { textAlign: 'center' }]}>{t('channels.none')}</Text>}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
      />
      <ServerMenu server={server} visible={menu} onClose={() => setMenu(false)} />
      <ChannelMenu server={server} channel={channelMenu} onClose={() => setChannelMenu(null)} />
      <CategoryMenu server={server} category={categoryMenu} onClose={() => setCategoryMenu(null)} />
      <Sheet
        visible={hiddenMenu}
        onClose={() => setHiddenMenu(false)}
        title={t('channels.hiddenTitle')}
        actions={hidden.map((c) => ({ label: t('channels.unhide', { name: c.name }), icon: 'eye-outline', onPress: () => void setChannelHidden(server.id, c.id, false) }))}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  banner: { height: 96, width: '100%' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, minHeight: 52 },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.xs,
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
