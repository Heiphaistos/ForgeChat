// Écouteur global FORUM_POST_CREATE : alerte d'un nouveau post de forum selon
// le centre de notifications (forum en « tous les messages », ou serveur
// réglé sur « m'alerter à chaque nouveau post de forum »). Le serveur
// n'envoie l'événement qu'aux membres qui voient le forum.
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useWs } from '../store/ws'
import { useAuth } from '../store/auth'
import { useChannelNotif, forumPostAlerts } from '../store/channelNotif'
import { sendNativeNotification } from './usePushNotifications'
import { useAudioNotifications } from './useAudioNotifications'
import { t } from '../i18n'

interface ForumPostEvent {
  server_id?: string
  channel_id?: string
  post?: { id: string; title?: string; creator_id?: string }
}

export function useForumPostNotifications() {
  const { on } = useWs()
  const qc = useQueryClient()
  const nav = useNavigate()
  const userId = useAuth(s => s.user?.id)
  const focusMode = useAuth(s => s.user?.focus_mode)
  const { playMessage } = useAudioNotifications()

  useEffect(() => {
    if (!userId) return
    return on('FORUM_POST_CREATE', (raw) => {
      const d = raw as ForumPostEvent
      const { server_id: serverId, channel_id: channelId, post } = d
      if (!serverId || !channelId || !post || post.creator_id === userId || focusMode) return
      const path = `/servers/${serverId}/channels/${channelId}`
      if (window.location.pathname === path) return
      const n = useChannelNotif.getState()
      if (n.isMuted(channelId) || n.isServerMuted(serverId)) return
      if (!forumPostAlerts(n.effectiveLevel(channelId, serverId), n.forumPosts.has(serverId))) return

      const channels = qc.getQueryData<{ channels?: { id: string; name: string }[] }>(['server', serverId])?.channels
      const title = t('notifCenter.forumPost', { channel: channels?.find(c => c.id === channelId)?.name ?? 'forum' })
      // Titre chiffré : vide côté serveur, on n'affiche que le salon.
      const body = (post.title ?? '').slice(0, 80)
      if (document.hasFocus()) {
        toast(body ? `${title} : ${body}` : title, { duration: 5000, style: { cursor: 'pointer', maxWidth: '360px' }, onClick: () => nav(path) } as Parameters<typeof toast>[1])
      } else {
        playMessage()
        sendNativeNotification(title, { body, onClick: () => nav(path) })
      }
    })
  }, [userId, focusMode, on, qc, nav, playMessage])
}
