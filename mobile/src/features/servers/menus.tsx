import { useQuery } from '@tanstack/react-query'
import * as Clipboard from 'expo-clipboard'
import { router } from 'expo-router'
import { useMemo } from 'react'
import { Alert } from 'react-native'
import { messagesApi } from '@/api/messages'
import { serversApi } from '@/api/servers'
import { Sheet, type SheetAction } from '@/components/Sheet'
import { T } from '@/components/ui'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { useAuth } from '@/stores/auth'
import { useUi } from '@/stores/ui'
import { useUnread } from '@/stores/unread'
import { useVoice } from '@/stores/voice'
import type { Category, Channel, Server } from '@/types/models'
import { spacing } from '@/theme'
import { serverMenuKeys, serverPerms, type ServerMenuKey } from './perms'

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
    () => Alert.alert(`${what} copié`),
    () => Alert.alert('Copie impossible'),
  )

function clearServerUnread(serverId: string) {
  const { counts, serverOf, clear } = useUnread.getState()
  Object.keys(counts).forEach((id) => serverOf[id] === serverId && clear(id))
}

const markServerRead = (serverId: string) =>
  serversApi
    .markRead(serverId)
    .then(() => clearServerUnread(serverId))
    .catch((e) => Alert.alert('Erreur', errorMessage(e)))

async function leaveServer(server: Server) {
  try {
    if (useVoice.getState().serverId === server.id) useVoice.getState().leave()
    await serversApi.leave(server.id)
    if (useUi.getState().selectedServerId === server.id) useUi.getState().selectServer(null)
    clearServerUnread(server.id)
    await queryClient.invalidateQueries({ queryKey: qk.servers })
  } catch (e) {
    Alert.alert('Impossible de quitter', errorMessage(e))
  }
}

function confirmLeave(server: Server) {
  Alert.alert(`Quitter ${server.name} ?`, 'Tu ne pourras revenir qu’avec une nouvelle invitation.', [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Quitter', style: 'destructive', onPress: () => void leaveServer(server) },
  ])
}

function serverAction(key: ServerMenuKey, s: Server): SheetAction {
  const go = (p: string) => () => router.push(p as never)
  switch (key) {
    case 'read':
      return { label: 'Marquer comme lu', icon: 'checkmark-done', onPress: () => void markServerRead(s.id) }
    case 'invite':
      return { label: 'Inviter des gens', icon: 'person-add-outline', onPress: go(`/server/${s.id}/invite`) }
    case 'notifications':
      return { label: 'Notifications du serveur', icon: 'notifications-outline', onPress: go(`/server/${s.id}/notifications`) }
    case 'createChannel':
      return { label: 'Créer un salon', icon: 'add-circle-outline', onPress: go(`/server/${s.id}/channel-create`) }
    case 'createCategory':
      return { label: 'Créer une catégorie', icon: 'folder-open-outline', onPress: go(`/server/${s.id}/channel-create?type=category`) }
    case 'settings':
      return { label: 'Paramètres du serveur', icon: 'settings-outline', onPress: go(`/server/${s.id}/settings`) }
    case 'nickname':
      return { label: 'Modifier mon profil de serveur', icon: 'person-circle-outline', onPress: go(`/server/${s.id}/nickname`) }
    case 'copyId':
      return { label: "Copier l'ID du serveur", icon: 'copy-outline', onPress: () => copy(s.id, 'ID') }
    case 'leave':
      return { label: 'Quitter le serveur', icon: 'exit-outline', danger: true, onPress: () => confirmLeave(s) }
    case 'delete':
      return { label: 'Supprimer le serveur', icon: 'trash-outline', danger: true, onPress: go(`/server/${s.id}/delete`) }
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
      header={perms.loaded ? null : <T variant="muted" style={{ paddingHorizontal: spacing.lg }}>Chargement des droits…</T>}
      actions={serverMenuKeys(perms).map((k) => serverAction(k, server))}
    />
  )
}

function confirmDelete(title: string, message: string, run: () => Promise<unknown>, serverId: string) {
  Alert.alert(title, message, [
    { text: 'Annuler', style: 'cancel' },
    {
      text: 'Supprimer',
      style: 'destructive',
      onPress: () =>
        void run()
          .then(() => {
            void queryClient.invalidateQueries({ queryKey: qk.channels(serverId) })
            void queryClient.invalidateQueries({ queryKey: qk.categories(serverId) })
            void queryClient.invalidateQueries({ queryKey: qk.server(serverId) })
          })
          .catch((e) => Alert.alert('Suppression impossible', errorMessage(e))),
    },
  ])
}

export function confirmDeleteChannel(serverId: string, ch: Channel, after?: () => void) {
  confirmDelete(`Supprimer #${ch.name} ?`, 'Le salon et tous ses messages seront supprimés définitivement.', async () => {
    await serversApi.deleteChannel(serverId, ch.id)
    after?.()
  }, serverId)
}

/** Appui long sur un salon de la liste. */
export function ChannelMenu({ server, channel, onClose }: { server: Server; channel: Channel | null; onClose: () => void }) {
  const perms = useServerPerms(server.id)
  const ch = channel
  const actions: SheetAction[] = []
  if (ch) {
    actions.push({
      label: 'Marquer comme lu',
      icon: 'checkmark-done',
      onPress: () =>
        void messagesApi
          .markRead({ kind: 'channel', serverId: server.id, channelId: ch.id })
          ?.then(() => useUnread.getState().clear(ch.id))
          .catch((e: unknown) => Alert.alert('Erreur', errorMessage(e))),
    })
    actions.push({
      label: 'Notifications du salon',
      icon: 'notifications-outline',
      onPress: () => router.push({ pathname: '/server/[serverId]/notifications', params: { serverId: server.id, channelId: ch.id, name: ch.name } }),
    })
    if (perms.canEditChannels)
      actions.push({
        label: 'Modifier le salon',
        icon: 'create-outline',
        onPress: () => router.push({ pathname: '/server/[serverId]/settings/channel/[channelId]', params: { serverId: server.id, channelId: ch.id } }),
      })
    actions.push({ label: 'Copier le lien', icon: 'link-outline', onPress: () => copy(`forgechat://channel/${server.id}/${ch.id}`, 'Lien') })
    actions.push({ label: "Copier l'ID du salon", icon: 'copy-outline', onPress: () => copy(ch.id, 'ID') })
    if (perms.loaded && perms.canDeleteChannel(ch.created_by))
      actions.push({ label: 'Supprimer le salon', icon: 'trash-outline', danger: true, onPress: () => confirmDeleteChannel(server.id, ch) })
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
        label: 'Créer un salon ici',
        icon: 'add-circle-outline',
        onPress: () => router.push({ pathname: '/server/[serverId]/channel-create', params: { serverId: server.id, categoryId: cat.id } }),
      })
    actions.push({ label: "Copier l'ID de la catégorie", icon: 'copy-outline', onPress: () => copy(cat.id, 'ID') })
    if (perms.loaded && perms.canDeleteChannel(cat.created_by))
      actions.push({
        label: 'Supprimer la catégorie',
        icon: 'trash-outline',
        danger: true,
        onPress: () =>
          confirmDelete(`Supprimer « ${cat.name} » ?`, 'Ses salons sont conservés et sortent de la catégorie.', () => serversApi.deleteCategory(server.id, cat.id), server.id),
      })
  }
  return <Sheet visible={!!cat} onClose={onClose} title={cat?.name.toUpperCase()} actions={actions} />
}
