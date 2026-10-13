import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { Alert, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native'
import { serversApi } from '@/api/servers'
import { settingsApi } from '@/api/settings'
import { categoryLookFor, categoryStyles } from '@/features/appearance/categoryLook'
import { themeStudioKey } from '@/features/appearance/sync'
import { useAppearance } from '@/theme/prefs'
import { Avatar } from '@/components/Avatar'
import { UserName } from '@/components/UserName'
import { Sheet } from '@/components/Sheet'
import { Badge, ErrorState, IconButton, Loading } from '@/components/ui'
import { errorMessage } from '@/lib/http'
import { resolveMediaUrl } from '@/lib/links'
import { qk, queryClient } from '@/lib/queryClient'
import { useAuth } from '@/stores/auth'
import { useUi } from '@/stores/ui'
import { useUnread } from '@/stores/unread'
import { useVoice } from '@/stores/voice'
import { useVoiceRooms, type VoiceRoomMember } from '@/stores/voiceRooms'
import type { Category, Channel, Server } from '@/types/models'
import { channelSections } from './channels'
import { FullBanner } from '@/features/account/ProfileBanner'
import { LookBackdrop } from './LookBackdrop'
import { ServerIconView } from './ServerIconView'
import { bannerBounds, bannerOverlay, cleanLook, hex, iconRadius } from './serverLook'
import { CategoryMenu, ChannelMenu, ServerMenu, setChannelHidden, useServerPerms } from './menus'
import { colors, font, radius, spacing } from '@/theme'
import type { IconName } from '@/components/ui'
import { t as tr, useT } from '@/i18n'

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

/**
 * Salons du serveur, comme la barre latérale du web (ChannelSidebar) : catégories repliables, non-lus
 * (point) et mentions (pastille rouge), participants des salons vocaux. Les salons que je ne peux pas
 * voir ne sont jamais renvoyés par le serveur. `onOpen` : ouverture d'un salon (accueil : panneau glissant).
 */
export function ChannelList({
  server,
  activeChannelId = null,
  onOpen = (ch) => openChannel(server, ch),
}: {
  server: Server
  activeChannelId?: string | null
  onOpen?: (ch: Channel) => void
}) {
  const t = useT()
  const channels = useQuery({ queryKey: qk.channels(server.id), queryFn: () => serversApi.channels(server.id) })
  const categories = useQuery({ queryKey: qk.categories(server.id), queryFn: () => serversApi.categories(server.id) })
  const counts = useUnread((s) => s.counts)
  const mentions = useUnread((s) => s.mentions)
  const voiceChannel = useVoice((s) => s.channelId)
  const rooms = useVoiceRooms((s) => s.rooms)
  const me = useAuth((s) => s.user)
  const collapsed = useUi((s) => s.collapsed)
  const foldedByDefault = useAppearance((s) => s.categoriesFolded)
  const isFolded = (id: string) => collapsed[id] ?? foldedByDefault
  const toggleCategory = useUi((s) => s.toggleCategory)
  const perms = useServerPerms(server.id)
  // Style des catégories choisi sur le web ou le bureau (propre à ce serveur ou général).
  const studio = useQuery({ queryKey: themeStudioKey, queryFn: settingsApi.themeStudio, staleTime: 60_000 })
  const catLook = categoryLookFor(studio.data, server.id)
  const catStyle = categoryStyles(catLook)
  const [menu, setMenu] = useState(false)
  const [channelMenu, setChannelMenu] = useState<Channel | null>(null)
  const [categoryMenu, setCategoryMenu] = useState<Category | null>(null)
  const [hiddenMenu, setHiddenMenu] = useState(false)

  // Catégorie repliée : n'y restent que le salon ouvert, les non-lus et mon salon vocal (comme Discord).
  const sections = useMemo(
    () =>
      channelSections(channels.data ?? [], categories.data ?? []).map((sec) =>
        sec.category && isFolded(sec.category.id)
          ? { ...sec, data: sec.data.filter((c) => c.id === activeChannelId || c.id === voiceChannel || (counts[c.id] ?? 0) > 0) }
          : sec,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isFolded ne lit que collapsed et foldedByDefault
    [channels.data, categories.data, collapsed, foldedByDefault, activeChannelId, voiceChannel, counts],
  )
  // Moi en tête si je suis dans le salon (le serveur ne m'envoie pas mes propres arrivées).
  const participants = (channelId: string): VoiceRoomMember[] => {
    const others = (rooms[channelId] ?? []).filter((p) => p.userId !== me?.id)
    return voiceChannel === channelId && me ? [{ userId: me.id, username: me.username, avatar: me.avatar, muted: false }, ...others] : others
  }
  // Masqués pour moi seul (POST /channels/:id/hide) : réaffichables d'ici.
  const hidden = (channels.data ?? []).filter((c) => c.hidden && !c.archived)

  // Apparence du serveur : bannière (hauteur, cadrage, voile), accent, forme de l'icône, fond.
  const look = useMemo(() => cleanLook(server.look), [server.look])

  if (channels.isLoading) return <Loading />
  if (channels.error) return <ErrorState message={errorMessage(channels.error)} onRetry={() => void channels.refetch()} />

  const banner = resolveMediaUrl(server.banner)
  const bounds = bannerBounds(look?.banner)
  const veil = bannerOverlay(look?.banner, look?.accent)

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgAlt }}>
      <LookBackdrop bg={look?.sidebar_bg} />
      <Pressable
        onPress={() => setMenu(true)}
        accessibilityRole="button"
        accessibilityLabel={t('channels.serverOptions', { name: server.name })}
        style={({ pressed }) => [pressed && { opacity: 0.8 }, !banner && look?.accent != null && { backgroundColor: hex(look.accent) }]}
      >
        {/* Bannière entière (proportions de l'image, bornées), jamais rognée. */}
        {banner ? (
          <FullBanner uri={server.banner} minHeight={bounds.min} maxHeight={bounds.max} focus={look?.banner ? { x: look.banner.focus_x, y: look.banner.focus_y } : undefined}>
            {veil ? (
              <View
                pointerEvents="none"
                style={[
                  { position: 'absolute', left: 0, right: 0, backgroundColor: veil.color, opacity: veil.opacity },
                  veil.at === 'full' ? { top: 0, bottom: 0 } : veil.at === 'top' ? { top: 0, height: '40%' } : { bottom: 0, height: '40%' },
                ]}
              />
            ) : null}
          </FullBanner>
        ) : null}
        <View style={styles.header}>
          {banner ? null : <ServerIconView uri={server.icon} name={server.name} size={28} radius={iconRadius(look?.icon_shape, 28)} />}
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
          const folded = !!(cat && isFolded(cat.id))
          return cat ? (
            <Pressable
              onPress={() => toggleCategory(cat.id, folded)}
              onLongPress={() => setCategoryMenu(cat)}
              accessibilityRole="button"
              accessibilityLabel={folded ? `${cat.name}, ${t('channels.collapsed')}` : cat.name}
              accessibilityState={{ expanded: !folded }}
              accessibilityHint={t('channels.categoryHint')}
              accessibilityActions={[{ name: 'longpress', label: t('channels.categoryOptions') }]}
              onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && setCategoryMenu(cat)}
              style={[styles.categoryRow, catStyle.row]}
            >
              <Ionicons name={folded ? 'chevron-forward' : 'chevron-down'} size={12} color={colors.textMuted} />
              <Text style={[styles.category, catStyle.text]}>{catLook.uppercase ? cat.name.toUpperCase() : cat.name}</Text>
            </Pressable>
          ) : (
            <View style={{ height: spacing.sm }} />
          )
        }}
        renderItem={({ item }) => {
          const isVoice = VOICE_TYPES.has(item.type)
          const unread = isVoice ? 0 : (counts[item.id] ?? 0)
          const mention = isVoice ? 0 : (mentions[item.id] ?? 0)
          const highlighted = voiceChannel === item.id || activeChannelId === item.id
          const people = isVoice ? participants(item.id) : []
          const status = mention
            ? t(mention > 1 ? 'channels.mentionsMany' : 'channels.mentionsOne', { n: mention })
            : unread
              ? t('channels.unreadMessages')
              : ''
          return (
            <>
              <Pressable
                onPress={() => onOpen(item)}
                onLongPress={() => setChannelMenu(item)}
                style={({ pressed }) => [styles.channel, (pressed || highlighted) && { backgroundColor: colors.bgHover }]}
                accessibilityRole="button"
                accessibilityState={{ selected: highlighted }}
                accessibilityLabel={`${t('channels.channel', { name: item.name })}${status ? `, ${status}` : ''}`}
                accessibilityHint={t('channels.channelHint')}
                accessibilityActions={[{ name: 'longpress', label: t('channels.channelOptions') }]}
                onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && setChannelMenu(item)}
              >
                <Ionicons name={channelIcon(item.type)} size={18} color={unread || highlighted ? colors.text : colors.textMuted} />
                <Text style={[styles.channelName, unread || highlighted ? { color: colors.text } : null, unread ? { fontWeight: '700' } : null]} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.has_voice_password ? <Ionicons name="lock-closed" size={12} color={colors.textFaint} /> : null}
                {/* Discord : pastille rouge chiffrée pour les mentions, point pour le simple non-lu. */}
                {mention ? <Badge count={mention} /> : unread ? <View style={[styles.dot, look?.unread_color != null && { backgroundColor: hex(look.unread_color) }]} /> : null}
              </Pressable>
              {people.map((p) => (
                <View key={p.userId} style={styles.participant} accessible accessibilityLabel={p.muted ? `${p.username}, ${t('channels.micOff')}` : p.username}>
                  <Avatar uri={p.avatar} name={p.username} size={20} />
                  <UserName userId={p.userId} name={p.username} style={styles.participantName} />
                  {p.muted ? <Ionicons name="mic-off" size={12} color={colors.textFaint} /> : null}
                </View>
              ))}
            </>
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
        ListEmptyComponent={<Text style={styles.empty}>{t('channels.none')}</Text>}
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
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, minHeight: 52 },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  serverName: { flex: 1, color: colors.text, fontSize: font.lg, fontWeight: '800' },
  categoryRow: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: spacing.sm, paddingTop: spacing.lg, paddingBottom: spacing.xs },
  category: { color: colors.textMuted, fontSize: font.xs, fontWeight: '700' },
  empty: { color: colors.textMuted, fontSize: font.xs, fontWeight: '700', textAlign: 'center', paddingTop: spacing.lg },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.text },
  participant: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginLeft: 44, marginRight: spacing.sm, paddingVertical: 3 },
  participantName: { flex: 1, color: colors.textMuted, fontSize: font.sm },
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
