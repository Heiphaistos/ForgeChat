import { useQuery } from '@tanstack/react-query'
import * as Clipboard from 'expo-clipboard'
import { router } from 'expo-router'
import { useMemo } from 'react'
import { Alert } from 'react-native'
import { channelsApi } from '@/api/channels'
import { messagesApi } from '@/api/messages'
import { serversApi } from '@/api/servers'
import { Sheet, type SheetAction } from '@/components/Sheet'
import { T } from '@/components/ui'
import { t } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { useAuth } from '@/stores/auth'
import { useUi } from '@/stores/ui'
import { useUnread } from '@/stores/unread'
import { useVoice } from '@/stores/voice'
import type { Category, Channel, Server } from '@/types/models'
import { spacing } from '@/theme'
import { serverMenuKeys, serverPerms, type ServerMenuKey } from './perms'
import { canSetVoiceStatus } from './discordFeatures'
import { openVoiceStatus, saveVoiceStatus } from '@/features/voice/voiceStatus'

export function useServerDetail(serverId: string, enabled = true) {
  return useQuery({ queryKey: qk.server(serverId), queryFn: () => serversApi.detail(serverId), enabled, staleTime: 60_000 })
}

/** Permissions de l'utilisateur sur ce serveur (voir perms.ts). */
export function useServerPerms(serverId: string, enabled = true) {
  const detail = useServerDetail(serverId, enabled)
  const meId = useAuth((s) => s.user?.id)
  return useMemo(() => serverPerms(detail.data, meId), [detail.data, meId])
}

const copy = (text: string, what: string) =>
  void Clipboard.setStringAsync(text).then(
    () => Alert.alert(t('menu.copied', { what })),
    () => Alert.alert(t('menu.copyFailed')),
  )

function clearServerUnread(serverId: string) {
  const { counts, serverOf, clear } = useUnread.getState()
  Object.keys(counts).forEach((id) => serverOf[id] === serverId && clear(id))
}

const markServerRead = (serverId: string) =>
  serversApi
    .markRead(serverId)
    .then(() => clearServerUnread(serverId))
    .catch((e) => Alert.alert(t('common.error'), errorMessage(e)))

async function leaveServer(server: Server) {
  try {
    if (useVoice.getState().serverId === server.id) useVoice.getState().leave()
    await serversApi.leave(server.id)
    if (useUi.getState().selectedServerId === server.id) useUi.getState().selectServer(null)
    clearServerUnread(server.id)
    await queryClient.invalidateQueries({ queryKey: qk.servers })
  } catch (e) {
    Alert.alert(t('menu.leaveFailed'), errorMessage(e))
  }
}

function confirmLeave(server: Server) {
  Alert.alert(t('menu.leaveConfirm', { name: server.name }), t('menu.leaveBody'), [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('menu.leave'), style: 'destructive', onPress: () => void leaveServer(server) },
  ])
}

/** Boost cosmétique : un par membre et par serveur (le serveur ignore un second boost). */
function confirmBoost(s: Server) {
  Alert.alert(t('menu.boostConfirm', { name: s.name }), t('menu.boostBody'), [
    { text: t('common.cancel'), style: 'cancel' },
    {
      text: t('menu.boost'),
      onPress: () =>
        void serversApi
          .boost(s.id)
          .then((r) => {
            Alert.alert(t('menu.thanks'), t(r.boost_count > 1 ? 'menu.boostResultMany' : 'menu.boostResult', { n: r.boost_count, level: r.boost_level }))
            return Promise.all([qk.servers, qk.server(s.id)].map((queryKey) => queryClient.invalidateQueries({ queryKey })))
          })
          .catch((e) => Alert.alert(t('menu.boostFailed'), errorMessage(e))),
    },
  ])
}

export function setChannelHidden(serverId: string, channelId: string, hidden: boolean) {
  return (hidden ? channelsApi.hide(channelId) : channelsApi.unhide(channelId))
    .then(() => queryClient.invalidateQueries({ queryKey: qk.channels(serverId) }))
    .catch((e) => Alert.alert(t('common.actionFailed'), errorMessage(e)))
}

