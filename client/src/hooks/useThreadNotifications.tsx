// Écouteur global THREAD_MESSAGE : rafraîchit les badges de non-lus des fils et
// notifie l'auteur du fil et ses participants (liste fournie par le serveur)
// quand le fil n'est pas ouvert à l'écran.
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useWs } from '../store/ws'
import { useAuth } from '../store/auth'
import { useChannelNotif } from '../store/channelNotif'
import { sendNativeNotification } from './usePushNotifications'
import { useAudioNotifications } from './useAudioNotifications'
import api from '../api/client'
import { lockedText } from '../e2e/conversations'
import { openThread, openThreadMessages } from '../e2e/channelScopes'

// Fil affiché par ThreadPanel (un seul à la fois) : pas de notification pour lui.
let openThreadId: string | null = null
export function setOpenThread(id: string | null) { openThreadId = id }

export function useThreadNotifications() {
  const { on } = useWs()
  const qc = useQueryClient()
  const nav = useNavigate()
  const userId = useAuth(s => s.user?.id)
  const focusMode = useAuth(s => s.user?.focus_mode)
  const isChannelMuted = useChannelNotif(s => s.isMuted)
  const isServerMuted = useChannelNotif(s => s.isServerMuted)
  const { playMessage } = useAudioNotifications()

  useEffect(() => {
    if (!userId) return
    return on('THREAD_MESSAGE', async (d: any) => {
      qc.invalidateQueries({ queryKey: ['threads', d.channel_id] })
      const msg = d.message
      if (!msg || msg.user_id === userId || d.thread_id === openThreadId) return
      if (!Array.isArray(d.notify_user_ids) || !d.notify_user_ids.includes(userId)) return
      if (focusMode || isChannelMuted(d.channel_id) || (d.server_id && isServerMuted(d.server_id))) return

      // Fil chiffré : titre et message déchiffrés ici (portée du fil, lue sur le fil lui-même).
      let threadTitle: string = d.thread_title || 'un fil'
      let text: string = msg.content ?? ''
      if (msg.enc) {
        const th = (await api.get(`/servers/${d.server_id}/channels/${d.channel_id}/threads`, { params: { thread_id: d.thread_id } })
          .then(r => r.data[0]).catch(() => null))
        const opened = th ? await openThread(d.channel_id, th) : null
        if (opened?.title) threadTitle = opened.title
        text = (await openThreadMessages(d.channel_id, th, [msg]))[0]?.content ?? lockedText()
      }
      const go = () => nav(`/servers/${d.server_id}/channels/${d.channel_id}?thread=${d.thread_id}`)
      const title = `${msg.author_username ?? "Quelqu'un"} dans « ${threadTitle} »`
      const body = (text || 'Pièce jointe').slice(0, 80)
      if (document.hasFocus()) {
        toast(t => (
          <button
            type="button"
            className="text-left text-sm max-w-[320px]"
            onClick={() => { toast.dismiss(t.id); go() }}
          >
            <span className="font-semibold">{title}</span>
            <span className="block truncate">{body}</span>
          </button>
        ), { duration: 5000 })
      } else {
        playMessage()
        sendNativeNotification(title, { body, onClick: go })
      }
    })
  }, [userId, focusMode, isChannelMuted, isServerMuted, on, qc, nav, playMessage])
}
