import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Hash, Users, Bell, Pin, Search, Volume2, Video, Megaphone, MessagesSquare, Radio, Loader2, Timer } from 'lucide-react'
import ExportConversationButton from '../components/chat/ExportConversationButton'
import api from '../api/client'
import { useChat } from '../store/chat'
import { useWs } from '../store/ws'
import type { FileWithTtl } from '../components/chat/MessageInput'
import MessageList from '../components/chat/MessageList'
import MessageInput, { ReplyTarget } from '../components/chat/MessageInput'
import { useUnread } from '../store/unread'
import MemberList from '../components/chat/MemberList'
import PinnedPanel from '../components/chat/PinnedPanel'
import SearchPanel from '../components/chat/SearchPanel'
import VoiceVideoPage from './VoiceVideoPage'
import ForumPage from './ForumPage'
import ThreadPanel from '../components/chat/ThreadPanel'
import WelcomeScreen from '../components/chat/WelcomeScreen'
import VerificationGateModal from '../components/modals/VerificationGateModal'
import toast from 'react-hot-toast'

function channelIcon(type: string, size = 18) {
  const cls = `flex-shrink-0`
  switch (type) {
    case 'voice': return <Volume2 size={size} className={cls} />
    case 'video': return <Video size={size} className={cls} />
    case 'announcement': return <Megaphone size={size} className={cls} />
    case 'forum': return <MessagesSquare size={size} className={cls} />
    case 'stage': return <Radio size={size} className={cls} />
    default: return <Hash size={size} className={cls} />
  }
}