function serverAction(key: ServerMenuKey, s: Server): SheetAction {
  const go = (p: string) => () => router.push(p as never)
  switch (key) {
    case 'read':
      return { label: t('menu.markRead'), icon: 'checkmark-done', onPress: () => void markServerRead(s.id) }
    case 'invite':
      return { label: t('menu.invite'), icon: 'person-add-outline', onPress: go(`/server/${s.id}/invite`) }
    case 'notifications':
      return { label: t('menu.serverNotifications'), icon: 'notifications-outline', onPress: go(`/server/${s.id}/notifications`) }
    case 'events':
      return { label: t('menu.events'), icon: 'calendar-outline', onPress: go(`/server/${s.id}/events`) }
    case 'community':
      return { label: t('community.menu'), icon: 'trophy-outline', onPress: go(`/server/${s.id}/community`) }
    case 'boost':
      return { label: t('menu.boostServer'), icon: 'flash-outline', onPress: () => confirmBoost(s) }
    case 'createChannel':
      return { label: t('menu.createChannel'), icon: 'add-circle-outline', onPress: go(`/server/${s.id}/channel-create`) }
    case 'createCategory':
      return { label: t('menu.createCategory'), icon: 'folder-open-outline', onPress: go(`/server/${s.id}/channel-create?type=category`) }
    case 'settings':
      return { label: t('menu.settings'), icon: 'settings-outline', onPress: go(`/server/${s.id}/settings`) }
    case 'nickname':
      return { label: t('menu.nickname'), icon: 'person-circle-outline', onPress: go(`/server/${s.id}/nickname`) }
    case 'onboarding':
      return { label: t('menu.onboarding'), icon: 'sparkles-outline', onPress: go(`/server/${s.id}/onboarding`) }
    case 'copyId':
      return { label: t('menu.copyServerId'), icon: 'copy-outline', onPress: () => copy(s.id, 'ID') }
    case 'leave':
      return { label: t('menu.leaveServer'), icon: 'exit-outline', danger: true, onPress: () => confirmLeave(s) }
    case 'delete':
      return { label: t('menu.deleteServer'), icon: 'trash-outline', danger: true, onPress: go(`/server/${s.id}/delete`) }
  }
}

/** Menu d'un serveur, comme le clic droit du web : appui long sur le rail ou appui sur l'en-tête de la liste. */
export function ServerMenu({ server, visible, onClose }: { server: Server; visible: boolean; onClose: () => void }) {
  const perms = useServerPerms(server.id, visible)
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={server.name}
      header={perms.loaded ? null : <T variant="muted" style={{ paddingHorizontal: spacing.lg }}>{t('menu.loadingPerms')}</T>}
      actions={serverMenuKeys(perms).map((k) => serverAction(k, server))}
    />
  )
}

function confirmDelete(title: string, message: string, run: () => Promise<unknown>, serverId: string) {
  Alert.alert(title, message, [
    { text: t('common.cancel'), style: 'cancel' },
    {
      text: t('common.delete'),
      style: 'destructive',
      onPress: () =>
        void run()
          .then(() => {
            void queryClient.invalidateQueries({ queryKey: qk.channels(serverId) })
            void queryClient.invalidateQueries({ queryKey: qk.categories(serverId) })
            void queryClient.invalidateQueries({ queryKey: qk.server(serverId) })
          })
          .catch((e) => Alert.alert(t('menu.deleteFailed'), errorMessage(e))),
    },
  ])
}

export function confirmDeleteChannel(serverId: string, ch: Channel, after?: () => void) {
  confirmDelete(t('menu.deleteChannelConfirm', { name: ch.name }), t('menu.deleteChannelBody'), async () => {
    await serversApi.deleteChannel(serverId, ch.id)
    after?.()
  }, serverId)
}

