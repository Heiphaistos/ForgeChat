import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import api from '../api/client'
import { useChat } from '../store/chat'
import { useWs } from '../store/ws'
import MessageList from '../components/chat/MessageList'
import MessageInput from '../components/chat/MessageInput'
import toast from 'react-hot-toast'

export default function DMPage() {
  const { dmId } = useParams<{ dmId: string }>()
  const { addMessages, addMessage } = useChat()
  const { on } = useWs()

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
          author_username: 'Utilisateur',
          author_avatar: null,
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

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-fc-bg shadow-sm flex-shrink-0">
        <span className="font-semibold text-white">Message direct</span>
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
        placeholder="Envoyer un message..."
        onSend={(content) => sendDm.mutate(content)}
      />
    </div>
  )
}
