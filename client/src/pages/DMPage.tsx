import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Phone, Video, Search } from 'lucide-react'
import api from '../api/client'
import { useChat } from '../store/chat'
import { useWs } from '../store/ws'
import { usePresence } from '../store/presence'
import MessageList from '../components/chat/MessageList'
import MessageInput from '../components/chat/MessageInput'
import toast from 'react-hot-toast'

const STATUS_LABEL: Record<string, string> = {
  online: 'En ligne',
  idle: 'Absent',
  dnd: 'Ne pas déranger',
  invisible: 'Invisible',
  offline: 'Hors ligne',
}

const STATUS_COLOR: Record<string, string> = {
  online: 'bg-fc-green',
  idle: 'bg-fc-yellow',
  dnd: 'bg-fc-red',
  invisible: 'bg-fc-muted',
  offline: 'bg-fc-muted',
}

export default function DMPage() {
  const { dmId } = useParams<{ dmId: string }>()
  const { addMessages, addMessage, updateMessage, deleteMessage } = useChat()
  const { on } = useWs()
  const getStatus = usePresence(s => s.getStatus)

  const { data: dmInfo } = useQuery({
    queryKey: ['dm_info', dmId],
    queryFn: () => api.get('/dms').then(r => {
      const dms: any[] = r.data
      return dms.find(d => d.id === dmId) ?? null
    }),
    enabled: !!dmId,
  })

  const { data: messages = [] } = useQuery({
    queryKey: ['dm_messages', dmId],
    queryFn: () => api.get(`/dms/${dmId}/messages`).then(r => r.data),
    enabled: !!dmId,
  })

  useEffect(() => {
    if (messages.length > 0 && dmId) {
      const normalized = messages.map((m: any) => ({
        ...m,
        channel_id: dmId,
        author_id: m.sender_id,
        author_username: m.sender_username,
        author_avatar: m.sender_avatar,
        author_discriminator: '0000',
        attachments: [],
        reactions: [],
        type: 'default',
        pinned: false,
      }))
      addMessages(dmId, normalized)
    }
  }, [messages])

  useEffect(() => {
    if (!dmId) return
    const off = on('DM_MESSAGE', (d: any) => {
      if (d.dm_id === dmId) {
        addMessage({
          ...d.message,
          channel_id: dmId,
          author_id: d.message.sender_id,
          author_username: d.message.sender_username ?? 'Utilisateur',
          author_avatar: d.message.sender_avatar ?? null,
          author_discriminator: '0000',
          attachments: [],
          reactions: [],
          type: 'default',
          pinned: false,
          edited_at: null,
        })
      }
    })
    return off
  }, [dmId])

  const sendDm = useMutation({
    mutationFn: (content: string) => api.post(`/dms/${dmId}/messages`, { content }),
    onError: () => toast.error('Envoi impossible'),
  })

  if (!dmId) return null

  const partnerName = dmInfo?.username ?? 'Utilisateur'
  const partnerAvatar = dmInfo?.avatar ?? null
  const partnerId = dmInfo?.other_user_id ?? ''
  const status = partnerId ? getStatus(partnerId) : 'offline'

  return (
    <div className="flex flex-col h-full">
      {/* Header DM */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-fc-bg shadow-sm flex-shrink-0 min-h-[48px]">
        <div className="relative flex-shrink-0">
          <div className="w-9 h-9 rounded-full bg-fc-accent flex items-center justify-center font-bold text-sm text-white overflow-hidden">
            {partnerAvatar
              ? <img src={partnerAvatar} alt="" className="w-full h-full object-cover" />
              : partnerName.charAt(0).toUpperCase()}
          </div>
          <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-fc-channel ${STATUS_COLOR[status]}`} />
        </div>
        <div>
          <div className="font-semibold text-white text-sm leading-none">{partnerName}</div>
          <div className={`text-xs mt-0.5 ${status === 'online' ? 'text-fc-green' : 'text-fc-muted'}`}>
            {STATUS_LABEL[status] ?? 'Hors ligne'}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition" title="Appel vocal">
            <Phone size={18} />
          </button>
          <button className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition" title="Appel vidéo">
            <Video size={18} />
          </button>
          <button className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition" title="Rechercher">
            <Search size={18} />
          </button>
        </div>
      </div>

      <MessageList
        channelId={dmId}
        serverId=""
        onDeleteMessage={() => {}}
        onEditMessage={() => {}}
      />

      <MessageInput
        channelId={dmId}
        serverId=""
        placeholder={`Message @${partnerName}`}
        onSend={(content) => sendDm.mutate(content)}
      />
    </div>
  )
}