/** Appui long sur un salon de la liste. */
export function ChannelMenu({ server, channel, onClose }: { server: Server; channel: Channel | null; onClose: () => void }) {
  const perms = useServerPerms(server.id)
  const inVoice = useVoice((s) => s.channelId)
  const ch = channel
  const actions: SheetAction[] = []
  if (ch && canSetVoiceStatus(ch.type, ch.id, inVoice, perms.canEditChannels)) {
    actions.push({ label: t('df.voice.set'), icon: 'chatbubble-ellipses-outline', onPress: () => openVoiceStatus(server.id, ch.id) })
    if (ch.voice_status)
      actions.push({
        label: t('df.voice.clear'),
        icon: 'close-circle-outline',
        onPress: () => void saveVoiceStatus(server.id, ch.id, null).catch((e: unknown) => Alert.alert(t('common.actionFailed'), errorMessage(e))),
      })
  }
  if (ch) {
    actions.push({
      label: t('menu.markRead'),
      icon: 'checkmark-done',
      onPress: () =>
        void messagesApi
          .markRead({ kind: 'channel', serverId: server.id, channelId: ch.id })
          ?.then(() => useUnread.getState().clear(ch.id))
          .catch((e: unknown) => Alert.alert(t('common.error'), errorMessage(e))),
    })
    actions.push({
      label: t('menu.channelNotifications'),
      icon: 'notifications-outline',
      onPress: () => router.push({ pathname: '/server/[serverId]/notifications', params: { serverId: server.id, channelId: ch.id, name: ch.name } }),
    })
    if (perms.canEditChannels)
      actions.push({
        label: t('menu.editChannel'),
        icon: 'create-outline',
        onPress: () => router.push({ pathname: '/server/[serverId]/settings/channel/[channelId]', params: { serverId: server.id, channelId: ch.id } }),
      })
    actions.push({ label: t('menu.hideChannel'), icon: 'eye-off-outline', onPress: () => void setChannelHidden(server.id, ch.id, true) })
    actions.push({ label: t('menu.copyLink'), icon: 'link-outline', onPress: () => copy(`forgechat://channel/${server.id}/${ch.id}`, t('menu.link')) })
    actions.push({ label: t('menu.copyChannelId'), icon: 'copy-outline', onPress: () => copy(ch.id, 'ID') })
    if (perms.loaded && perms.canDeleteChannel(ch.created_by))
      actions.push({ label: t('menu.deleteChannel'), icon: 'trash-outline', danger: true, onPress: () => confirmDeleteChannel(server.id, ch) })
  }
  return <Sheet visible={!!ch} onClose={onClose} title={ch ? `# ${ch.name}` : undefined} actions={actions} />
}

/** Appui long sur une catégorie. */
export function CategoryMenu({ server, category, onClose }: { server: Server; category: Category | null; onClose: () => void }) {
  const perms = useServerPerms(server.id)
  const cat = category
  const actions: SheetAction[] = []
  if (cat) {
    if (perms.canCreateChannels)
      actions.push({
        label: t('menu.createHere'),
        icon: 'add-circle-outline',
        onPress: () => router.push({ pathname: '/server/[serverId]/channel-create', params: { serverId: server.id, categoryId: cat.id } }),
      })
    actions.push({ label: t('menu.copyCategoryId'), icon: 'copy-outline', onPress: () => copy(cat.id, 'ID') })
    if (perms.loaded && perms.canDeleteChannel(cat.created_by))
      actions.push({
        label: t('menu.deleteCategory'),
        icon: 'trash-outline',
        danger: true,
        onPress: () =>
          confirmDelete(t('menu.deleteCategoryConfirm', { name: cat.name }), t('menu.deleteCategoryBody'), () => serversApi.deleteCategory(server.id, cat.id), server.id),
      })
  }
  return <Sheet visible={!!cat} onClose={onClose} title={cat?.name.toUpperCase()} actions={actions} />
}
