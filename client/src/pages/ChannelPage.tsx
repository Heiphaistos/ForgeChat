import { useEffect, useState } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Hash, Users, Bell, Pin, Search } from 'lucide-react'
import api from '../api/client'
import { useChat } from '../store/chat'
import { useWs } from '../store/ws'
import MessageList from '../components/chat/MessageList'
import MessageInput from '../components/chat/MessageInput'
import MemberList from '../components/chat/MemberList'
import toast from 'react-hot-toast'

export default function ChannelPage() {
  const { serverId, channelId } = useParams()
  const { addMessages, addMessage, updateMessage, deleteMessage, addReaction, removeReaction, setTyping, clearTyping } = useChat()
  const { on, subscribeChannel } = useWs()
  const [showMembers, setShowMembers] = useState(true)

  const { data: serverData } = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => api.get(`/servers/${serverId}`).then(r => r.data),
    enabled: !!serverId,
  })

  const firstChannel = serverData?.channels?.find((c: any) => c.type === 'text')
  if (!channelId && firstChannel) {
    return <Navigate to={`/servers/${serverId}/channels/${firstChannel.id}`} replace />
  }
  if (!channelId && serverData && !firstChannel) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-fc-muted">
        <Hash size={48} className="mb-3 opacity-30" />
        <p>Aucun canal texte. Crées-en un via le menu du serveur.</p>
      </div>
    )
  }

  const currentChannel = serverData?.channels?.find((c: any) => c.id === channelId)

  const { data: messages = [] } = useQuery({
    queryKey: ['messages', channelId],
    queryFn: () => api.get(`/servers/${serverId}/channels/${channelId}/messages`).then(r => r.data),
    enabled: !!channelId && !!serverId,
  })

  useEffect(() => {
    if (messages.length > 0 && channelId) addMessages(channelId, messages)
  }, [messages])

  useEffect(() => {
    if (!channelId) return
    subscribeChannel(channelId)
    const offs = [
      on('MESSAGE_CREATE', (d: any) => {
        if (d.message.channel_id === channelId) addMessage(d.message)
      }),
      on('MESSAGE_UPDATE', (d: any) => {
        if (d.channel_id === channelId) updateMessage(channelId, d.message_id, { content: d.content, edited_at: d.edited_at })
      }),
      on('MESSAGE_DELETE', (d: any) => {
        if (d.channel_id === channelId) deleteMessage(channelId, d.message_id)
      }),
      on('REACTION_ADD', (d: any) => {
        if (d.channel_id === channelId) addReaction(channelId, d.message_id, d.emoji, d.user_id, false)
      }),
      on('REACTION_REMOVE', (d: any) => {
        if (d.channel_id === channelId) removeReaction(channelId, d.message_id, d.emoji, d.user_id)
      }),
      on('TYPING_START', (d: any) => {
        if (d.channel_id === channelId) {
          setTyping(channelId, d.user_id)
          setTimeout(() => clearTyping(channelId, d.user_id), 5000)
        }
      }),
    ]
    return () => offs.forEach(off => off())
  }, [channelId])

  const sendMsg = useMutation({
    mutationFn: (content: string) =>
      api.post(`/servers/${serverId}/channels/${channelId}/messages`, { content }),
    onError: () => toast.error('Échec de l\'envoi'),
  })

  const deleteMsg = useMutation({
    mutationFn: (msgId: string) =>
      api.delete(`/servers/${serverId}/channels/${channelId}/messages/${msgId}`),
    onSuccess: () => toast.success('Message supprimé'),
    onError: () => toast.error('Suppression impossible'),
  })

  const editMsg = useMutation({
    mutationFn: ({ msgId, content }: { msgId: string; content: string }) =>
      api.patch(`/servers/${serverId}/channels/${channelId}/messages/${msgId}`, { content }),
    onError: () => toast.error('Modification impossible'),
  })

  if (!channelId || !serverId) return null

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header canal */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-fc-bg shadow-sm flex-shrink-0 min-h-[48px]">
          <Hash size={18} className="text-fc-muted flex-shrink-0" />
          <span className="font-semibold text-white">{currentChannel?.name ?? '...'}</span>
          {currentChannel?.topic && (
            <>
              <div className="w-px h-4 bg-fc-hover mx-1" />
              <span className="text-sm text-fc-muted truncate hidden md:block">{currentChannel.topic}</span>
            </>
          )}
          <div className="ml-auto flex items-center gap-1">
            <button className="p-1.5 text-fc-muted hover:text-white transition rounded hover:bg-fc-hover" title="Rechercher">
              <Search size={18} />
            </button>
            <button className="p-1.5 text-fc-muted hover:text-white transition rounded hover:bg-fc-hover" title="Messages épinglés">
              <Pin size={18} />
            </button>
            <button className="p-1.5 text-fc-muted hover:text-white transition rounded hover:bg-fc-hover" title="Notifications">
              <Bell size={18} />
            </button>
            <button
              onClick={() => setShowMembers(!showMembers)}
              className={`p-1.5 rounded hover:bg-fc-hover transition ${showMembers ? 'text-white' : 'text-fc-muted hover:text-white'}`}
              title="Liste des membres"
            >
              <Users size={18} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <MessageList
          channelId={channelId}
          serverId={serverId}
          onDeleteMessage={(id) => deleteMsg.mutate(id)}
          onEditMessage={(id, content) => {
            const newContent = window.prompt('Modifier le message :', content)
            if (newContent !== null && newContent !== content && newContent.trim()) {
              editMsg.mutate({ msgId: id, content: newContent.trim() })
            }
          }}
        />

        {/* Input */}
        <MessageInput
          channelId={channelId}
          serverId={serverId}
          placeholder={`Envoyer un message dans #${currentChannel?.name ?? '...'}`}
          onSend={(content) => sendMsg.mutate(content)}
        />
      </div>

      {/* Liste membres */}
      {showMembers && <MemberList serverId={serverId} />}
    </div>
  )
}