export default function ChannelPage() {
  const { serverId, channelId } = useParams()
  const { addMessages, addMessage, updateMessage, deleteMessage, mergeAttachments, addReaction, removeReaction, setTyping, clearTyping } = useChat()
  const { on, subscribeChannel } = useWs()
  const markRead = useUnread(s => s.markRead)
  const qc = useQueryClient()
  const [showMembers, setShowMembers] = useState(true)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [showPinned, setShowPinned] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [slowmodeCooldown, setSlowmodeCooldown] = useState(0)
  const slowmodeTimer = useRef<ReturnType<typeof setInterval>>()

  // All hooks first — no conditional hooks
  const { data: serverData, isLoading: serverLoading } = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => api.get(`/servers/${serverId}`).then(r => r.data),
    enabled: !!serverId,
  })

  const { data: messages = [] } = useQuery({
    queryKey: ['messages', channelId],
    queryFn: () => api.get(`/servers/${serverId}/channels/${channelId}/messages`).then(r => r.data),
    enabled: !!channelId && !!serverId,
  })

  useEffect(() => {
    if (messages.length > 0 && channelId) addMessages(channelId, messages)
  }, [messages, channelId])

  // Marquer comme lu + reset load-more quand on ouvre un nouveau canal
  useEffect(() => {
    if (channelId) {
      markRead(channelId)
      setHasMore(true)
    }
  }, [channelId])

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
      on('MESSAGE_ATTACHMENT_ADDED', (d: any) => {
        if (d.channel_id === channelId) mergeAttachments(channelId, d.message_id, d.attachments)
      }),
    ]
    return () => offs.forEach(off => off())
  }, [channelId])

  useEffect(() => () => clearInterval(slowmodeTimer.current), [])

  const startSlowmodeCooldown = (delay: number) => {
    setSlowmodeCooldown(delay)
    clearInterval(slowmodeTimer.current)
    slowmodeTimer.current = setInterval(() => {
      setSlowmodeCooldown(prev => {
        if (prev <= 1) { clearInterval(slowmodeTimer.current); return 0 }
        return prev - 1
      })
    }, 1000)
  }

  const sendMsg = useMutation({
    mutationFn: ({ content, reply_to }: { content: string | null; reply_to?: string }) =>
      api.post(`/servers/${serverId}/channels/${channelId}/messages`, { content, reply_to }),
    onError: (e: any) => {
      if (e?.response?.status === 429) {
        const delay = currentChannel?.slowmode_delay ?? 30
        startSlowmodeCooldown(delay)
        toast.error(`Mode lent — attendez ${delay}s avant d'envoyer`)
      } else {
        toast.error("Échec de l'envoi")
      }
    },
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

  const loadMore = useCallback(async (): Promise<boolean> => {
    if (!channelId || !serverId || !hasMore) return false
    const store = useChat.getState()
    const msgs = store.messagesByChannel[channelId] ?? []
    if (msgs.length === 0) return false
    const oldestId = msgs[0].id
    try {
      const { data } = await api.get(
        `/servers/${serverId}/channels/${channelId}/messages?before=${oldestId}&limit=50`
      )
      if (data.length === 0) { setHasMore(false); return false }
      addMessages(channelId, data, true)
      if (data.length < 50) setHasMore(false)
      return true
    } catch { return false }
  }, [channelId, serverId, hasMore])

  if (!serverId) return null

  const server = serverData?.server ?? serverData
  // Vérification Gate : si le serveur a la vérification activée et que le membre n'est pas vérifié
  const needsVerification =
    !!server?.verification_enabled &&
    serverData?.member?.verified_at == null &&
    serverData !== undefined

  if (needsVerification) {
    return (
      <VerificationGateModal
        serverId={serverId}
        serverName={server?.name ?? ''}
        rules={server?.verification_rules ?? ''}
        onVerified={() => {
          qc.invalidateQueries({ queryKey: ['server', serverId] })
        }}
      />
    )
  }

  // Loading state — FIX du bug page noire
  if (!channelId && serverLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={32} className="animate-spin text-fc-accent" />
      </div>
    )
  }

  const channels: any[] = serverData?.channels ?? []

  if (!channelId && serverData) {
    return (
      <WelcomeScreen
        server={serverData.server ?? serverData}
        channels={channels}
      />
    )
  }

  if (!channelId) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={32} className="animate-spin text-fc-accent" />
      </div>
    )
  }

  const currentChannel = channels.find((c: any) => c.id === channelId)

  // Canal vocal / vidéo / scène — même composant WebRTC
  if (currentChannel?.type === 'voice' || currentChannel?.type === 'video' || currentChannel?.type === 'stage') {
    return <VoiceVideoPage channel={currentChannel} serverId={serverId} />
  }

  // Forum
  if (currentChannel?.type === 'forum') {
    return <ForumPage channel={currentChannel} serverId={serverId} channelId={channelId} />
  }

  // Canal texte / annonces
  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header canal */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-fc-bg shadow-sm flex-shrink-0 min-h-[48px]">
          <span className="text-fc-muted">{channelIcon(currentChannel?.type ?? 'text')}</span>
          <span className="font-semibold text-white">{currentChannel?.name ?? '...'}</span>
          {currentChannel?.type === 'announcement' && (
            <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full font-medium">Annonces</span>
          )}
          {(currentChannel?.slowmode_delay ?? 0) > 0 && (
            <span className="flex items-center gap-1 text-xs bg-fc-hover text-fc-muted px-2 py-0.5 rounded-full" title={`Mode lent: ${currentChannel.slowmode_delay}s`}>
              <Timer size={11} />
              {currentChannel.slowmode_delay >= 3600
                ? `${currentChannel.slowmode_delay / 3600}h`
                : currentChannel.slowmode_delay >= 60
                ? `${currentChannel.slowmode_delay / 60}m`
                : `${currentChannel.slowmode_delay}s`}
            </span>
          )}
          {currentChannel?.topic && (
            <>
              <div className="w-px h-4 bg-fc-hover mx-1" />
              <span className="text-sm text-fc-muted truncate hidden md:block">{currentChannel.topic}</span>
            </>
          )}
          <div className="ml-auto flex items-center gap-1">
            {currentChannel && (
              <ExportConversationButton
                channelId={channelId}
                channelName={currentChannel.name ?? channelId}
              />
            )}
            <button
              onClick={() => { setShowSearch(!showSearch); setShowPinned(false); setActiveThreadId(null) }}
              className={`p-1.5 rounded hover:bg-fc-hover transition ${showSearch ? 'text-white' : 'text-fc-muted hover:text-white'}`}
              title="Rechercher"
            >
              <Search size={18} />
            </button>
            <button
              onClick={() => { setShowPinned(!showPinned); setShowSearch(false); setActiveThreadId(null) }}
              className={`p-1.5 rounded hover:bg-fc-hover transition ${showPinned ? 'text-white' : 'text-fc-muted hover:text-white'}`}
              title="Messages épinglés"
            >
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
          onEditMessage={(id, content) => editMsg.mutate({ msgId: id, content })}
          onOpenThread={(msgId) => { setActiveThreadId(msgId); setShowPinned(false); setShowSearch(false) }}
          onAddReaction={(msgId, emoji) =>
            api.put(`/servers/${serverId}/channels/${channelId}/messages/${msgId}/reactions/${encodeURIComponent(emoji)}`)
          }
          onPinMessage={(msgId) =>
            api.post(`/servers/${serverId}/channels/${channelId}/messages/${msgId}/pin`)
              .then(() => toast.success('Message épinglé'))
              .catch(() => toast.error('Épinglage impossible'))
          }
          onReply={(msg) => setReplyTo({ id: msg.id, author_username: msg.author_username, content: msg.content ?? null })}
          onLoadMore={loadMore}
        />

        {/* Countdown slowmode */}
        {slowmodeCooldown > 0 && (
          <div className="flex items-center gap-2 px-4 py-1.5 bg-yellow-500/10 border-t border-yellow-500/20 text-yellow-400 text-xs">
            <Timer size={12} />
            <span>Mode lent — attendez encore <strong>{slowmodeCooldown}s</strong> avant d'envoyer</span>
          </div>
        )}

        {/* Input */}
        <MessageInput
          channelId={channelId}
          serverId={serverId}
          placeholder={slowmodeCooldown > 0 ? `Attendez ${slowmodeCooldown}s (mode lent)...` : `Message dans #${currentChannel?.name ?? '...'}`}
          onSend={async (content, replyToId, files) => {
            try {
              const res = await sendMsg.mutateAsync({ content: content || null, reply_to: replyToId })
              const msgId = res.data?.id
              if (files && files.length > 0 && msgId) {
                const fd = new FormData()
                for (const fw of files) {
                  fd.append('files', fw.file)
                  if (fw.ttlHours != null) fd.append('ttl_hours', String(fw.ttlHours))
                }
                await api.post(
                  `/servers/${serverId}/channels/${channelId}/messages/${msgId}/attachments`,
                  fd,
                  { headers: { 'Content-Type': 'multipart/form-data' } }
                )
              }
            } catch {
              // erreur déjà gérée par sendMsg
            }
          }}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
        />
      </div>

      {/* Thread panel */}
      {activeThreadId && (
        <ThreadPanel
          serverId={serverId}
          channelId={channelId}
          parentMessageId={activeThreadId}
          onClose={() => setActiveThreadId(null)}
        />
      )}

      {/* Panneau épingles */}
      {showPinned && !activeThreadId && (
        <PinnedPanel
          serverId={serverId}
          channelId={channelId}
          channelName={currentChannel?.name ?? ''}
          onClose={() => setShowPinned(false)}
        />
      )}

      {/* Panneau recherche */}
      {showSearch && !activeThreadId && (
        <SearchPanel
          serverId={serverId}
          channelId={channelId}
          channelName={currentChannel?.name ?? ''}
          onClose={() => setShowSearch(false)}
        />
      )}

      {/* Liste membres */}
      {showMembers && !activeThreadId && !showPinned && !showSearch && <MemberList serverId={serverId} />}
    </div>
  )
}
